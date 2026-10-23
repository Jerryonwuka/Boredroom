/**
 * Linear adapter (work group, owner decisions 22 October 2026: connectors; spec §2, §7, §8.5, §9).
 *
 * - OAuth 2.0 with PKCE (S256), comma-separated scopes, `prompt=consent`; workspace connections install the app actor
 *   (`actor=app`), personal ones act as the person (`actor=user`, Linear's default). Rotating refresh tokens (all apps since
 *   1 April 2026), 24-hour access tokens. Revoke: `POST https://api.linear.app/oauth/revoke` with `token`.
 * - Scopes: reading asks only `read`; "can make changes" adds `issues:create`, `comments:create` and `write` (state,
 *   assignee and due date need `write`; Linear has no narrower scope for them).
 * - Sync (GraphQL, `api.linear.app/graphql`): personal `viewer.assignedIssues`, workspace `issues` of the selected teams,
 *   "updated since" a watermark, and every 6 hours a reconciliation of the open set.
 * - Acting: personal connections as the person; workspace connections as the Boredroom app with
 *   `createAsUser: "Jo (via Boredroom)"` and the "From Jo via Max" line the card shows (`workspaceActs: true`).
 * - Webhooks: the application's own webhook (set in Linear's console), `Linear-Signature` (hex HMAC-SHA256 of the raw
 *   body) and `webhookTimestamp` within 60 seconds.
 * Server-only.
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { env, envAll } from "../env";
import { safeEqual } from "../crypto";
import { APP_READBACK } from "@/lib/connectors/words";
import {
  ConnectorError, type ActInput, type ActionSpec, type ConnectionRef, type NormalisedItem, type ProviderAdapter, type ProviderHttp,
  type SourceInfo, type TokenSet, type WebhookRoute,
} from "../types";

const ENV = ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "LINEAR_WEBHOOK_SECRET"] as const;
const APP = "Linear";
const GRAPHQL = "https://api.linear.app/graphql";
export const LINEAR_READ_SCOPES = ["read"] as const;
export const LINEAR_ACT_SCOPES = ["issues:create", "comments:create", "write"] as const;
const PAGE_INC = 50;
const PAGE_OPEN = 100;
const OPEN_MAX = { personal: 500, workspace: 2000 } as const;
const OVERLAP_MS = 2 * 60_000;
const RECENT_AFTER_FULL_MS = 48 * 3600_000;
const WEBHOOK_WINDOW_MS = 60_000;
const DESCRIPTION_MAX = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const dueWords = (due: string) => new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const plainName = (s: unknown) => String(s ?? "").replace(/[^\p{L}\p{N} .,'@_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);

async function refuse(words: string): Promise<never> {
  const { ActRefusal } = await import("../actions");
  throw new ActRefusal(words);
}

/** One GraphQL call; errors in the body are mapped by `interpret` (the HTTP client throws them). */
async function gql<T = Record<string, unknown>>(http: ProviderHttp, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await http.request<{ data?: T }>({ method: "POST", url: GRAPHQL, json: { query, variables } });
  const data = rec(r.body).data;
  if (!data || typeof data !== "object") throw new ConnectorError("BAD_RESPONSE", "linear answered without data");
  return data as T;
}

// ---- Tokens -----------------------------------------------------------------------------------------------------------------

export function parseToken(body: unknown, now: Date): TokenSet {
  const b = rec(body);
  if (typeof b.error === "string") throw new ConnectorError(b.error === "invalid_grant" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `linear token error ${b.error.slice(0, 40)}`);
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "linear token missing");
  // Apps made before December 2023 answer `scope` as an array; newer ones as a space-separated string.
  const scopes = Array.isArray(b.scope) ? b.scope.filter((s): s is string => typeof s === "string") : typeof b.scope === "string" ? b.scope.split(/[\s,]+/).filter(Boolean) : null;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    tokenType: "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: null,
    scopes,
  };
}

// ---- Items ------------------------------------------------------------------------------------------------------------------

const ISSUE_FIELDS = `id identifier title url priority dueDate updatedAt description state { id name type } team { id key name } assignee { id name email }`;

const STATE_OF: Record<string, NormalisedItem["state"]> = { completed: "done", canceled: "cancelled", started: "in_progress" };

