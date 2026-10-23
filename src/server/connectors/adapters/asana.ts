/**
 * Asana adapter (work group, owner decisions 22 October 2026: connectors; spec §2, §7, §8.8, §9).
 *
 * - OAuth 2.0 with PKCE (S256) and specific scopes (space-separated; Asana's re-requests are not additive, so the full set
 *   is always sent). Access tokens last an hour; the refresh token is long-lived and reusable. Revoke:
 *   `POST https://app.asana.com/-/oauth_revoke` with the refresh token.
 * - Workspace connections read the projects an owner selects with that owner's account; personal connections read the
 *   tasks assigned to the person. `ownerBound: true`, `workspaceActs: false`: **changes need the person's own connection**
 *   (D10), so every action is offered to personal connections only.
 * - Sync: `GET /tasks` with `modified_since` and `completed_since` (so a task finished since the last run shows as done),
 *   offset pagination, and a daily reconciliation of the open set.
 * - Webhooks (workspace projects): `POST /webhooks` with the `X-Hook-Secret` handshake echoed by Boredroom's webhook
 *   route, then `X-Hook-Signature` (hex HMAC-SHA256 of the raw body with that secret). Asana delivers at most once, so
 *   the regular sync carries on as well.
 * Server-only.
 */
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { env, envAll } from "../env";
import { safeEqual } from "../crypto";
import { APP_READBACK } from "@/lib/connectors/words";
import {
  ConnectorError, type ActInput, type ActionSpec, type ConnectionRef, type HttpResponse, type NormalisedItem, type ProviderAdapter,
  type SourceInfo, type TokenSet, type WebhookRoute,
} from "../types";

