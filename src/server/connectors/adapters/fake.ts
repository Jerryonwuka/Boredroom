/**
 * The pretend provider (framework, owner decisions 22 October 2026: connectors; spec §8.9). Offered only with
 * CONNECTORS_FAKE=1 outside production. Its "API" is answered inside this process (http.ts registerInProcessHost), so
 * the whole framework (OAuth with PKCE and state, sealed tokens, refresh, sync, webhooks, Brenda's tools and posting)
 * runs through the same code paths as a real provider, without a network or an account. Deterministic: today's events
 * 10:00–10:30 "Design review" and 14:00–15:00 "Planning" in the person's zone; issues TEST-1 "Fix the login loop" and
 * TEST-2 "Write the release notes"; one channel "#test"; every action in memory, with the real risk classes.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { registerInProcessHost } from "../http";
import { appOrigin, fakeEnabled, redirectUri } from "../env";
import { safeEqual } from "../crypto";
import { localDate, localTimeOn, addDays } from "@/server/lib/time";
import { APP_READBACK } from "@/lib/connectors/words";
import { members as membersWords } from "@/lib/confirm-readback";
import { ConnectorError, type ActInput, type ActionSpec, type NormalisedItem, type Prepared, type ProviderAdapter, type TokenSet } from "../types";

export const FAKE_HOST = "fake.connectors.invalid";
const API = `https://${FAKE_HOST}`;
/** The fake's webhook signing secret (not a secret: development and tests only). */
export const FAKE_WEBHOOK_SECRET = "fake-webhook-secret-for-development-only";

// ---- The pretend server -------------------------------------------------------------------------------------------------

type FakeIssue = { id: string; key: string; title: string; state: "open" | "in_progress" | "done" | "cancelled"; stateLabel: string; assignee: string | null; due: string | null; updated: string; comments: string[]; project: string };
type FakeEvent = { id: string; title: string; start: string; end: string; guests: number; organiser: boolean; response: string; online: boolean; private?: boolean };

/** What the pretend server holds (tests read and reset it). */
export const fakeServer = {
  issues: new Map<string, FakeIssue>(),
  blocks: new Map<string, FakeEvent>(),
  posts: [] as { channel: string; text: string }[],
  revoked: [] as string[],
  calls: [] as string[],
  /** Tests: the next token or API call answers this status once. */
  failNext: null as null | { path: string; status: number; retryAfter?: number },
  tokens: new Map<string, { kind: string; act: boolean; refresh: string; expiresAt: number }>(),
  reset() {
    this.issues.clear();
    this.blocks.clear();
    this.posts.length = 0;
    this.revoked.length = 0;
    this.calls.length = 0;
    this.failNext = null;
    this.tokens.clear();
    seedIssues();
  },
};

function seedIssues() {
  const at = new Date(Date.UTC(2026, 9, 20, 9, 0)).toISOString();
  fakeServer.issues.set("i-1", { id: "i-1", key: "TEST-1", title: "Fix the login loop", state: "in_progress", stateLabel: "In progress", assignee: "fake-user", due: null, updated: at, comments: [], project: "TEST" });
  fakeServer.issues.set("i-2", { id: "i-2", key: "TEST-2", title: "Write the release notes", state: "open", stateLabel: "To do", assignee: "fake-user", due: null, updated: at, comments: [], project: "TEST" });
}
seedIssues();

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

