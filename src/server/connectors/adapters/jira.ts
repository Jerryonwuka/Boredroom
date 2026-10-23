/**
 * Jira (Atlassian Cloud) adapter (work group, owner decisions 22 October 2026: connectors; spec §2, §7, §8.6, §9).
 *
 * - OAuth 2.0 (3LO): `auth.atlassian.com/authorize` with `audience=api.atlassian.com` and `prompt=consent`, classic scopes,
 *   no PKCE (not documented for 3LO), JSON token body, rotating refresh tokens (`offline_access`). No revoke endpoint:
 *   the card tells the person where to remove Boredroom (Atlassian account › Connected apps).
 * - Workspace connections read the projects an owner selects with that owner's account; personal connections read the
 *   issues assigned to the person. `ownerBound: true`, `workspaceActs: false`: **changes need the person's own
 *   connection** (D10), so every action is offered to personal connections only.
 * - Sync: `POST /rest/api/3/search/jql` (`/search` is gone) with `nextPageToken`; "updated since" uses JQL's relative
 *   minutes (`updated >= "-90m"`), which don't depend on the Jira user's time zone. Every request spends points from the
 *   shared `jira:global` budget (50,000 of Atlassian's 65,000-an-hour Tier 1 pool); a global quota 429 pauses every Jira
 *   sync to the top of the hour.
 * - Webhooks: dynamic, `POST /rest/api/3/webhook` with a JQL filter, renewed before their 30 days, verified by the JWT
 *   (HS256, the client secret) in `Authorization`.
 * - Personal data reporting: the `report_accounts` maintenance (atlassian.ts).
 * Server-only.
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { env, envAll } from "../env";
import { safeEqual } from "../crypto";
import { hostAllowed } from "../http";
import { APP_READBACK } from "@/lib/connectors/words";
import {
  ConnectorError, type ActInput, type ActionSpec, type ConnectionRef, type HttpRequest, type HttpResponse, type NormalisedItem,
  type ProviderAdapter, type ProviderHttp, type SourceInfo, type TokenSet, type WebhookRoute,
} from "../types";
import { adfToText, reportAccounts, textToAdf } from "./atlassian";

const ENV = ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"] as const;
const APP = "Jira";
const API = "https://api.atlassian.com";
export const JIRA_READ_SCOPES = ["read:jira-work", "read:jira-user", "manage:jira-webhook", "offline_access"] as const;
export const JIRA_ACT_SCOPES = ["write:jira-work"] as const;
export const JIRA_BUDGET = { bucket: "jira:global", capPerHour: 50_000 } as const;
const FIELDS = ["summary", "status", "duedate", "priority", "assignee", "updated", "project", "issuetype"];
const PAGE_INC = 50;
const PAGE_OPEN = 100;
const OPEN_MAX = { personal: 500, workspace: 2000 } as const;
const OVERLAP_MS = 2 * 60_000;
const RECENT_AFTER_FULL_MS = 48 * 3600_000;
const MAX_LOOKBACK_MIN = 30 * 24 * 60;
const WEBHOOK_EVENTS = ["jira:issue_created", "jira:issue_updated", "jira:issue_deleted"];
const WEBHOOK_DAYS = 30;

// ---- Small helpers -------------------------------------------------------------------------------------------------------

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;
const NUMERIC = /^\d{1,20}$/;

/** Jira's "2026-10-21T09:12:33.000+0100" as ISO (a colon in the offset), or null. */
export function jiraTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(fixed);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Words for an adapter's refusal (Brenda passes them on as they are). Loaded lazily: actions.ts is the framework's. */
async function refuse(words: string): Promise<never> {
  const { ActRefusal } = await import("../actions");
  throw new ActRefusal(words);
}