export function issueItem(conn: ConnectionRef, raw: unknown): NormalisedItem | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const state = rec(r.state);
  const team = rec(r.team);
  const assignee = rec(r.assignee);
  const assigneeId = str(assignee.id);
  const priority = typeof r.priority === "number" && Number.isInteger(r.priority) && r.priority >= 0 && r.priority <= 4 ? (r.priority as 0 | 1 | 2 | 3 | 4) : null;
  const description = str(r.description);
  const due = str(r.dueDate);
  return {
    kind: "issue",
    subtype: "issue",
    externalId: id,
    externalKey: str(r.identifier),
    url: str(r.url),
    title: str(r.title) ?? str(r.identifier) ?? "(untitled)",
    state: STATE_OF[str(state.type) ?? ""] ?? "open",
    stateLabel: str(state.name),
    priority,
    sourceExternalId: str(team.id),
    containerLabel: str(team.name),
    assigneeExternalId: assigneeId,
    assigneeLabel: str(assignee.name),
    assigneeEmail: str(assignee.email),
    mine: conn.kind === "personal" && !!assigneeId && assigneeId === conn.externalAccountId,
    dueOn: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    excerpt: description ? description.slice(0, DESCRIPTION_MAX) : null,
    providerUpdatedAt: str(r.updatedAt),
  };
}

// ---- Sync -------------------------------------------------------------------------------------------------------------------

type Cursor = { ph: "open" | "inc"; w: string | null; pg: string | null; mx: string | null };
export function readCursor(cursor: string | null, full: boolean, now: Date): Cursor {
  let c: Partial<Cursor> | null = null;
  try { c = cursor ? (JSON.parse(cursor) as Partial<Cursor>) : null; } catch { c = null; }
  const valid = c && (c.ph === "open" || c.ph === "inc");
  if (valid && (c!.pg || c!.ph === "open")) return { ph: c!.ph!, w: str(c!.w), pg: str(c!.pg), mx: str(c!.mx) };
  if (full) return { ph: "open", w: null, pg: null, mx: null };
  return { ph: "inc", w: (valid ? str(c!.w) : null) ?? new Date(now.getTime() - 30 * 24 * 3600_000).toISOString(), pg: null, mx: null };
}
const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** The query and variables for one page: personal (assigned to the viewer) or workspace (selected teams). */
export function pageQuery(conn: ConnectionRef, selected: SourceInfo[], cur: Cursor): { query: string; variables: Record<string, unknown> } | null {
  const filter: Record<string, unknown> = cur.ph === "open"
    ? { state: { type: { nin: ["completed", "canceled"] } } }
    : { updatedAt: { gt: cur.w } };
  const first = cur.ph === "open" ? PAGE_OPEN : PAGE_INC;
  const page = `(first: $first, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } }`;
  if (conn.kind === "personal") {
    return { query: `query Assigned($first: Int!, $after: String, $filter: IssueFilter) { viewer { assignedIssues${page} } }`, variables: { first, after: cur.pg, filter } };
  }
  const teams = selected.filter((s) => s.kind === "team" && UUID.test(s.externalId)).map((s) => s.externalId).slice(0, 100);
  if (!teams.length) return null;
  return { query: `query TeamIssues($first: Int!, $after: String, $filter: IssueFilter) { issues${page} }`, variables: { first, after: cur.pg, filter: { ...filter, team: { id: { in: teams } } } } };
}

// ---- Actions ----------------------------------------------------------------------------------------------------------------

const asWho = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? APP_READBACK.as.workspaceApp(c.actor.firstName, c.actor.assistantName) : APP_READBACK.as.yourAccount(c.conn.accountLabel));
/** The line the card shows and the app receives under a workspace connection's words (§9.5). */
export const signature = (c: ActInput<unknown>) => `From ${c.actor.firstName} via ${c.actor.assistantName}`;
const signed = (c: ActInput<unknown>, text: string | undefined) => (c.conn.kind === "workspace" ? (text ? `${text}\n\n${signature(c)}` : signature(c)) : text ?? "");
/** Linear's own attribution for the app actor (`createAsUser`, spec §8.5). */
const actorFields = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? { createAsUser: `${c.actor.firstName} (via Boredroom)`.slice(0, 80) } : {});