let counter = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(++counter).toString(36)}`;

function bodyOf(init: RequestInit): Record<string, unknown> {
  const b = init.body;
  if (typeof b !== "string" || !b) return {};
  if (b.trim().startsWith("{")) { try { return JSON.parse(b) as Record<string, unknown>; } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(b).entries());
}

function issueOut(i: FakeIssue) {
  return { ...i, url: `${API}/issues/${i.key}` };
}

async function handle(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const path = url.pathname;
  fakeServer.calls.push(`${method} ${path}`);
  if (fakeServer.failNext && path.startsWith(fakeServer.failNext.path)) {
    const f = fakeServer.failNext;
    fakeServer.failNext = null;
    return json(f.status, { error: f.status === 401 ? "invalid_token" : "fail" }, f.retryAfter ? { "retry-after": String(f.retryAfter) } : {});
  }
  const b = bodyOf(init);
  if (path === "/oauth/token" && method === "POST") {
    if (b.grant_type === "authorization_code") {
      const m = /^fake-(workspace|personal)-([01])$/.exec(String(b.code ?? ""));
      if (!m) return json(400, { error: "invalid_grant" });
      const access = nextId("fa"); const refresh = nextId("fr");
      fakeServer.tokens.set(access, { kind: m[1], act: m[2] === "1", refresh, expiresAt: Date.now() + 3600_000 });
      return json(200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "bearer", scope: m[2] === "1" ? "read write" : "read" });
    }
    if (b.grant_type === "refresh_token") {
      const found = [...fakeServer.tokens.entries()].find(([, t]) => t.refresh === b.refresh_token);
      if (!found || fakeServer.revoked.includes(String(b.refresh_token))) return json(400, { error: "invalid_grant" });
      fakeServer.tokens.delete(found[0]);
      const access = nextId("fa"); const refresh = nextId("fr");
      fakeServer.tokens.set(access, { ...found[1], refresh, expiresAt: Date.now() + 3600_000 });
      return json(200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "bearer", scope: found[1].act ? "read write" : "read" });
    }
    return json(400, { error: "unsupported_grant_type" });
  }
  if (path === "/oauth/revoke" && method === "POST") {
    fakeServer.revoked.push(String(b.token ?? ""));
    return json(200, { ok: true });
  }
  const auth = new Headers(init.headers).get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  // Tokens minted by an earlier process run are accepted (development restarts); an unknown token in tests is refused.
  if (!token || (process.env.NODE_ENV === "test" && !fakeServer.tokens.has(token))) return json(401, { error: "invalid_token" });
  if (path === "/me") return json(200, { id: "fake-user", name: "Test person", email: "test.person@example.com", team: { id: "fake-team", name: "Test team" } });
  if (path === "/sources") return json(200, { sources: [{ kind: "channel", id: "C-TEST", label: "#test", members: 3, private: false }, { kind: "project", id: "P-TEST", label: "TEST" }] });
  if (path === "/events") {
    const tz = url.searchParams.get("tz") ?? "UTC";
    const day = url.searchParams.get("date") ?? localDate(new Date(), tz);
    const ev = (id: string, title: string, s: string, e: string, guests: number): FakeEvent => ({ id: `${id}-${day}`, title, start: localTimeOn(day, s, tz).toISOString(), end: localTimeOn(day, e, tz).toISOString(), guests, organiser: id === "e-plan", response: id === "e-plan" ? "organiser" : "accepted", online: id === "e-design" });
    const events = [ev("e-design", "Design review", "10:00", "10:30", 4), ev("e-plan", "Planning", "14:00", "15:00", 3), ...[...fakeServer.blocks.values()]];
    return json(200, { events });
  }
  if (path === "/issues" && method === "GET") return json(200, { issues: [...fakeServer.issues.values()].map(issueOut) });
  if (path === "/issues" && method === "POST") {
    const n = fakeServer.issues.size + 1;
    const i: FakeIssue = { id: nextId("i"), key: `TEST-${n}`, title: String(b.title ?? "Untitled"), state: "open", stateLabel: "To do", assignee: null, due: null, updated: new Date().toISOString(), comments: [], project: String(b.project ?? "TEST") };
    fakeServer.issues.set(i.id, i);
    return json(201, issueOut(i));
  }
  const issue = /^\/issues\/([^/]+)(\/comments)?$/.exec(path);
  if (issue) {
    const i = fakeServer.issues.get(decodeURIComponent(issue[1]));
    if (!i) return json(404, { error: "not_found" });
    if (issue[2] && method === "POST") { i.comments.push(String(b.text ?? "")); i.updated = new Date().toISOString(); return json(201, { ok: true }); }
    if (method === "PATCH") {
      if (typeof b.state === "string") { i.state = b.state as FakeIssue["state"]; i.stateLabel = ({ open: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" } as Record<string, string>)[b.state] ?? b.state; }
      if ("assignee" in b) i.assignee = (b.assignee as string | null) ?? null;
      if ("due" in b) i.due = (b.due as string | null) ?? null;
      i.updated = new Date().toISOString();
      return json(200, issueOut(i));
    }
    return json(200, issueOut(i));
  }
  if (path === "/blocks" && method === "POST") {
    const e: FakeEvent = { id: nextId("b"), title: String(b.title ?? "Busy"), start: String(b.start), end: String(b.end), guests: Array.isArray(b.guests) ? b.guests.length : 0, organiser: true, response: "organiser", online: false, private: !(Array.isArray(b.guests) && b.guests.length) };
    fakeServer.blocks.set(e.id, e);
    return json(201, e);
  }
  const block = /^\/blocks\/([^/]+)$/.exec(path);
  if (block) {
    const e = fakeServer.blocks.get(decodeURIComponent(block[1]));
    if (method === "DELETE") { if (!e) return json(404, { error: "not_found" }); fakeServer.blocks.delete(e.id); return new Response(null, { status: 204 }); }
    if (method === "PATCH") { if (!e) return json(404, { error: "not_found" }); e.start = String(b.start ?? e.start); e.end = String(b.end ?? e.end); return json(200, e); }
  }
  if (path === "/rsvp" && method === "POST") return json(200, { ok: true });
  if (path === "/post" && method === "POST") {
    if (b.channel !== "C-TEST") return json(200, { ok: false, error: "not_in_channel" });
    fakeServer.posts.push({ channel: String(b.channel), text: String(b.text ?? "") });
    return json(200, { ok: true, ts: String(Date.now()) });
  }
  return json(404, { error: "not_found" });
}

registerInProcessHost(FAKE_HOST, handle);

// ---- The adapter ---------------------------------------------------------------------------------------------------------

const parseToken = (body: unknown, now: Date): TokenSet => {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.error === "string") throw new ConnectorError(b.error === "invalid_grant" ? "REAUTH_REQUIRED" : "BAD_RESPONSE", `fake token error ${b.error}`);
  if (typeof b.access_token !== "string") throw new ConnectorError("BAD_RESPONSE", "fake token missing");
  return {
    accessToken: b.access_token, refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null, tokenType: "bearer",
    expiresAt: typeof b.expires_in === "number" ? new Date(now.getTime() + b.expires_in * 1000) : null, refreshExpiresAt: null,
    scopes: typeof b.scope === "string" ? b.scope.split(" ").filter(Boolean) : null,
  };
};

function issueItem(i: Record<string, unknown>): NormalisedItem {
  return {
    kind: "issue", subtype: "issue", externalId: String(i.id), externalKey: String(i.key), url: String(i.url), title: String(i.title),
    state: i.state as NormalisedItem["state"], stateLabel: String(i.stateLabel), containerLabel: String(i.project ?? "TEST"), sourceExternalId: "P-TEST",
    assigneeExternalId: (i.assignee as string | null) ?? null, assigneeLabel: i.assignee ? "Test person" : null, assigneeEmail: i.assignee ? "test.person@example.com" : null,
    mine: i.assignee === "fake-user", dueOn: (i.due as string | null) ?? null, providerUpdatedAt: String(i.updated), excerpt: `Pretend description of ${String(i.key)}.`,
  };
}

function eventItem(e: FakeEvent): NormalisedItem {
  return {
    kind: "event", externalId: e.id, title: e.title, startsAt: e.start, endsAt: e.end, allDay: false, busy: true,
    response: e.response as NormalisedItem["response"], online: e.online, guests: e.guests, url: `${API}/events/${encodeURIComponent(e.id)}`, mine: true,
  };
}

const as = (c: ActInput<unknown>) => (c.conn.kind === "workspace" ? APP_READBACK.as.workspaceApp(c.actor.firstName, c.actor.assistantName) : APP_READBACK.as.yourAccount(c.conn.accountLabel));
const signed = (c: ActInput<unknown>, text: string) => (c.conn.kind === "workspace" ? `${text}\n\nFrom ${c.actor.firstName} via ${c.actor.assistantName}` : text);
const when = (iso: string, tz: string) => new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const needItem = (c: ActInput<unknown>) => { if (!c.item) throw new ConnectorError("NOT_FOUND", "no item"); return c.item; };

const post: ActionSpec<{ text: string }> = {
  name: "post", tool: "post_to_channel", kinds: ["workspace"], input: z.object({ text: z.string().trim().min(1).max(3000) }),
  async prepare(c) {
    if (!c.source) throw new ConnectorError("NOT_FOUND", "no channel");
    const place = c.source.label;
    return { risk: "shared", summary: APP_READBACK.post.summary(place, "Test app"), detail: signed(c, c.input.text), readback: { to: [APP_READBACK.post.to(place, "Test app", membersWords(c.source.members))], what: APP_READBACK.post.what(as(c)) }, appearsAs: as(c), place, people: c.source.members };
  },
  async run(c) {
    const r = await c.http.request<{ ok: boolean; error?: string }>({ method: "POST", url: `${API}/post`, json: { channel: c.source?.externalId, text: signed(c, c.input.text) } });
    if (!r.body.ok) throw new ConnectorError("NOT_ALLOWED", `fake post refused: ${r.body.error ?? "unknown"}`);
    return { summary: `Posted in ${c.source?.label ?? "the channel"}` };
  },
};

const createIssue: ActionSpec<{ title: string; text?: string }> = {
  name: "create_issue", tool: "work_item_action", kinds: ["workspace", "personal"], input: z.object({ title: z.string().trim().min(1).max(200), text: z.string().max(4000).optional() }),
  async prepare(c) {
    const place = c.source?.label ?? "TEST";
    return { risk: "shared", summary: APP_READBACK.create_issue.summary("Test app", place), detail: c.input.text ? signed(c, c.input.text) : undefined, readback: { to: [APP_READBACK.create_issue.to(place, "Test app")], what: APP_READBACK.create_issue.what(c.input.title, as(c)) }, appearsAs: as(c), place };
  },
  async run(c) {
    const r = await c.http.request<Record<string, unknown>>({ method: "POST", url: `${API}/issues`, json: { title: c.input.title, text: c.input.text ? signed(c, c.input.text) : "", project: c.source?.externalId ?? "P-TEST" } });
    return { summary: `Created ${String(r.body.key)} “${c.input.title}”`, item: issueItem(r.body), href: null };
  },
};

const comment: ActionSpec<{ text: string }> = {
  name: "comment", tool: "work_item_action", kinds: ["workspace", "personal"], input: z.object({ text: z.string().trim().min(1).max(4000) }),
  async prepare(c) {
    const i = needItem(c); const key = i.externalKey ?? i.title;
    return { risk: "shared", summary: APP_READBACK.comment.summary(key), detail: signed(c, c.input.text), readback: { to: [APP_READBACK.comment.to(key, "Test app")], what: APP_READBACK.comment.what(as(c)) }, appearsAs: as(c) };
  },
  async run(c) {
    const i = needItem(c);
    await c.http.request({ method: "POST", url: `${API}/issues/${encodeURIComponent(i.externalId)}/comments`, json: { text: signed(c, c.input.text) } });
    return { summary: `Commented on ${i.externalKey ?? i.title}` };
  },
};

const STATE_WORDS = { todo: "To do", in_progress: "In progress", done: "Done", cancelled: "Cancelled" } as const;
const STATE_TO = { todo: "open", in_progress: "in_progress", done: "done", cancelled: "cancelled" } as const;
const setState: ActionSpec<{ state: keyof typeof STATE_WORDS }> = {
  name: "set_state", tool: "work_item_action", kinds: ["workspace", "personal"], input: z.object({ state: z.enum(["todo", "in_progress", "done", "cancelled"]) }),
  async prepare(c) {
    const i = needItem(c); const key = i.externalKey ?? i.title; const to = STATE_WORDS[c.input.state];
    return { risk: c.input.state === "cancelled" ? "destructive" : "shared", summary: APP_READBACK.set_state.summary(key, to), readback: { to: [APP_READBACK.set_state.to(key, "Test app")], what: APP_READBACK.set_state.what(key, null, to) }, appearsAs: as(c) };
  },
  async run(c) {
    const i = needItem(c);
    const r = await c.http.request<Record<string, unknown>>({ method: "PATCH", url: `${API}/issues/${encodeURIComponent(i.externalId)}`, json: { state: STATE_TO[c.input.state] } });
    return { summary: `Moved ${i.externalKey ?? i.title} to ${STATE_WORDS[c.input.state]}`, item: issueItem(r.body) };
  },
};

const assign: ActionSpec<{ assignee: string }> = {
  name: "assign", tool: "work_item_action", kinds: ["workspace", "personal"], input: z.object({ assignee: z.string().trim().min(1).max(200) }),
  async prepare(c) {
    const i = needItem(c); const key = i.externalKey ?? i.title;
    const who = c.input.assignee.toLowerCase() === "me" ? "you" : c.input.assignee;
    return { risk: "shared", summary: APP_READBACK.assign.summary(key, who), readback: { to: [APP_READBACK.assign.toPerson(who, "Test app"), APP_READBACK.assign.to(key, "Test app")], what: APP_READBACK.assign.what(key, who) }, appearsAs: as(c) };
  },
  async run(c) {
    const i = needItem(c);
    const r = await c.http.request<Record<string, unknown>>({ method: "PATCH", url: `${API}/issues/${encodeURIComponent(i.externalId)}`, json: { assignee: c.input.assignee.toLowerCase() === "me" ? "fake-user" : c.input.assignee } });
    return { summary: `Assigned ${i.externalKey ?? i.title}`, item: issueItem(r.body) };
  },
};

const setDue: ActionSpec<{ due: string | null }> = {
  name: "set_due", tool: "work_item_action", kinds: ["workspace", "personal"], input: z.object({ due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  async prepare(c) {
    const i = needItem(c); const key = i.externalKey ?? i.title;
    return { risk: "shared", summary: APP_READBACK.set_due.summary(key), readback: { to: [APP_READBACK.set_due.to(key, "Test app")], what: APP_READBACK.set_due.what(key, c.input.due) }, appearsAs: as(c) };
  },
  async run(c) {
    const i = needItem(c);
    const r = await c.http.request<Record<string, unknown>>({ method: "PATCH", url: `${API}/issues/${encodeURIComponent(i.externalId)}`, json: { due: c.input.due } });
    return { summary: `Set ${i.externalKey ?? i.title}'s due date`, item: issueItem(r.body) };
  },
};