const ENV = ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"] as const;
const APP = "Asana";
export const ASANA_API = "https://app.asana.com/api/1.0";
export const ASANA_READ_SCOPES = ["openid", "email", "profile", "users:read", "workspaces:read", "projects:read", "tasks:read", "webhooks:read", "webhooks:write", "webhooks:delete"] as const;
export const ASANA_ACT_SCOPES = ["tasks:write", "stories:write"] as const;
const TASK_FIELDS = "name,completed,due_on,due_at,permalink_url,modified_at,assignee.name,assignee.email,projects.name,notes,resource_subtype";
const PAGE_INC = 50;
const PAGE_OPEN = 100;
const OPEN_MAX = { personal: 500, workspace: 2000 } as const;
const OVERLAP_MS = 2 * 60_000;
const RECENT_AFTER_FULL_MS = 48 * 3600_000;
const NOTES_MAX = 2000;
const MAX_WORKSPACES = 5;
const MAX_PROJECT_HOOKS = 20;
const GID = /^\d{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const dueWords = (due: string) => new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const plainName = (s: unknown) => String(s ?? "").replace(/[^\p{L}\p{N} .,'@_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60);
const data = (r: HttpResponse<unknown>) => rec(r.body).data;

async function refuse(words: string): Promise<never> {
  const { ActRefusal } = await import("../actions");
  throw new ActRefusal(words);
}

// ---- Tokens -----------------------------------------------------------------------------------------------------------------

export function parseToken(body: unknown, now: Date): TokenSet {
  const b = rec(body);
  if (typeof b.error === "string") throw new ConnectorError(b.error === "invalid_grant" || b.error === "unauthorized_client" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `asana token error ${b.error.slice(0, 40)}`);
  if (typeof b.access_token !== "string" || !b.access_token) throw new ConnectorError("BAD_RESPONSE", "asana token missing");
  const user = rec(b.data);
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    tokenType: "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null,
    refreshExpiresAt: null,
    scopes: typeof b.scope === "string" ? b.scope.split(/\s+/).filter(Boolean) : null,
    ...(str(user.gid) ? { facts: { userGid: str(user.gid) } } : {}),
  };
}

// ---- Items ------------------------------------------------------------------------------------------------------------------

export function taskItem(conn: ConnectionRef, raw: unknown, o: { project?: string } = {}): NormalisedItem | null {
  const t = rec(raw);
  const gid = str(t.gid);
  if (!gid || !GID.test(gid)) return null;
  const projects = arr(t.projects).map(rec).filter((p) => str(p.gid));
  // Listed from a selected project: that project is its source (a task can be in several).
  const project = o.project ? projects.find((p) => p.gid === o.project) ?? { gid: o.project } : projects[0] ?? null;
  const assignee = rec(t.assignee);
  const assigneeId = str(assignee.gid);
  const done = t.completed === true;
  const notes = str(t.notes);
  const due = str(t.due_on);
  return {
    kind: "issue",
    subtype: "task",
    externalId: gid,
    externalKey: null,
    url: str(t.permalink_url),
    title: str(t.name) ?? "(untitled task)",
    state: done ? "done" : "open",
    stateLabel: done ? "Completed" : t.resource_subtype === "milestone" ? "Milestone" : "Not completed",
    priority: null,
    sourceExternalId: project ? str(project.gid) : null,
    // Every project it is in: the sink keeps it only under a selected one (security fix, 22 October 2026).
    sourceCandidates: projects.map((p) => str(p.gid)).filter((g): g is string => !!g && GID.test(g)).slice(0, 50),
    containerLabel: project ? str(project.name) : null,
    assigneeExternalId: assigneeId,
    assigneeLabel: str(assignee.name),
    assigneeEmail: str(assignee.email),
    mine: conn.kind === "personal" && !!assigneeId && assigneeId === conn.externalAccountId,
    dueOn: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    dueAt: str(t.due_at),
    excerpt: notes ? notes.slice(0, NOTES_MAX) : null,
    providerUpdatedAt: str(t.modified_at),
  };
}

// ---- Sync -------------------------------------------------------------------------------------------------------------------

type Cursor = { ph: "open" | "inc"; i: number; w: string | null; pg: string | null; mx: string | null };
export function readCursor(cursor: string | null, full: boolean, now: Date): Cursor {
  let c: Partial<Cursor> | null = null;
  try { c = cursor ? (JSON.parse(cursor) as Partial<Cursor>) : null; } catch { c = null; }
  const valid = c && (c.ph === "open" || c.ph === "inc");
  if (valid && (c!.pg || c!.ph === "open" || (c!.i ?? 0) > 0)) return { ph: c!.ph!, i: Math.max(0, Math.floor(Number(c!.i ?? 0)) || 0), w: str(c!.w), pg: str(c!.pg), mx: str(c!.mx) };
  if (full) return { ph: "open", i: 0, w: null, pg: null, mx: null };
  return { ph: "inc", i: 0, w: (valid ? str(c!.w) : null) ?? new Date(now.getTime() - 30 * 24 * 3600_000).toISOString(), pg: null, mx: null };
}
const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** The Asana workspaces a personal connection reads (at most 5, from identify), its tenant first. */
function personalWorkspaces(conn: ConnectionRef): string[] {
  const listed = arr(conn.settings?.workspaces).map((w) => str(rec(w).gid)).filter((g): g is string => !!g && GID.test(g));
  const all = [...(conn.externalTenantId && GID.test(conn.externalTenantId) ? [conn.externalTenantId] : []), ...listed];
  return [...new Set(all)].slice(0, MAX_WORKSPACES);
}

export function unitsFor(conn: ConnectionRef, selected: SourceInfo[]): { kind: "workspace" | "project"; gid: string }[] {
  if (conn.kind === "personal") return personalWorkspaces(conn).map((gid) => ({ kind: "workspace", gid }));
  return selected.filter((s) => s.kind === "project" && GID.test(s.externalId)).slice(0, 100).map((s) => ({ kind: "project", gid: s.externalId }));
}

export function tasksQuery(unit: { kind: "workspace" | "project"; gid: string }, cur: Cursor): Record<string, string | number> {
  const q: Record<string, string | number> = unit.kind === "workspace" ? { assignee: "me", workspace: unit.gid } : { project: unit.gid };
  if (cur.ph === "open") Object.assign(q, { completed_since: "now", limit: PAGE_OPEN });
  else Object.assign(q, { completed_since: cur.w ?? "now", modified_since: cur.w ?? new Date().toISOString(), limit: PAGE_INC });
  q.opt_fields = TASK_FIELDS;
  if (cur.pg) q.offset = cur.pg;
  return q;
}

// ---- Actions (personal connections only) ------------------------------------------------------------------------------------

const asWho = (c: ActInput<unknown>) => APP_READBACK.as.yourAccount(c.conn.accountLabel);
const needItem = (c: ActInput<unknown>) => {
  if (!c.item || !GID.test(c.item.externalId)) throw new ConnectorError("NOT_FOUND", "no task");
  return c.item;
};
const keyOf = (c: ActInput<unknown>) => `“${needItem(c).title}”`;
const taskUrl = (c: ActInput<unknown>) => `${ASANA_API}/tasks/${needItem(c).externalId}`;

const createTask: ActionSpec<{ title: string; text?: string }> = {
  name: "create_issue", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().max(4000).optional() }),
  async prepare(c) {
    const place = c.source?.label ?? "My Tasks";
    if (c.source && (c.source.kind !== "project" || !GID.test(c.source.externalId))) throw new ConnectorError("NOT_FOUND", "no project");
    return {
      risk: "shared", summary: APP_READBACK.create_issue.summary(APP, place, true), ...(c.input.text ? { detail: c.input.text } : {}),
      readback: { to: [c.source ? APP_READBACK.create_issue.to(place, APP) : "You, in My Tasks"], what: APP_READBACK.create_issue.what(c.input.title, asWho(c), true) },
      appearsAs: asWho(c), place,
    };
  },
  async run(c) {
    const body: Record<string, unknown> = { name: c.input.title, ...(c.input.text ? { notes: c.input.text } : {}) };
    if (c.source) body.projects = [c.source.externalId];
    else {
      if (!c.conn.externalTenantId || !GID.test(c.conn.externalTenantId)) throw new ConnectorError("NOT_FOUND", "no workspace");
      Object.assign(body, { workspace: c.conn.externalTenantId, assignee: "me" });
    }
    const r = await c.http.request({ method: "POST", url: `${ASANA_API}/tasks`, query: { opt_fields: TASK_FIELDS }, json: { data: body } });
    const item = taskItem(c.conn, data(r), c.source ? { project: c.source.externalId } : {});
    return { summary: `Created the Asana task “${c.input.title}”`, href: item?.url ?? null, item };
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
    await c.http.request({ method: "POST", url: `${taskUrl(c)}/stories`, json: { data: { text: c.input.text } } });
    return { summary: `Commented on ${keyOf(c)}` };
  },
};