const needItem = (c: ActInput<unknown>) => { if (!c.item) throw new ConnectorError("NOT_FOUND", "no item"); return c.item; };
const keyOf = (c: ActInput<unknown>) => needItem(c).externalKey ?? needItem(c).title;

async function updateIssue(c: ActInput<unknown>, input: Record<string, unknown>): Promise<NormalisedItem | null> {
  const d = await gql<{ issueUpdate?: { success?: boolean; issue?: unknown } }>(c.http,
    `mutation Update($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
    { id: needItem(c).externalId, input });
  if (!d.issueUpdate?.success) throw new ConnectorError("BAD_RESPONSE", "linear issueUpdate failed");
  return issueItem(c.conn, d.issueUpdate.issue);
}

const createIssue: ActionSpec<{ title: string; text?: string }> = {
  name: "create_issue", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().max(4000).optional() }),
  async prepare(c) {
    if (!c.source || c.source.kind !== "team") throw new ConnectorError("NOT_FOUND", "no team");
    const place = c.source.label;
    const body = signed(c, c.input.text);
    return {
      risk: "shared", summary: APP_READBACK.create_issue.summary(APP, place), ...(body ? { detail: body } : {}),
      readback: { to: [APP_READBACK.create_issue.to(place, APP)], what: APP_READBACK.create_issue.what(c.input.title, asWho(c)) }, appearsAs: asWho(c), place,
    };
  },
  async run(c) {
    if (!c.source || !UUID.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no team");
    const body = signed(c, c.input.text);
    const d = await gql<{ issueCreate?: { success?: boolean; issue?: unknown } }>(c.http,
      `mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
      { input: { teamId: c.source.externalId, title: c.input.title, ...(body ? { description: body } : {}), ...actorFields(c) } });
    if (!d.issueCreate?.success) throw new ConnectorError("BAD_RESPONSE", "linear issueCreate failed");
    const item = issueItem(c.conn, d.issueCreate.issue);
    return { summary: `Created ${item?.externalKey ?? "the issue"} “${c.input.title}” in Linear`, href: item?.url ?? null, item };
  },
};

const comment: ActionSpec<{ text: string }> = {
  name: "comment", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ text: z.string().trim().min(1).max(4000) }),
  async prepare(c) {
    const key = keyOf(c);
    return { risk: "shared", summary: APP_READBACK.comment.summary(key), detail: signed(c, c.input.text), readback: { to: [APP_READBACK.comment.to(key, APP)], what: APP_READBACK.comment.what(asWho(c)) }, appearsAs: asWho(c) };
  },
  async run(c) {
    const d = await gql<{ commentCreate?: { success?: boolean } }>(c.http,
      `mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }`,
      { input: { issueId: needItem(c).externalId, body: signed(c, c.input.text), ...actorFields(c) } });
    if (!d.commentCreate?.success) throw new ConnectorError("BAD_RESPONSE", "linear commentCreate failed");
    return { summary: `Commented on ${keyOf(c)}` };
  },
};

type Want = "todo" | "in_progress" | "done" | "cancelled";
const WANT_TYPE: Record<Want, string> = { todo: "unstarted", in_progress: "started", done: "completed", cancelled: "canceled" };

/** The team's first workflow state (by position) of the wanted type, and the state the issue is in now. */
async function stateFor(c: ActInput<{ state: Want }>): Promise<{ id: string; to: string; from: string | null }> {
  const d = await gql<{ issue?: { state?: { name?: string }; team?: { states?: { nodes?: unknown[] } } } }>(c.http,
    `query States($id: String!) { issue(id: $id) { state { id name type } team { states(first: 100) { nodes { id name type position } } } } }`, { id: needItem(c).externalId });
  const states = arr(d.issue?.team?.states?.nodes).map(rec)
    .filter((s) => str(s.id) && str(s.name) && s.type === WANT_TYPE[c.input.state])
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  const s = states[0];
  if (!s) return refuse(`${keyOf(c)}'s team in Linear has no ${({ todo: "to-do", in_progress: "in-progress", done: "done", cancelled: "cancelled" })[c.input.state]} state.`);
  return { id: String(s.id), to: String(s.name), from: str(d.issue?.state?.name) };
}