const block: ActionSpec<{ title: string; startsAt: string; endsAt: string }> = {
  name: "block", tool: "calendar_action", kinds: ["personal"], input: z.object({ title: z.string().trim().min(1).max(120), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }),
  async prepare(c) {
    const tz = c.actor.timeZone;
    const range = `${hm(c.input.startsAt, tz)}–${hm(c.input.endsAt, tz)}`;
    return { risk: "private", summary: APP_READBACK.block.summary(range, c.input.title), readback: { to: [APP_READBACK.block.to()], what: APP_READBACK.block.what("Test app", `${when(c.input.startsAt, tz)}–${hm(c.input.endsAt, tz)}`) }, appearsAs: "you" };
  },
  async run(c) {
    const r = await c.http.request<FakeEvent>({ method: "POST", url: `${API}/blocks`, json: { title: c.input.title, start: new Date(c.input.startsAt).toISOString(), end: new Date(c.input.endsAt).toISOString() } });
    return { summary: `Blocked ${hm(c.input.startsAt, c.actor.timeZone)}–${hm(c.input.endsAt, c.actor.timeZone)} for “${c.input.title}”`, item: eventItem(r.body), undo: { kind: "block", data: { eventId: r.body.id } } };
  },
  async undo(c) {
    await c.http.request({ method: "DELETE", url: `${API}/blocks/${encodeURIComponent(String(c.data.eventId))}`, expect: "none" });
  },
};