type Want = "todo" | "in_progress" | "done" | "cancelled";
const setState: ActionSpec<{ state: Want }> = {
  name: "set_state", tool: "work_item_action", kinds: ["personal"],
  input: z.object({ state: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  async prepare(c) {
    const key = keyOf(c);
    if (c.input.state === "in_progress") return refuse("Asana tasks are either completed or not, so there's no “in progress” to move it to.");
    if (c.input.state === "cancelled") return refuse("Asana has no cancelled tasks. Mark it completed, or delete it in Asana itself.");
    const now = rec(data(await c.http.request({ url: taskUrl(c), query: { opt_fields: "completed" } })));
    const from = now.completed === true ? "Completed" : "Not completed";
    const to = c.input.state === "done" ? "Completed" : "Not completed";
    return { risk: "shared", summary: APP_READBACK.set_state.summary(key, to), readback: { to: [APP_READBACK.set_state.to(key, APP)], what: APP_READBACK.set_state.what(key, from, to) }, appearsAs: asWho(c) };
  },
  async run(c) {
    if (c.input.state !== "done" && c.input.state !== "todo") return refuse("Asana tasks are either completed or not.");
    const r = await c.http.request({ method: "PUT", url: taskUrl(c), query: { opt_fields: TASK_FIELDS }, json: { data: { completed: c.input.state === "done" } } });
    return { summary: `Marked ${keyOf(c)} ${c.input.state === "done" ? "completed" : "not completed"}`, item: taskItem(c.conn, data(r)) };
  },
};

const EMAIL = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,255}\.[A-Za-z]{2,63}$/;

/** "me", a person by email (Asana looks them up), or one person whose name matches exactly in the task's workspace. */
async function assigneeFor(c: ActInput<{ assignee: string }>): Promise<{ value: string; name: string; me: boolean }> {
  const wanted = c.input.assignee.trim();
  if (wanted.toLowerCase() === "me") return { value: "me", name: "you", me: true };
  if (EMAIL.test(wanted)) {
    try {
      const u = rec(data(await c.http.request({ url: `${ASANA_API}/users/${encodeURIComponent(wanted)}`, query: { opt_fields: "name,email" } })));
      const gid = str(u.gid);
      if (gid && GID.test(gid)) return { value: gid, name: str(u.name) ?? wanted, me: gid === c.conn.externalAccountId };
    } catch (err) {
      if (!(err instanceof ConnectorError && (err.code === "NOT_FOUND" || err.code === "BAD_RESPONSE" || err.code === "FORBIDDEN"))) throw err;
    }
    return refuse(`I couldn't find ${plainName(wanted)} in Asana.`);
  }
  const task = rec(data(await c.http.request({ url: taskUrl(c), query: { opt_fields: "workspace" } })));
  const workspace = str(rec(task.workspace).gid);
  if (!workspace || !GID.test(workspace)) throw new ConnectorError("NOT_FOUND", "no workspace");
  const found = arr(data(await c.http.request({ url: `${ASANA_API}/workspaces/${workspace}/typeahead`, query: { resource_type: "user", query: wanted, count: 20, opt_fields: "name,email" } }))).map(rec);
  const exact = found.filter((u) => str(u.gid) && GID.test(String(u.gid)) && (str(u.name) ?? "").toLowerCase() === wanted.toLowerCase());
  if (exact.length === 1) return { value: String(exact[0].gid), name: str(exact[0].name) ?? wanted, me: exact[0].gid === c.conn.externalAccountId };
  if (exact.length > 1) return refuse(`More than one person in Asana is called “${plainName(wanted)}”. Say their email address.`);
  const near = found.slice(0, 10).map((u) => plainName(u.name)).filter(Boolean);
  return refuse(near.length ? `I couldn't find exactly “${plainName(wanted)}” in Asana. People it suggests: ${near.join(", ")}.` : `I couldn't find “${plainName(wanted)}” in Asana. Say their email address.`);
}

const assign: ActionSpec<{ assignee: string }> = {
  name: "assign", tool: "work_item_action", kinds: ["personal"],
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
    const r = await c.http.request({ method: "PUT", url: taskUrl(c), query: { opt_fields: TASK_FIELDS }, json: { data: { assignee: who.value } } });
    return { summary: `Assigned ${keyOf(c)} to ${who.name}`, item: taskItem(c.conn, data(r)) };
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
    // A due date replaces a due time; clearing clears both.
    const body = c.input.due ? { due_on: c.input.due } : { due_on: null, due_at: null };
    const r = await c.http.request({ method: "PUT", url: taskUrl(c), query: { opt_fields: TASK_FIELDS }, json: { data: body } });
    return { summary: c.input.due ? `Set ${keyOf(c)} due ${dueWords(c.input.due)}` : `Cleared ${keyOf(c)}'s due date`, item: taskItem(c.conn, data(r)) };
  },
};