const setState: ActionSpec<{ state: Want }> = {
  name: "set_state", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ state: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  async prepare(c) {
    const key = keyOf(c);
    const s = await stateFor(c);
    return {
      risk: c.input.state === "cancelled" ? "destructive" : "shared", summary: APP_READBACK.set_state.summary(key, s.to),
      readback: { to: [APP_READBACK.set_state.to(key, APP)], what: APP_READBACK.set_state.what(key, s.from, s.to) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const s = await stateFor(c);
    return { summary: `Moved ${keyOf(c)} to ${s.to}`, item: await updateIssue(c, { stateId: s.id }) };
  },
};

/**
 * "me" (the person's own Linear user: the viewer for a personal connection; for the app, the workspace's user with the
 * person's sign-in email), or one active user matched by email or exact name. Several or none: words.
 */
async function assigneeFor(c: ActInput<{ assignee: string }>): Promise<{ id: string; name: string; me: boolean }> {
  const wanted = c.input.assignee.trim();
  const me = wanted.toLowerCase() === "me";
  if (me && c.conn.kind === "personal") return { id: c.conn.externalAccountId, name: "you", me: true };
  const q = me ? c.actor.email : wanted;
  if (!q) return refuse("I don't know your Linear account. Say the name or email address Linear shows for you.");
  const d = await gql<{ users?: { nodes?: unknown[] } }>(c.http,
    `query Users($q: String!) { users(first: 20, filter: { or: [{ email: { eqIgnoreCase: $q } }, { name: { eqIgnoreCase: $q } }, { displayName: { eqIgnoreCase: $q } }] }) { nodes { id name displayName email active } } }`, { q });
  const users = arr(d.users?.nodes).map(rec).filter((u) => str(u.id) && u.active !== false);
  if (users.length === 1) return { id: String(users[0].id), name: me ? "you" : str(users[0].name) ?? wanted, me };
  if (users.length > 1) return refuse(`More than one person in Linear matches “${plainName(q)}”: ${users.slice(0, 10).map((u) => plainName(u.name)).join(", ")}. Say their email address.`);
  return refuse(me ? "I couldn't find you in Linear by your email address. Say the name Linear shows for you." : `I couldn't find “${plainName(wanted)}” in Linear. Say their email address or their name as Linear shows it.`);
}

const assign: ActionSpec<{ assignee: string }> = {
  name: "assign", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ assignee: z.string().trim().min(1).max(200) }),
  async prepare(c) {
    const key = keyOf(c);
    const who = await assigneeFor(c);
    return {
      risk: "shared", summary: APP_READBACK.assign.summary(key, who.name),
      readback: { to: [APP_READBACK.assign.toPerson(who.me ? "You" : who.name, APP), APP_READBACK.assign.to(key, APP)], what: APP_READBACK.assign.what(key, who.name) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const who = await assigneeFor(c);
    return { summary: `Assigned ${keyOf(c)} to ${who.name}`, item: await updateIssue(c, { assigneeId: who.id }) };
  },
};

const setDue: ActionSpec<{ due: string | null }> = {
  name: "set_due", tool: "work_item_action", kinds: ["workspace", "personal"],
  input: z.object({ due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  async prepare(c) {
    const key = keyOf(c);
    return {
      risk: "shared", summary: APP_READBACK.set_due.summary(key),
      readback: { to: [APP_READBACK.set_due.to(key, APP)], what: APP_READBACK.set_due.what(key, c.input.due ? dueWords(c.input.due) : null) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    return { summary: c.input.due ? `Set ${keyOf(c)} due ${dueWords(c.input.due)}` : `Cleared ${keyOf(c)}'s due date`, item: await updateIssue(c, { dueDate: c.input.due }) };
  },
};

// ---- Webhooks -------------------------------------------------------------------------------------------------------------------

/** Linear's delivery: the hex HMAC of the raw body, and a `webhookTimestamp` (ms) within 60 seconds. */
export function verifyLinear(raw: Uint8Array, signature: string | null, secret: string, nowMs: number): { ok: boolean; body: Record<string, unknown> | null } {
  if (!signature || !secret || !/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, body: null };
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(signature.toLowerCase(), want)) return { ok: false, body: null };
  let body: Record<string, unknown>;
  try { body = rec(JSON.parse(new TextDecoder().decode(raw))); } catch { return { ok: false, body: null }; }
  const ts = Number(body.webhookTimestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > WEBHOOK_WINDOW_MS) return { ok: false, body: null };
  return { ok: true, body };
}

// ---- The adapter -------------------------------------------------------------------------------------------------------------------

export const adapter: ProviderAdapter = {
  id: "linear",
  category: "work",
  kinds: ["workspace", "personal"],
  hosts: ["api.linear.app"],
  linkHosts: ["linear.app"],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    clientId: () => env("LINEAR_CLIENT_ID"),
    clientSecret: () => env("LINEAR_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: ",",
    scopes: ({ act }) => [...LINEAR_READ_SCOPES, ...(act ? LINEAR_ACT_SCOPES : [])],
    authorizeParams: (c) => ({ prompt: "consent", ...(c.kind === "workspace" ? { actor: "app" } : {}) }),
    parseToken,
    refresh: "rotating",
  },
  async identify({ kind, http, tokens }) {
    const d = await gql<{ viewer?: Record<string, unknown> }>(http, `query Me { viewer { id name email organization { id name urlKey } } }`);
    const v = rec(d.viewer);
    const org = rec(v.organization);
    const id = str(v.id);
    const orgId = str(org.id);
    if (!id || !orgId) throw new ConnectorError("BAD_RESPONSE", "linear viewer missing");
    const name = str(org.name) ?? "Linear";
    const email = str(v.email);
    return kind === "workspace"
      ? { externalAccountId: orgId, externalTenantId: orgId, accountLabel: `${name} (Linear)`, settings: { urlKey: str(org.urlKey) }, scopes: tokens.scopes ?? undefined }
      : { externalAccountId: id, externalTenantId: orgId, accountLabel: email ?? str(v.name) ?? name, identity: { externalUserId: id, email }, scopes: tokens.scopes ?? undefined };
  },
  ownerBound: false,
  workspaceActs: true,
  async sources({ http }) {
    const d = await gql<{ teams?: { nodes?: unknown[] } }>(http, `query Teams { teams(first: 100) { nodes { id key name private archivedAt } } }`);
    return arr(d.teams?.nodes).map(rec).filter((t) => str(t.id) && str(t.name)).map((t) => ({
      kind: "team" as const, externalId: String(t.id), label: `${String(t.name)}${str(t.key) ? ` (${String(t.key)})` : ""}`,
      isPrivate: typeof t.private === "boolean" ? t.private : undefined, archived: !!t.archivedAt,
    }));
  },
  streams: [
    { name: "issues", kinds: ["issue"], every: { workingMinutes: 15, offMinutes: 120 }, perRun: { pages: 10, items: 1000, ms: 15_000 }, fullEveryMinutes: 6 * 60 },
  ],
  async sync({ conn, http, cursor, full, now, sink, selected, deadline }) {
    let cur = readCursor(cursor, full, now);
    const startedOpenHere = cur.ph === "open" && !cur.pg;
    const openIds: string[] = [];
    const openMax = OPEN_MAX[conn.kind];
    for (let pages = 0; ; pages++) {
      if (pages >= 10 || Date.now() >= deadline) return { cursor: JSON.stringify(cur), more: true };
      const q = pageQuery(conn, selected, cur);
      if (!q) return { cursor: null, more: false }; // a workspace with no team selected: nothing to read
      const d = await gql<Record<string, unknown>>(http, q.query, q.variables);
      const conn_ = conn.kind === "personal" ? rec(rec(d.viewer).assignedIssues) : rec(d.issues);
      const items = arr(conn_.nodes).map((n) => issueItem(conn, n)).filter((x): x is NormalisedItem => !!x)
        // assignedIssues are the viewer's by definition (an app actor's viewer is the app user).
        .map((i) => (conn.kind === "personal" ? { ...i, mine: true } : i));
      await sink.upsert(items);
      for (const i of items) {
        cur.mx = newer(cur.mx, i.providerUpdatedAt ?? null);
        if (cur.ph === "open" && openIds.length < openMax && i.state !== "done" && i.state !== "cancelled") openIds.push(i.externalId);
      }
      const info = rec(conn_.pageInfo);
      const next = str(info.endCursor);
      if (info.hasNextPage === true && next && !(cur.ph === "open" && openIds.length >= openMax)) { cur.pg = next; continue; }
      if (cur.ph === "open") {
        if (startedOpenHere) await sink.reconcileOpen("issue", openIds);
        cur = { ph: "inc", w: new Date(now.getTime() - RECENT_AFTER_FULL_MS).toISOString(), pg: null, mx: cur.mx };
        continue;
      }
      const mx = cur.mx ? new Date(Date.parse(cur.mx) - OVERLAP_MS).toISOString() : null;
      return { cursor: JSON.stringify({ ph: "inc", w: newer(cur.w, mx), pg: null, mx: null }), more: false };
    }
  },
  async fetchItem({ conn, http, kind, externalId }) {
    if (kind !== "issue") return null;
    const d = await gql<{ issue?: unknown }>(http, `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: externalId });
    return d.issue ? issueItem(conn, d.issue) : null;
  },
  async fetchText({ http, kind, externalId, maxChars }) {
    if (kind !== "issue") return null;
    const d = await gql<{ issue?: { description?: unknown } }>(http, `query Text($id: String!) { issue(id: $id) { description } }`, { id: externalId });
    const t = str(d.issue?.description);
    return t ? t.slice(0, Math.min(maxChars, DESCRIPTION_MAX)) : null;
  },
  actions: [createIssue, comment, setState, assign, setDue],
  interpret(res) {
    const errors = arr(rec(res.body).errors).map(rec);
    if (!errors.length) return null;
    const codes = errors.map((e) => str(rec(e.extensions).code) ?? "");
    if (codes.includes("RATELIMITED")) {
      const reset = Number(res.headers.get("x-ratelimit-requests-reset") ?? res.headers.get("x-ratelimit-complexity-reset"));
      const seconds = Number.isFinite(reset) && reset > Date.now() ? Math.ceil((reset - Date.now()) / 1000) : 60;
      return new ConnectorError("RATE_LIMITED", "linear rate limited", seconds);
    }
    if (codes.includes("AUTHENTICATION_ERROR")) return new ConnectorError("REAUTH_REQUIRED", "linear authentication");
    if (codes.includes("FORBIDDEN")) return new ConnectorError("FORBIDDEN", "linear forbidden");
    const text = errors.map((e) => `${str(e.message) ?? ""} ${str(rec(e.extensions).userPresentableMessage) ?? ""}`).join(" ");
    if (/not found|could not find|does not exist/i.test(text)) return new ConnectorError("NOT_FOUND", "linear entity not found");
    return new ConnectorError("BAD_RESPONSE", "linear graphql error");
  },
  webhook: {
    async verify({ raw, headers }) {
      const v = verifyLinear(raw, headers.get("linear-signature"), env("LINEAR_WEBHOOK_SECRET"), Date.now());
      if (!v.ok) return { ok: false };
      const id = headers.get("linear-delivery");
      return { ok: true, deliveryId: id && /^[A-Za-z0-9-]{1,100}$/.test(id) ? id : createHash("sha256").update(raw).digest("hex") };
    },
    route({ body }) {
      const b = rec(body);
      const tenantId = str(b.organizationId);
      if (!tenantId) return [];
      const type = str(b.type);
      if (type === "OAuthApp" && b.action === "revoked") return [{ by: "tenant", tenantId, revoked: true }];
      if (type === "Issue") {
        const id = str(rec(b.data).id);
        return id ? [{ by: "tenant", tenantId, externalId: id, kind: "issue" } satisfies WebhookRoute] : [];
      }
      return [];
    },
  },
  async revoke({ http, tokens }) {
    const token = tokens.refreshToken ?? tokens.accessToken;
    await http.request({ method: "POST", url: "https://api.linear.app/oauth/revoke", auth: "none", form: { token, token_type_hint: tokens.refreshToken ? "refresh_token" : "access_token" }, expect: "none" });
  },
};