const move: ActionSpec<{ startsAt: string; endsAt: string }> = {
  name: "move", tool: "calendar_action", kinds: ["personal"], input: z.object({ startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }),
  async prepare(c) {
    const i = needItem(c); const tz = c.actor.timeZone; const guests = i.guests ?? 0;
    const whenWords = `${when(c.input.startsAt, tz)}–${hm(c.input.endsAt, tz)}`;
    return guests > 0
      ? { risk: "shared", summary: APP_READBACK.move.summary(i.title), readback: { to: [APP_READBACK.move.to(guests)], what: APP_READBACK.move.what(i.title, whenWords) }, appearsAs: APP_READBACK.as.yourAccount(c.conn.accountLabel), people: guests }
      : { risk: "private", summary: APP_READBACK.move.summary(i.title), readback: { to: ["Only you"], what: APP_READBACK.move.what(i.title, whenWords) }, appearsAs: "you" };
  },
  async run(c) {
    const i = needItem(c);
    if (!i.externalId.startsWith("b-")) return { summary: `Moved “${i.title}”` };
    await c.http.request({ method: "PATCH", url: `${API}/blocks/${encodeURIComponent(i.externalId)}`, json: { start: c.input.startsAt, end: c.input.endsAt } });
    return { summary: `Moved “${i.title}”`, undo: { kind: "move", data: { eventId: i.externalId, start: i.startsAt, end: i.endsAt } } };
  },
  async undo(c) {
    await c.http.request({ method: "PATCH", url: `${API}/blocks/${encodeURIComponent(String(c.data.eventId))}`, json: { start: c.data.start, end: c.data.end } });
  },
};