const dueWords = (due: string) => new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** A name from Jira for a refusal: one line, plain characters, short. */
const plainName = (s: unknown) => String(s ?? "").replace(/[^\p{L}\p{N} .,'@_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);

function cloudOf(conn: ConnectionRef): string {
  const id = conn.externalTenantId;
  if (!id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new ConnectorError("NOT_FOUND", "jira connection has no site");
  return id;
}
const base = (conn: ConnectionRef) => `${API}/ex/jira/${cloudOf(conn)}/rest/api/3`;

/** The site's own address (for links), only an https *.atlassian.net one. */
function siteUrl(conn: ConnectionRef): string | null {
  const u = str(conn.settings?.siteUrl);
  return u && hostAllowed(u, ["*.atlassian.net"]) ? u.replace(/\/+$/, "") : null;
}

// ---- The global quota ---------------------------------------------------------------------------------------------------

/** Atlassian's global Tier 1 pool answered "spent": every Jira sync in this process waits for the top of the hour. */
let pausedUntil = 0;
/** Tests only. */
export function resetJiraPauseForTests(): void { pausedUntil = 0; }
const secondsToHour = (now: number) => Math.max(1, Math.ceil((Math.floor(now / 3600_000) * 3600_000 + 3600_000 - now) / 1000));

/** The shared budget marked spent for this hour, so web processes and other workers wait too (best effort). */
async function exhaustSharedBudget(): Promise<void> {
  try {
    const { withWorker } = await import("@/server/db");
    const { windowStart } = await import("../budget");
    await withWorker((db) => db.query(
      `INSERT INTO connector_rate_budget(bucket, window_start, used, cap) VALUES ($1, $2, $3, $3)
       ON CONFLICT (bucket, window_start) DO UPDATE SET used = GREATEST(connector_rate_budget.used, connector_rate_budget.cap)`,
      [JIRA_BUDGET.bucket, windowStart(new Date()), JIRA_BUDGET.capPerHour]));
  } catch {
    // The in-process pause still holds.
  }
}

/** Every Jira call: the global pause first, then the request; a global-quota answer spends the shared budget. */
async function call<T>(http: ProviderHttp, req: HttpRequest): Promise<HttpResponse<T>> {
  const now = Date.now();
  if (now < pausedUntil) throw new ConnectorError("RATE_LIMITED", "jira global quota paused", Math.ceil((pausedUntil - now) / 1000));
  const hit = pausedUntil;
  try {
    return await http.request<T>(req);
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "RATE_LIMITED" && pausedUntil > hit) await exhaustSharedBudget();
    throw err;
  }
}

// ---- Tokens -----------------------------------------------------------------------------------------------------------------

export function parseToken(body: unknown, now: Date): TokenSet {
  const b = rec(body);
  if (typeof b.error === "string") {
    throw new ConnectorError(b.error === "invalid_grant" || b.error === "unauthorized_client" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `atlassian token error ${b.error.slice(0, 40)}`);
  }
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "atlassian token missing");
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    tokenType: "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: null,
    scopes: typeof b.scope === "string" ? b.scope.split(/\s+/).filter(Boolean) : null,
  };
}

// ---- Items ----------------------------------------------------------------------------------------------------------------

const CANCEL_LIKE = /cancel|won'?t (do|fix)|declin|reject|abandon|obsolete|duplicate/i;
const PRIORITY: Record<string, 1 | 2 | 3 | 4> = { highest: 1, blocker: 1, critical: 1, high: 2, major: 2, medium: 3, low: 4, minor: 4, lowest: 4, trivial: 4 };

export function issueItem(conn: ConnectionRef, raw: unknown): NormalisedItem | null {
  const r = rec(raw);
  const id = str(r.id);
  const key = str(r.key);
  if (!id || !NUMERIC.test(id)) return null;
  const f = rec(r.fields);
  const status = rec(f.status);
  const category = str(rec(status.statusCategory).key);
  const statusName = str(status.name);
  const state = category === "done" ? (statusName && CANCEL_LIKE.test(statusName) ? "cancelled" : "done") : category === "indeterminate" ? "in_progress" : "open";
  const assignee = rec(f.assignee);
  const assigneeId = str(assignee.accountId);
  const project = rec(f.project);
  const site = siteUrl(conn);
  const due = str(f.duedate);
  const issueType = rec(f.issuetype);
  return {
    kind: "issue",
    subtype: str(issueType.name)?.toLowerCase() === "task" ? "task" : "issue",
    externalId: id,
    externalKey: key,
    url: site && key ? `${site}/browse/${encodeURIComponent(key)}` : null,
    title: str(f.summary) ?? key ?? "(untitled)",
    state,
    stateLabel: statusName,
    priority: PRIORITY[(str(rec(f.priority).name) ?? "").toLowerCase()] ?? null,
    sourceExternalId: str(project.id),
    containerLabel: str(project.name),
    assigneeExternalId: assigneeId,
    assigneeLabel: str(assignee.displayName),
    assigneeEmail: str(assignee.emailAddress),
    mine: conn.kind === "personal" && !!assigneeId && assigneeId === conn.externalAccountId,
    dueOn: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    providerUpdatedAt: jiraTime(f.updated),
  };
}