// ---- Webhooks ----------------------------------------------------------------------------------------------------------------------

/** The hook id from Boredroom's own webhook path (`/api/connectors/webhooks/asana/<hook id>`). */
export function hookIdFrom(url: URL): string | null {
  const m = /\/webhooks\/asana\/([^/]+)\/?$/.exec(url.pathname);
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

/**
 * Which hook a verified delivery came through, handed from `verify` (which sees the URL) to `route` (which sees only the
 * body) by the body's digest, for up to 30 seconds. Identical bodies through two hooks each take one id, so both
 * connections are covered.
 * CONTRACT REQUEST (work group, 22 October 2026): pass the hook id (or the URL) to `webhook.route`; `route` already uses
 * `hookId` when the framework passes one.
 */
const handoff = new Map<string, { ids: string[]; at: number }>();
const HANDOFF_MS = 30_000;
const bodyKey = (body: unknown) => createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
function remember(body: unknown, hookId: string, now = Date.now()): void {
  for (const [k, v] of handoff) if (now - v.at > HANDOFF_MS) handoff.delete(k);
  const k = bodyKey(body);
  const e = handoff.get(k) ?? { ids: [], at: now };
  e.ids.push(hookId);
  e.at = now;
  handoff.set(k, e);
}
function takeHook(body: unknown): string | null {
  const k = bodyKey(body);
  const e = handoff.get(k);
  if (!e || Date.now() - e.at > HANDOFF_MS) { handoff.delete(k); return null; }
  const id = e.ids.shift() ?? null;
  if (!e.ids.length) handoff.delete(k);
  return id;
}

export function routeAsana(body: unknown, hookId: string | null): WebhookRoute[] {
  if (!hookId) return [];
  const events = arr(rec(body).events).map(rec);
  // A heartbeat (no events) still marks the hook alive and looks again.
  // `ours`: Boredroom's own hook id from the URL, never Asana's (security fix, 22 October 2026).
  if (!events.length) return [{ by: "webhook", webhookId: hookId, ours: true }];
  const tasks = [...new Set(events.filter((e) => rec(e.resource).resource_type === "task").map((e) => str(rec(e.resource).gid)).filter((g): g is string => !!g && GID.test(g)))];
  if (!tasks.length || tasks.length > 40) return [{ by: "webhook", webhookId: hookId, ours: true }];
  return tasks.map((gid) => ({ by: "webhook", webhookId: hookId, ours: true, externalId: gid, kind: "issue" }));
}

// ---- The adapter -------------------------------------------------------------------------------------------------------------------

export const adapter: ProviderAdapter = {
  id: "asana",
  category: "work",
  kinds: ["workspace", "personal"],
  hosts: ["app.asana.com"],
  linkHosts: ["app.asana.com"],
  env: ENV,
  configured: (e) => envAll(ENV, e ?? process.env),
  oauth: {
    authorizeUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    clientId: () => env("ASANA_CLIENT_ID"),
    clientSecret: () => env("ASANA_CLIENT_SECRET"),
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: " ",
    scopes: ({ act }) => [...ASANA_READ_SCOPES, ...(act ? ASANA_ACT_SCOPES : [])],
    parseToken,
    refresh: "reusable",
  },
  async identify({ kind, http, tokens }) {
    const me = rec(data(await http.request({ url: `${ASANA_API}/users/me`, query: { opt_fields: "gid,email,name,workspaces.name" } })));
    const gid = str(me.gid);
    if (!gid || !GID.test(gid)) throw new ConnectorError("BAD_RESPONSE", "asana user missing");
    const workspaces = arr(me.workspaces).map(rec).filter((w) => str(w.gid) && GID.test(String(w.gid))).slice(0, MAX_WORKSPACES)
      .map((w) => ({ gid: String(w.gid), name: str(w.name) ?? "Asana" }));
    const first = workspaces[0];
    if (!first) throw new ConnectorError("NOT_ALLOWED", "no_site: the Asana account has no workspace");
    const email = str(me.email);
    const scopes = tokens.scopes ?? undefined;
    if (kind === "workspace") {
      // The first workspace (the card names it when there were several).
      return { externalAccountId: first.gid, externalTenantId: first.gid, accountLabel: `${first.name} (Asana)`, settings: { workspaces, ...(workspaces.length > 1 ? { public: { workspace: first.name } } : {}) }, scopes };
    }
    return { externalAccountId: gid, externalTenantId: first.gid, accountLabel: email ?? str(me.name) ?? "Asana", identity: { externalUserId: gid, email }, settings: { workspaces }, scopes };
  },
  ownerBound: true,
  workspaceActs: false,
  async sources({ conn, http }) {
    const workspace = conn.externalTenantId;
    if (!workspace || !GID.test(workspace)) return [];
    const out: SourceInfo[] = [];
    let offset: string | null = null;
    for (let page = 0; page < 5; page++) {
      const r = await http.request({ url: `${ASANA_API}/projects`, query: { workspace, archived: false, limit: 100, opt_fields: "name,archived,public", ...(offset ? { offset } : {}) } });
      for (const p of arr(data(r)).map(rec)) {
        const g = str(p.gid);
        if (g && GID.test(g)) out.push({ kind: "project", externalId: g, label: str(p.name) ?? g, isPrivate: typeof p.public === "boolean" ? !p.public : undefined, archived: p.archived === true });
      }
      offset = str(rec(rec(r.body).next_page).offset);
      if (!offset) break;
    }
    return out;
  },
  streams: [
    { name: "issues", kinds: ["issue"], every: { workingMinutes: 15, offMinutes: 120 }, perRun: { pages: 10, items: 1000, ms: 15_000 }, fullEveryMinutes: 24 * 60 },
  ],
  async sync({ conn, http, cursor, full, now, sink, selected, deadline }) {
    let cur = readCursor(cursor, full, now);
    const startedOpenHere = cur.ph === "open" && !cur.pg && cur.i === 0;
    const openIds: string[] = [];
    const openMax = OPEN_MAX[conn.kind];
    const units = unitsFor(conn, selected);
    if (!units.length) return { cursor: null, more: false };
    for (let pages = 0; ; pages++) {
      if (pages >= 10 || Date.now() >= deadline) return { cursor: JSON.stringify(cur), more: true };
      if (cur.i >= units.length) cur.i = units.length - 1;
      const unit = units[cur.i];
      const r = await http.request({ url: `${ASANA_API}/tasks`, query: tasksQuery(unit, cur) });
      const items = arr(data(r)).map((t) => taskItem(conn, t, unit.kind === "project" ? { project: unit.gid } : {})).filter((x): x is NormalisedItem => !!x)
        .map((i) => (unit.kind === "workspace" ? { ...i, mine: true } : i));
      await sink.upsert(items);
      for (const i of items) {
        cur.mx = newer(cur.mx, i.providerUpdatedAt ?? null);
        if (cur.ph === "open" && openIds.length < openMax && i.state !== "done") openIds.push(i.externalId);
      }
      const next = str(rec(rec(r.body).next_page).offset);
      if (next && next.length <= 3000 && !(cur.ph === "open" && openIds.length >= openMax)) { cur.pg = next; continue; }
      cur.pg = null;
      if (cur.i + 1 < units.length) { cur.i++; continue; }
      cur.i = 0;
      if (cur.ph === "open") {
        if (startedOpenHere) await sink.reconcileOpen("issue", openIds);
        cur = { ph: "inc", i: 0, w: new Date(now.getTime() - RECENT_AFTER_FULL_MS).toISOString(), pg: null, mx: cur.mx };
        continue;
      }
      const mx = cur.mx ? new Date(Date.parse(cur.mx) - OVERLAP_MS).toISOString() : null;
      return { cursor: JSON.stringify({ ph: "inc", i: 0, w: newer(cur.w, mx), pg: null, mx: null }), more: false };
    }
  },
  async fetchItem({ conn, http, kind, externalId }) {
    if (kind !== "issue" || !GID.test(externalId)) return null;
    try {
      return taskItem(conn, data(await http.request({ url: `${ASANA_API}/tasks/${externalId}`, query: { opt_fields: TASK_FIELDS } })));
    } catch (err) {
      if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null;
      throw err;
    }
  },
  async fetchText({ http, kind, externalId, maxChars }) {
    if (kind !== "issue" || !GID.test(externalId)) return null;
    const t = rec(data(await http.request({ url: `${ASANA_API}/tasks/${externalId}`, query: { opt_fields: "notes" } })));
    const notes = str(t.notes);
    return notes ? notes.slice(0, Math.min(maxChars, NOTES_MAX)) : null;
  },
  actions: [createTask, comment, setState, assign, setDue],
  interpret(res) {
    // 402: a feature of a paid Asana plan the workspace doesn't have.
    if (res.status === 402) return new ConnectorError("FORBIDDEN", "asana payment required");
    return null;
  },
  webhook: {
    async verify({ raw, headers, url, secretFor, saveSecret }) {
      const hookId = hookIdFrom(url);
      if (!hookId) return { ok: false };
      const handshake = headers.get("x-hook-secret");
      if (handshake) {
        // Asana's handshake while Boredroom registers the hook: seal the secret into that pending hook (once), echo it.
        if (!/^[A-Za-z0-9_-]{8,200}$/.test(handshake) || !(await saveSecret(hookId, handshake))) return { ok: false };
        return { ok: true, deliveryId: `handshake:${hookId}`, reply: new Response(null, { status: 200, headers: { "X-Hook-Secret": handshake } }) };
      }
      // The delivery's shape before its hook's stored secret is looked up (owner request, 23 October 2026: realtime plan,
      // phase 0): a missing or malformed signature, or an empty body, never reaches the database.
      const sig = headers.get("x-hook-signature") ?? "";
      if (!/^[0-9a-f]{64}$/i.test(sig) || raw.byteLength === 0) return { ok: false };
      const secret = await secretFor(hookId);
      if (!secret) return { ok: false };
      if (!safeEqual(sig.toLowerCase(), createHmac("sha256", secret).update(raw).digest("hex"))) return { ok: false };
      let body: unknown = null;
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return { ok: false }; }
      remember(body, hookId);
      // No delivery id from Asana: the body through this hook, per 10 minutes (heartbeats repeat the same body).
      const bucket = Math.floor(Date.now() / 600_000);
      return { ok: true, deliveryId: createHash("sha256").update(`${hookId}:${bucket}:`).update(raw).digest("hex") };
    },
    route(c: { body: unknown; headers: Headers; hookId?: string }) {
      const hookId = c.hookId && UUID.test(c.hookId) ? c.hookId : takeHook(c.body);
      return routeAsana(c.body, hookId);
    },
  },
  async registerWebhooks({ conn, http, hookUrl, newHook, selected }) {
    if (conn.kind !== "workspace") return [];
    // Hooks only on the projects the workspace selected (security fix, 22 October 2026); the framework runs this again
    // when the selection changes (connections.setSources), and Boredroom's hooks on projects no longer selected go.
    // A project that already has a live hook to Boredroom keeps it (the framework re-registers a connection when one of
    // its hooks has been silent for a day), so hooks are never doubled.
    const chosen = new Set((selected ?? []).filter((p) => p.kind === "project" && GID.test(p.externalId) && !p.archived).map((p) => p.externalId));
    const ours = hookUrl("00000000-0000-0000-0000-000000000000").replace(/[0-9a-f-]{36}$/, "");
    const live = new Set<string>();
    if (conn.externalTenantId && GID.test(conn.externalTenantId)) {
      const existing = await http.request({ url: `${ASANA_API}/webhooks`, query: { workspace: conn.externalTenantId, limit: 100, opt_fields: "active,resource,target" } });
      for (const w of arr(data(existing)).map(rec)) {
        const target = str(w.target) ?? "";
        const resource = str(rec(w.resource).gid);
        const gid = str(w.gid);
        if (!resource || !ours || !target.startsWith(ours)) continue;
        if (!chosen.has(resource)) {
          // Ours, on a project nobody selected any more: removed at Asana (best effort).
          if (gid && GID.test(gid)) await http.request({ method: "DELETE", url: `${ASANA_API}/webhooks/${gid}`, expect: "none" }).catch(() => undefined);
          continue;
        }
        if (w.active === true) live.add(resource);
      }
    }
    if (!chosen.size) return [];
    const projects = (await adapter.sources!({ conn, http })).filter((p) => chosen.has(p.externalId) && !p.archived && !live.has(p.externalId)).slice(0, Math.max(0, MAX_PROJECT_HOOKS - live.size));
    const out: { hookId: string; externalId: string; expiresAt: Date | null }[] = [];
    for (const p of projects) {
      const hookId = await newHook();
      try {
        const r = await http.request({
          method: "POST", url: `${ASANA_API}/webhooks`, timeoutMs: 20_000,
          json: { data: { resource: p.externalId, target: hookUrl(hookId), filters: ["added", "changed", "removed", "deleted", "undeleted"].map((action) => ({ resource_type: "task", action })) } },
        });
        const gid = str(rec(data(r)).gid);
        if (gid) out.push({ hookId, externalId: gid, expiresAt: null });
      } catch (err) {
        if (err instanceof ConnectorError && (err.code === "RATE_LIMITED" || err.code === "REAUTH_REQUIRED")) throw err;
        // One project refusing (permissions, a limit) leaves the others; its pending row is never activated.
      }
    }
    return out;
  },
  async deleteWebhook({ http, externalId }) {
    if (!GID.test(externalId)) return;
    await http.request({ method: "DELETE", url: `${ASANA_API}/webhooks/${externalId}`, expect: "none" });
  },
  async revoke({ http, tokens }) {
    await http.request({
      method: "POST", url: "https://app.asana.com/-/oauth_revoke", auth: "none", expect: "none",
      form: { client_id: env("ASANA_CLIENT_ID"), client_secret: env("ASANA_CLIENT_SECRET"), token: tokens.refreshToken ?? tokens.accessToken },
    });
  },
};