const invite: ActionSpec<{ title: string; startsAt: string; endsAt: string; guests: string[] }> = {
  name: "invite", tool: "calendar_action", kinds: ["personal"], input: z.object({ title: z.string().trim().min(1).max(120), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), guests: z.array(z.string().email()).min(1).max(20) }),
  async prepare(c) {
    const tz = c.actor.timeZone;
    return { risk: "shared", summary: APP_READBACK.invite.summary(c.input.guests.length, c.input.title), readback: { to: c.input.guests.map((g) => APP_READBACK.invite.to(g, "Test app")), what: APP_READBACK.invite.what(c.input.title, `${when(c.input.startsAt, tz)}–${hm(c.input.endsAt, tz)}`) }, appearsAs: APP_READBACK.as.yourAccount(c.conn.accountLabel), people: c.input.guests.length };
  },
  async run(c) {
    await c.http.request({ method: "POST", url: `${API}/blocks`, json: { title: c.input.title, start: c.input.startsAt, end: c.input.endsAt, guests: c.input.guests } });
    return { summary: `Invited ${c.input.guests.length} to “${c.input.title}”` };
  },
};

const RSVP = { accept: ["Accept", "accept"], tentative: ["Maybe", "tentatively accept"], decline: ["Decline", "decline"] } as const;
const rsvp: ActionSpec<{ response: keyof typeof RSVP; note?: string }> = {
  name: "rsvp", tool: "calendar_action", kinds: ["personal"], input: z.object({ response: z.enum(["accept", "tentative", "decline"]), note: z.string().max(300).optional() }),
  async prepare(c) {
    const i = needItem(c); const [verb, lower] = RSVP[c.input.response];
    return { risk: "shared", summary: APP_READBACK.rsvp.summary(verb, i.title), detail: c.input.note, readback: { to: [APP_READBACK.rsvp.to(null)], what: APP_READBACK.rsvp.what(lower, i.title, i.startsAt ? when(i.startsAt, c.actor.timeZone) : "its day", !!c.input.note) }, appearsAs: APP_READBACK.as.yourAccount(c.conn.accountLabel) };
  },
  async run(c) {
    const i = needItem(c);
    await c.http.request({ method: "POST", url: `${API}/rsvp`, json: { event: i.externalId, response: c.input.response, note: c.input.note ?? null } });
    return { summary: `${RSVP[c.input.response][0]}ed “${i.title}”`.replace("Maybeed", "Answered maybe to") };
  },
};