// ---- Sync -------------------------------------------------------------------------------------------------------------------

/** The cursor a chain of runs carries: the phase, Jira's page token, the watermark and the newest change seen. */
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

export function jqlFor(conn: ConnectionRef, selected: SourceInfo[], phase: "open" | "inc", since: string | null, now: Date): string | null {
  let who: string;
  if (conn.kind === "personal") who = "assignee = currentUser()";
  else {
    const ids = selected.filter((s) => s.kind === "project" && NUMERIC.test(s.externalId)).map((s) => s.externalId).slice(0, 200);
    if (!ids.length) return null;
    who = `project in (${ids.join(", ")})`;
  }
  if (phase === "open") return `${who} AND statusCategory != Done ORDER BY updated DESC`;
  const minutes = Math.min(MAX_LOOKBACK_MIN, Math.max(1, Math.ceil((now.getTime() - Date.parse(since ?? now.toISOString())) / 60_000)));
  return `${who} AND updated >= "-${minutes}m" ORDER BY updated DESC`;
}

// ---- Actions ----------------------------------------------------------------------------------------------------------------

const asWho = (c: ActInput<unknown>) => APP_READBACK.as.yourAccount(c.conn.accountLabel);
const needItem = (c: ActInput<unknown>) => {
  if (!c.item) throw new ConnectorError("NOT_FOUND", "no item");
  if (!NUMERIC.test(c.item.externalId)) throw new ConnectorError("NOT_FOUND", "not a jira issue id");
  return c.item;
};
const keyOf = (c: ActInput<unknown>) => needItem(c).externalKey ?? needItem(c).title;
const issueUrl = (c: ActInput<unknown>, id: string) => `${base(c.conn)}/issue/${encodeURIComponent(id)}`;

const createIssue: ActionSpec<{ title: string; text?: string }> = {
  name: "create_issue", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().max(4000).optional() }),
  async prepare(c) {
    if (!c.source || c.source.kind !== "project" || !NUMERIC.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no project");
    const place = c.source.label;
    return {
      risk: "shared", summary: APP_READBACK.create_issue.summary(APP, place), ...(c.input.text ? { detail: c.input.text } : {}),
      readback: { to: [APP_READBACK.create_issue.to(place, APP)], what: APP_READBACK.create_issue.what(c.input.title, asWho(c)) },
      appearsAs: asWho(c), place,
    };
  },
  async run(c) {
    if (!c.source || !NUMERIC.test(c.source.externalId)) throw new ConnectorError("NOT_FOUND", "no project");
    const project = rec((await call(c.http, { url: `${base(c.conn)}/project/${c.source.externalId}` })).body);
    const types = arr(project.issueTypes).map(rec).filter((t) => t.subtask !== true && str(t.id));
    const type = types.find((t) => str(t.name)?.toLowerCase() === "task") ?? types[0];
    if (!type) throw new ConnectorError("NOT_ALLOWED", "project has no issue type");
    const fields: Record<string, unknown> = { project: { id: c.source.externalId }, summary: c.input.title, issuetype: { id: String(type.id) } };
    if (c.input.text) fields.description = textToAdf(c.input.text);
    const made = rec((await call(c.http, { method: "POST", url: `${base(c.conn)}/issue`, json: { fields } })).body);
    const key = str(made.key);
    const site = siteUrl(c.conn);
    return { summary: `Created ${key ?? "the issue"} “${c.input.title}” in Jira`, href: site && key ? `${site}/browse/${encodeURIComponent(key)}` : null };
  },
};

const comment: ActionSpec<{ text: string }> = {
  name: "comment", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ text: z.string().trim().min(1).max(4000) }),
  async prepare(c) {
    const key = keyOf(c);
    return { risk: "shared", summary: APP_READBACK.comment.summary(key), detail: c.input.text, readback: { to: [APP_READBACK.comment.to(key, APP)], what: APP_READBACK.comment.what(asWho(c)) }, appearsAs: asWho(c) };
  },
  async run(c) {
    const i = needItem(c);
    await call(c.http, { method: "POST", url: `${issueUrl(c, i.externalId)}/comment`, json: { body: textToAdf(c.input.text) } });
    return { summary: `Commented on ${keyOf(c)}` };
  },
};