const cancel: ActionSpec<{ note?: string }> = {
  name: "cancel", tool: "calendar_action", kinds: ["personal"], input: z.object({ note: z.string().max(300).optional() }),
  async prepare(c) {
    const i = needItem(c); const guests = i.guests ?? 0;
    if (i.response !== "organiser") throw new ConnectorError("NOT_ALLOWED", "only events you organise");
    const day = i.startsAt ? new Date(i.startsAt).toLocaleDateString("en-GB", { timeZone: c.actor.timeZone, weekday: "long", day: "numeric", month: "long" }) : "its day";
    return { risk: "destructive", summary: APP_READBACK.cancel.summary(i.title), detail: c.input.note, readback: { to: [APP_READBACK.cancel.toCalendar, ...(guests ? [APP_READBACK.cancel.toGuests(guests)] : [])], what: APP_READBACK.cancel.what(i.title, day) }, appearsAs: APP_READBACK.as.yourAccount(c.conn.accountLabel), people: guests };
  },
  async run(c) {
    const i = needItem(c);
    if (i.externalId.startsWith("b-")) await c.http.request({ method: "DELETE", url: `${API}/blocks/${encodeURIComponent(i.externalId)}`, expect: "none" });
    return { summary: `Cancelled “${i.title}”` };
  },
};

export const adapter: ProviderAdapter = {
  id: "fake",
  category: "work",
  kinds: ["workspace", "personal"],
  hosts: [FAKE_HOST],
  linkHosts: [FAKE_HOST],
  env: ["CONNECTORS_FAKE"],
  configured: (env) => fakeEnabled(env ?? process.env),
  oauth: {
    // Straight back to Boredroom's own callback with a code the pretend server knows (no network, no account).
    authorizeUrl: (c) => `${redirectUri("fake")}?code=fake-${c.kind}-${c.act ? 1 : 0}`,
    tokenUrl: `${API}/oauth/token`,
    clientId: () => "fake-client",
    clientSecret: () => "fake-client-secret",
    clientAuth: "body",
    tokenBody: "form",
    pkce: "S256",
    scopeSeparator: " ",
    scopes: ({ act }) => (act ? ["read", "write"] : ["read"]),
    parseToken,
    refresh: "rotating",
  },
  async identify({ kind, http }) {
    const me = (await http.request<{ id: string; email: string; team: { id: string; name: string } }>({ url: `${API}/me` })).body;
    return kind === "workspace"
      ? { externalAccountId: me.team.id, externalTenantId: me.team.id, accountLabel: `${me.team.name} (Test app)` }
      : { externalAccountId: me.id, externalTenantId: me.team.id, accountLabel: me.email, identity: { externalUserId: me.id, email: me.email } };
  },
  ownerBound: false,
  workspaceActs: true,
  async sources({ http }) {
    const r = await http.request<{ sources: { kind: "channel" | "project"; id: string; label: string; members?: number; private?: boolean }[] }>({ url: `${API}/sources` });
    return r.body.sources.map((s) => ({ kind: s.kind, externalId: s.id, label: s.label, members: s.members ?? null, isPrivate: s.private ?? false }));
  },
  streams: [
    { name: "events", kinds: ["event"], every: { workingMinutes: 10, offMinutes: 60 }, perRun: { pages: 3, items: 500, ms: 15_000 }, fullEveryMinutes: 10 },
    { name: "issues", kinds: ["issue"], every: { workingMinutes: 15, offMinutes: 120 }, perRun: { pages: 5, items: 500, ms: 15_000 }, fullEveryMinutes: 360 },
  ],
  async sync({ conn, http, stream, now, timeZone, sink, selected }) {
    if (stream === "events") {
      if (conn.kind !== "personal") return { cursor: null, more: false };
      const day = localDate(now, timeZone);
      const from = new Date(localTimeOn(addDays(day, -1), "00:00", timeZone));
      const to = new Date(localTimeOn(addDays(day, 14), "00:00", timeZone));
      const r = await http.request<{ events: FakeEvent[] }>({ url: `${API}/events`, query: { date: day, tz: timeZone } });
      const items = r.body.events.map(eventItem);
      await sink.upsert(items);
      await sink.reconcileWindow("event", from, to, items.map((i) => i.externalId));
      return { cursor: null, more: false };
    }
    const r = await http.request<{ issues: Record<string, unknown>[] }>({ url: `${API}/issues` });
    let items = r.body.issues.map(issueItem);
    if (conn.kind === "personal") items = items.filter((i) => i.mine);
    else if (!selected.some((s) => s.externalId === "P-TEST")) items = [];
    await sink.upsert(items);
    await sink.reconcileOpen("issue", items.filter((i) => i.state !== "done" && i.state !== "cancelled").map((i) => i.externalId));
    return { cursor: null, more: false };
  },
  async fetchItem({ http, kind, externalId }) {
    if (kind !== "issue") return null;
    try { return issueItem((await http.request<Record<string, unknown>>({ url: `${API}/issues/${encodeURIComponent(externalId)}` })).body); }
    catch (err) { if (err instanceof ConnectorError && err.code === "NOT_FOUND") return null; throw err; }
  },
  async fetchText({ http, kind, externalId, maxChars }) {
    if (kind !== "issue") return null;
    const r = await http.request<Record<string, unknown>>({ url: `${API}/issues/${encodeURIComponent(externalId)}` });
    return `Pretend description of ${String(r.body.key)}.`.slice(0, maxChars);
  },
  actions: [post, createIssue, comment, setState, assign, setDue, block, move, invite, rsvp, cancel],
  interpret(res) {
    const b = res.body as Record<string, unknown> | null;
    if (res.status === 200 && b && b.ok === false && b.error === "not_in_channel") return new ConnectorError("NOT_ALLOWED", "not in channel");
    return null;
  },
  webhook: {
    async verify({ raw, headers }) {
      const ts = headers.get("x-fake-timestamp") ?? "";
      const sig = headers.get("x-fake-signature") ?? "";
      if (!/^\d{10}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { ok: false };
      const want = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(`${ts}.`).update(raw).digest("hex");
      if (!safeEqual(sig, want)) return { ok: false };
      const body = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
      if (body.type === "url_verification") return { ok: true, deliveryId: `verify-${ts}`, reply: Response.json({ challenge: body.challenge }) };
      return { ok: true, deliveryId: String(body.deliveryId ?? `${ts}-${want.slice(0, 16)}`) };
    },
    route({ body }) {
      const b = body as Record<string, unknown>;
      const tenantId = String(b.tenant ?? "fake-team");
      if (b.type === "revoked") return [{ by: "tenant", tenantId, revoked: true }];
      if (typeof b.issueId === "string") return [{ by: "tenant", tenantId, externalId: b.issueId, kind: "issue" }];
      return [{ by: "tenant", tenantId }];
    },
  },
  async revoke({ http, tokens }) {
    await http.request({ method: "POST", url: `${API}/oauth/revoke`, auth: "none", form: { token: tokens.refreshToken ?? tokens.accessToken } });
  },
};

/** Signs a pretend webhook delivery (tests and the development screens). */
export function signFakeWebhook(body: string, ts = Math.floor(Date.now() / 1000)): Headers {
  const sig = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(`${ts}.`).update(body).digest("hex");
  return new Headers({ "x-fake-timestamp": String(ts), "x-fake-signature": sig, "content-type": "application/json" });
}

export const FAKE_ORIGIN = () => appOrigin();
export type { Prepared };