type Want = "todo" | "in_progress" | "done" | "cancelled";
const WANT_CATEGORY: Record<Want, string> = { todo: "new", in_progress: "indeterminate", done: "done", cancelled: "done" };

/** The first transition from where the issue is to a status of the wanted category (cancelled: a cancel-like done status). */
export function chooseTransition(transitions: unknown[], want: Want): { id: string; to: string } | null {
  const list = transitions.map(rec).map((t) => ({ id: str(t.id), to: str(rec(t.to).name), category: str(rec(rec(t.to).statusCategory).key), name: str(t.name) }))
    .filter((t) => t.id && t.to && t.category === WANT_CATEGORY[want]);
  const cancelLike = (t: { to: string | null; name: string | null }) => CANCEL_LIKE.test(t.to ?? "") || CANCEL_LIKE.test(t.name ?? "");
  const pick = want === "cancelled" ? list.find(cancelLike) : want === "done" ? list.find((t) => !cancelLike(t)) ?? null : list[0];
  return pick ? { id: pick.id!, to: pick.to! } : null;
}

async function transitionFor(c: ActInput<{ state: Want }>): Promise<{ id: string; to: string; from: string | null }> {
  const i = needItem(c);
  const [t, cur] = await Promise.all([
    call(c.http, { url: `${issueUrl(c, i.externalId)}/transitions` }),
    call(c.http, { url: issueUrl(c, i.externalId), query: { fields: "status" } }),
  ]);
  const chosen = chooseTransition(arr(rec(t.body).transitions), c.input.state);
  if (!chosen) {
    const words = { todo: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" }[c.input.state];
    return refuse(`Jira has no way to move ${keyOf(c)} to ${words} from where it is now. Change it in Jira itself.`);
  }
  return { ...chosen, from: str(rec(rec(rec(cur.body).fields).status).name) };
}

const setState: ActionSpec<{ state: Want }> = {
  name: "set_state", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ state: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  async prepare(c) {
    const key = keyOf(c);
    const t = await transitionFor(c);
    return {
      risk: c.input.state === "cancelled" ? "destructive" : "shared", summary: APP_READBACK.set_state.summary(key, t.to),
      readback: { to: [APP_READBACK.set_state.to(key, APP)], what: APP_READBACK.set_state.what(key, t.from, t.to) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const i = needItem(c);
    const t = await transitionFor(c);
    await call(c.http, { method: "POST", url: `${issueUrl(c, i.externalId)}/transitions`, json: { transition: { id: t.id } }, expect: "none" });
    return { summary: `Moved ${keyOf(c)} to ${t.to}`, item: await fetchIssue(c.conn, c.http, i.externalId) };
  },
};

/** "me", or one assignable person matched by email or exact display name; several or none is a refusal in words. */
async function assigneeFor(c: ActInput<{ assignee: string }>): Promise<{ accountId: string; name: string; me: boolean }> {
  const wanted = c.input.assignee.trim();
  if (wanted.toLowerCase() === "me") {
    if (!ACCOUNT.test(c.conn.externalAccountId)) throw new ConnectorError("NOT_FOUND", "no account id");
    return { accountId: c.conn.externalAccountId, name: "you", me: true };
  }
  const key = keyOf(c);
  const found = arr((await call(c.http, { url: `${base(c.conn)}/user/assignable/search`, query: { issueKey: key, query: wanted, maxResults: 20 } })).body).map(rec);
  const w = wanted.toLowerCase();
  const exact = found.filter((u) => str(u.accountId) && ACCOUNT.test(String(u.accountId)) && ((str(u.emailAddress) ?? "").toLowerCase() === w || (str(u.displayName) ?? "").toLowerCase() === w));
  if (exact.length === 1) return { accountId: String(exact[0].accountId), name: str(exact[0].displayName) ?? wanted, me: false };
  if (exact.length > 1) return refuse(`More than one person in Jira matches “${plainName(wanted)}”: ${exact.slice(0, 10).map((u) => plainName(u.displayName)).join(", ")}. Say their email address.`);
  const near = found.slice(0, 10).map((u) => plainName(u.displayName)).filter(Boolean);
  return refuse(near.length ? `I couldn't find exactly “${plainName(wanted)}” in Jira for ${key}. People it suggests: ${near.join(", ")}.` : `I couldn't find “${plainName(wanted)}” among the people who can be assigned ${key} in Jira.`);
}

const assign: ActionSpec<{ assignee: string }> = {
  name: "assign", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ assignee: z.string().trim().min(1).max(200) }),
  async prepare(c) {
    const key = keyOf(c);
    const who = await assigneeFor(c);
    return {
      risk: "shared", summary: APP_READBACK.assign.summary(key, who.name),
      readback: { to: [APP_READBACK.assign.toPerson(who.me ? "You" : who.name, APP), APP_READBACK.assign.to(key, APP)], what: APP_READBACK.assign.what(key, who.name) },
      appearsAs: asWho(c),
    };
  },
  async run(c) {
    const i = needItem(c);
    const who = await assigneeFor(c);
    await call(c.http, { method: "PUT", url: `${issueUrl(c, i.externalId)}/assignee`, json: { accountId: who.accountId }, expect: "none" });
    return { summary: `Assigned ${keyOf(c)} to ${who.name}`, item: await fetchIssue(c.conn, c.http, i.externalId) };
  },
};

const setDue: ActionSpec<{ due: string | null }> = {
  name: "set_due", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  async prepare(c) {
    const key = keyOf(c);
    return {
      risk: "shared", summary: APP_READBACK.set_due.summary(key),
      readback: { to: [APP_READBACK.set_due.to(key, APP)], what: APP_READBACK.set_due.what(key, c.input.due ? dueWords(c.input.due) : null) }, appearsAs: asWho(c),
    };
  },
  async run(c) {
    const i = needItem(c);
    await call(c.http, { method: "PUT", url: issueUrl(c, i.externalId), json: { fields: { duedate: c.input.due } }, expect: "none" });
    return { summary: c.input.due ? `Set ${keyOf(c)} due ${dueWords(c.input.due)}` : `Cleared ${keyOf(c)}'s due date`, item: await fetchIssue(c.conn, c.http, i.externalId) };
  },
};

async function fetchIssue(conn: ConnectionRef, http: ProviderHttp, id: string): Promise<NormalisedItem | null> {
  if (!NUMERIC.test(id)) return null;
  try {
    const r = await call(http, { url: `${base(conn)}/issue/${id}`, query: { fields: FIELDS.join(",") } });
    return issueItem(conn, r.body);
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

// ---- Webhooks ------------------------------------------------------------------------------------------------------------------

/** The JWT Jira signs a dynamic webhook delivery with (HS256, the app's client secret): signature and expiry. */
export function verifyJiraJwt(authorization: string | null, secret: string, nowMs: number): boolean {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(authorization ?? "");
  if (!m || !secret) return false;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch { return false; }
  if (header.alg !== "HS256") return false;
  const want = createHmac("sha256", secret).update(`${m[1]}.${m[2]}`).digest("base64url");
  if (!safeEqual(m[3], want)) return false;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs - 30_000) return false;
  if (typeof claims.iat === "number" && claims.iat * 1000 > nowMs + 5 * 60_000) return false;
  return true;
}

// ---- The adapter -----------------------------------------------------------------------------------------------------------------

export const adapter: ProviderAdapter = {
  id: "jira",
  category: "work",
  kinds: ["workspace", "personal"],
  hosts: ["api.atlassian.com", "auth.atlassian.com"],
  linkHosts: ["*.atlassian.net"],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    clientId: () => env("ATLASSIAN_CLIENT_ID"),
    clientSecret: () => env("ATLASSIAN_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "json",
    pkce: "none",
    scopeSeparator: " ",
    scopes: ({ act }) => [...JIRA_READ_SCOPES, ...(act ? JIRA_ACT_SCOPES : [])],
    authorizeParams: () => ({ audience: "api.atlassian.com", prompt: "consent" }),
    parseToken,
    refresh: "rotating",
  },
  async identify({ kind, http, tokens }) {
    const sites = arr((await call(http, { url: `${API}/oauth/token/accessible-resources` })).body).map(rec)
      .filter((s) => str(s.id) && arr(s.scopes).some((x) => typeof x === "string" && x.includes("jira")));
    const site = sites[0];
    if (!site) throw new ConnectorError("NOT_ALLOWED", "no_site: no Jira site among the accessible resources");
    const cloudId = String(site.id);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(cloudId)) throw new ConnectorError("BAD_RESPONSE", "odd cloud id");
    const url = str(site.url);
    const name = str(site.name) ?? "Jira";
    const me = rec((await call(http, { url: `${API}/ex/jira/${cloudId}/rest/api/3/myself` })).body);
    const accountId = str(me.accountId);
    if (!accountId || !ACCOUNT.test(accountId)) throw new ConnectorError("BAD_RESPONSE", "no account id");
    const settings = { siteUrl: url && hostAllowed(url, ["*.atlassian.net"]) ? url : null, siteName: name, ...(sites.length > 1 ? { public: { site: name } } : {}) };
    const email = str(me.emailAddress);
    return kind === "workspace"
      ? { externalAccountId: cloudId, externalTenantId: cloudId, accountLabel: `${name} (Jira)`, settings, scopes: tokens.scopes ?? undefined }
      : { externalAccountId: accountId, externalTenantId: cloudId, accountLabel: email ? `${email} on ${name}` : name, identity: { externalUserId: accountId, email }, settings, scopes: tokens.scopes ?? undefined };
  },
  ownerBound: true,
  workspaceActs: false,
  async sources({ conn, http }) {
    const out: SourceInfo[] = [];
    for (let page = 0, startAt = 0; page < 4; page++) {
      const r = rec((await call(http, { url: `${base(conn)}/project/search`, query: { maxResults: 50, orderBy: "name", startAt } })).body);
      const values = arr(r.values).map(rec);
      for (const p of values) {
        const id = str(p.id);
        if (!id || !NUMERIC.test(id)) continue;
        const key = str(p.key);
        out.push({ kind: "project", externalId: id, label: `${str(p.name) ?? key ?? id}${key ? ` (${key})` : ""}`, isPrivate: typeof p.isPrivate === "boolean" ? p.isPrivate : undefined, archived: p.archived === true });
      }
      if (r.isLast === true || !values.length) break;
      startAt += values.length;
    }
    return out;
  },
  streams: [
    { name: "issues", kinds: ["issue"], every: { workingMinutes: 30, offMinutes: 120 }, perRun: { pages: 10, items: 1000, ms: 15_000 }, fullEveryMinutes: 24 * 60 },
  ],
  async sync({ conn, http, cursor, full, now, sink, selected, deadline }) {
    let cur = readCursor(cursor, full, now);
    const startedOpenHere = cur.ph === "open" && !cur.pg;
    const openIds: string[] = [];
    const openMax = OPEN_MAX[conn.kind];
    for (let pages = 0; ; pages++) {
      if (pages >= 10 || Date.now() >= deadline) return { cursor: JSON.stringify(cur), more: true };
      const jql = jqlFor(conn, selected, cur.ph, cur.w, now);
      if (!jql) return { cursor: null, more: false }; // a workspace with nothing selected: nothing to read
      const maxResults = cur.ph === "open" ? PAGE_OPEN : PAGE_INC;
      const r = rec((await call(http, { method: "POST", url: `${base(conn)}/search/jql`, cost: 1 + maxResults, json: { jql, fields: FIELDS, maxResults, ...(cur.pg ? { nextPageToken: cur.pg } : {}) } })).body);
      const items = arr(r.issues).map((x) => issueItem(conn, x)).filter((x): x is NormalisedItem => !!x);
      await sink.upsert(items);
      for (const i of items) {
        cur.mx = newer(cur.mx, i.providerUpdatedAt ?? null);
        if (cur.ph === "open" && openIds.length < openMax && i.state !== "done" && i.state !== "cancelled") openIds.push(i.externalId);
      }
      const next = str(r.nextPageToken);
      if (next && r.isLast !== true && !(cur.ph === "open" && openIds.length >= openMax) && next.length <= 3000) { cur.pg = next; continue; }
      if (cur.ph === "open") {
        // A full reconciliation counts only when the whole open set was read in this one run.
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
    return fetchIssue(conn, http, externalId);
  },
  async fetchText({ conn, http, kind, externalId, maxChars }) {
    if (kind !== "issue" || !NUMERIC.test(externalId)) return null;
    const r = await call(http, { url: `${base(conn)}/issue/${externalId}`, query: { fields: "description" } });
    const text = adfToText(rec(rec(r.body).fields).description, maxChars);
    return text || null;
  },
  actions: [createIssue, comment, setState, assign, setDue],
  interpret(res) {
    if (res.status === 429) {
      const reason = res.headers.get("ratelimit-reason") ?? "";
      if (/global/i.test(reason)) {
        const now = Date.now();
        const seconds = secondsToHour(now);
        pausedUntil = Math.max(pausedUntil, now + seconds * 1000);
        return new ConnectorError("RATE_LIMITED", "jira global quota", seconds);
      }
    }
    return null;
  },
  webhook: {
    async verify({ raw, headers }) {
      if (!verifyJiraJwt(headers.get("authorization"), env("ATLASSIAN_CLIENT_SECRET"), Date.now())) return { ok: false };
      const id = headers.get("x-atlassian-webhook-identifier");
      return { ok: true, deliveryId: id && /^[A-Za-z0-9:_-]{1,200}$/.test(id) ? id : createHash("sha256").update(raw).digest("hex") };
    },
    route({ body, url }) {
      // Security fix, 22 October 2026: Jira's webhook ids are small numbers per site, so they never route on their own.
      // Each registration's URL carries Boredroom's own hook id (`?hook=`, env.hookUrlFor), which names exactly one
      // connection; the delivery's matchedWebhookIds must also include that hook's Jira id.
      const b = rec(body);
      const hook = url?.searchParams.get("hook") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hook)) return [];
      const matched = arr(b.matchedWebhookIds).map((x) => String(x)).filter((x) => NUMERIC.test(x)).slice(0, 20);
      if (!matched.length) return [];
      const issueId = str(rec(b.issue).id);
      const route: WebhookRoute = { by: "webhook", webhookId: hook, ours: true, matched };
      return [issueId && NUMERIC.test(issueId) ? { ...route, externalId: issueId, kind: "issue" } : route];
    },
  },
  async registerWebhooks({ conn, http, hookUrl, newHook }) {
    let jqlFilter: string;
    if (conn.kind === "personal") {
      if (!ACCOUNT.test(conn.externalAccountId)) return [];
      jqlFilter = `assignee = "${conn.externalAccountId}"`;
    } else {
      // Selection happens after connecting, so the workspace's hook covers the projects it can see now (bounded); the sink
      // drops anything from a project nobody selected, and the 30-minute sync covers projects made later.
      const projects = (await adapter.sources!({ conn, http })).filter((s) => !s.archived).slice(0, 100);
      if (!projects.length) return [];
      jqlFilter = `project in (${projects.map((p) => p.externalId).join(", ")})`;
    }
    const hookId = await newHook();
    const r = rec((await call(http, { method: "POST", url: `${base(conn)}/webhook`, json: { url: hookUrl(hookId), webhooks: [{ events: WEBHOOK_EVENTS, jqlFilter }] } })).body);
    const made = arr(r.webhookRegistrationResult).map(rec).find((x) => x.createdWebhookId !== undefined);
    if (!made) throw new ConnectorError("BAD_RESPONSE", "jira did not register the webhook");
    return [{ hookId, externalId: String(made.createdWebhookId), expiresAt: new Date(Date.now() + WEBHOOK_DAYS * 24 * 3600_000) }];
  },
  async renewWebhook({ conn, http, externalId }) {
    if (!NUMERIC.test(externalId)) return null;
    const r = rec((await call(http, { method: "PUT", url: `${base(conn)}/webhook/refresh`, json: { webhookIds: [Number(externalId)] } })).body);
    const t = jiraTime(r.expirationDate) ?? (typeof r.expirationDate === "number" ? new Date(r.expirationDate).toISOString() : null);
    return t ? new Date(t) : new Date(Date.now() + WEBHOOK_DAYS * 24 * 3600_000);
  },
  async deleteWebhook({ conn, http, externalId }) {
    if (!NUMERIC.test(externalId)) return;
    await call(http, { method: "DELETE", url: `${base(conn)}/webhook`, json: { webhookIds: [Number(externalId)] }, expect: "none" });
  },
  // No revoke endpoint for 3LO: the card names where to remove Boredroom (lib/connectors/providers/jira.ts `removeAt`).
  limits: { budget: { ...JIRA_BUDGET } },
  maintenance: [{ name: "report_accounts", everyHours: 168, run: async (c) => { await reportAccounts(c); } }],
};
