/**
 * Google Calendar adapter (calendars + chat group; owner decisions, 22 October 2026: connectors; spec §8.1, §9.5,
 * §16.2). No database and no network: the HTTP client gets injected token deps and mockProviders answers from fixtures
 * hand-written from Google's public reference (tests/fixtures/connectors/google-calendar). An unmocked call throws.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adapter, googleEventItem, calendarWindow, dayWords, whenWords } from "@/server/connectors/adapters/google-calendar";
import { httpFor, hostAllowed, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fixture, fakeTokens, mockProviders, type MockRequest, type ProviderMock } from "@/server/connectors/testing";
import { ConnectorError, type ActInput, type ActionSpec, type Actor, type ConnectionRef, type NormalisedItem, type StoredItem, type SyncSink } from "@/server/connectors/types";

const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOKEN = "test-google-access-token-0001";
const saved = { ...process.env };

const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: randomUUID(), organisationId: randomUUID(), provider: "google_calendar", kind: "personal", membershipId: "m-1", connectedBy: "m-1",
  externalAccountId: "110169484474386276334", externalTenantId: null, accountLabel: "ada@example.com", scopes: [], settings: {}, canRead: true, canAct: true, ...over,
});
function client(c: ConnectionRef = conn()) {
  const calls = { refresh: 0, backoff: [] as number[] };
  const deps: HttpDeps = {
    token: async () => ({ accessToken: TOKEN, expiresAt: null }),
    refresh: async () => { calls.refresh++; return TOKEN; },
    backoff: async (s) => { calls.backoff.push(s); },
  };
  return { http: httpFor(c, adapter, deps), calls, conn: c };
}
function sink() {
  const s = { upserts: [] as NormalisedItem[], gone: [] as string[], windows: [] as { from: Date; to: Date; seen: string[] }[] };
  const k: SyncSink = {
    upsert: async (items) => { s.upserts.push(...items); },
    gone: async (_kind, ids) => { s.gone.push(...ids); },
    reconcileWindow: async (_kind, from, to, seen) => { s.windows.push({ from, to, seen }); },
    reconcileOpen: async () => { throw new Error("calendars never reconcile open sets"); },
  };
  return { s, sink: k };
}
const actor: Actor = { membershipId: "m-1", firstName: "Jo", displayName: "Jo Bloggs", email: "jo@example.com", assistantName: "Max", timeZone: "Europe/London" };
const stored = (over: Partial<StoredItem> = {}): StoredItem => ({
  id: randomUUID(), externalId: "evt-design-review", externalKey: null, kind: "event", title: "Design review", url: null, state: null, containerLabel: null,
  sourceExternalId: null, assigneeExternalId: null, startsAt: "2026-10-23T09:00:00.000Z", endsAt: "2026-10-23T09:30:00.000Z", guests: 0, response: "organiser", ...over,
});
const spec = (name: string) => adapter.actions.find((a) => a.name === name) as ActionSpec;
function input(c: ConnectionRef, http: ReturnType<typeof client>["http"], i: Record<string, unknown>, item: StoredItem | null = null): ActInput<Record<string, unknown>> {
  return { conn: c, http, actor, input: i, item, source: null, now: new Date("2026-10-22T09:00:00Z") };
}
const parsed = (name: string, i: Record<string, unknown>) => spec(name).input.parse(i) as Record<string, unknown>;

let mock: ProviderMock;
beforeAll(() => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-google-client-secret";
  process.env.APP_ORIGIN = "https://boredroom.test";
  mock = mockProviders({});
});
afterEach(() => { mock.calls.length = 0; });
afterAll(() => { mock.restore(); process.env = saved; });

describe("Google Calendar: connecting", () => {
  it("is configured only with both variables, personal only, on Google's hosts", () => {
    expect(adapter.configured({ GOOGLE_CALENDAR_CLIENT_ID: "x" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(adapter.configured({ GOOGLE_CALENDAR_CLIENT_ID: "x", GOOGLE_CALENDAR_CLIENT_SECRET: "y" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(adapter.kinds).toEqual(["personal"]);
    expect(adapter.hosts).toEqual(["www.googleapis.com", "oauth2.googleapis.com"]);
  });

  it("asks for the read scopes, and the acting one only with act; offline access, consent, nonce and PKCE", () => {
    const url = (act: boolean) => new URL(authorizeUrl(adapter, { kind: "personal", act, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "personal", act }) }));
    const read = url(false).searchParams;
    expect(url(false).origin + url(false).pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(read.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events.owned.readonly");
    expect(read.get("access_type")).toBe("offline");
    expect(read.get("include_granted_scopes")).toBe("true");
    expect(read.get("prompt")).toBe("consent");
    expect(read.get("nonce")).toBe("N");
    expect(read.get("code_challenge")).toBe("C");
    expect(read.get("code_challenge_method")).toBe("S256");
    expect(read.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/google-calendar/callback");
    expect(url(true).searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events.owned.readonly https://www.googleapis.com/auth/calendar.events.owned");
  });

  it("parses Google's token answer, spelling scopes as asked (so 'can make changes' is judged right)", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const t = adapter.oauth.parseToken(fixture("google-calendar/token.ok.json"), now);
    expect(t.accessToken).toBe("ya29.test-google-access-0001");
    expect(t.refreshToken).toBe("1//test-google-refresh-0001");
    expect(t.expiresAt?.toISOString()).toBe("2026-10-22T09:59:59.000Z");
    const act = adapter.oauth.scopes({ kind: "personal", act: true });
    expect(act.every((s) => t.scopes!.includes(s))).toBe(true);
    const partial = adapter.oauth.parseToken(fixture("google-calendar/token.read-only.json"), now);
    expect(act.every((s) => partial.scopes!.includes(s))).toBe(false);
    expect(adapter.oauth.scopes({ kind: "personal", act: false }).every((s) => partial.scopes!.includes(s))).toBe(true);
    expect(adapter.oauth.parseToken(fixture("google-calendar/token.refresh.json"), now).refreshToken).toBeNull();
    expect(adapter.oauth.refresh).toBe("reusable");
  });

  it("refuses an error answer: invalid_grant means reconnect, never Google's words", () => {
    try { adapter.oauth.parseToken(fixture("google-calendar/token.error.json"), new Date()); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ConnectorError); expect((e as ConnectorError).code).toBe("REAUTH_REQUIRED"); expect((e as Error).message).not.toContain("expired or revoked"); }
  });

  it("identifies the person from the checked id_token, or from userinfo", async () => {
    const { http } = client();
    const a = await adapter.identify({ kind: "personal", http, tokens: fakeTokens({ facts: { idTokenClaims: { sub: "110169484474386276334", email: "ada@example.com" } } }), pending: {} });
    expect(a).toEqual({ externalAccountId: "110169484474386276334", externalTenantId: null, accountLabel: "ada@example.com", identity: { externalUserId: "110169484474386276334", email: "ada@example.com" } });
    expect(mock.calls).toHaveLength(0);
    mock.set("GET https://www.googleapis.com/oauth2/v3/userinfo", { json: fixture("google-calendar/userinfo.json") });
    const b = await adapter.identify({ kind: "personal", http, tokens: fakeTokens(), pending: {} });
    expect(b.externalAccountId).toBe("110169484474386276334");
    expect(mock.calls[0].headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });
});

describe("Google Calendar: sync", () => {
  const now = new Date("2026-10-23T08:00:00Z");
  const tz = "Europe/London";

  it("re-lists yesterday to 14 days ahead, page by page, and reconciles the whole window", async () => {
    const { http, conn: c } = client();
    const { s, sink: k } = sink();
    mock.set(`GET ${EVENTS}`, (req: MockRequest) => ({ json: fixture(req.url.searchParams.get("pageToken") === "page-2-token" ? "google-calendar/events.page2.json" : "google-calendar/events.page1.json") }));
    const r = await adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() + 15_000 });
    expect(r).toEqual({ cursor: null, more: false });
    expect(mock.calls).toHaveLength(2);
    const q = new URL(mock.calls[0].url).searchParams;
    expect(q.get("timeMin")).toBe("2026-10-21T23:00:00.000Z"); // 22 October 00:00 in London (BST)
    expect(q.get("timeMax")).toBe("2026-11-06T00:00:00.000Z"); // 6 November 00:00 in London (GMT)
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("orderBy")).toBe("startTime");
    expect(q.get("maxResults")).toBe("250");
    expect(q.get("fields")).toContain("attendees(self,responseStatus,resource,organizer)");
    expect(q.get("fields")).not.toMatch(/description|location|email/);
    expect(new URL(mock.calls[1].url).searchParams.get("pageToken")).toBe("page-2-token");

    const by = new Map(s.upserts.map((i) => [i.externalId, i]));
    expect([...by.keys()]).toEqual(["evt-design-review", "evt-planning", "evt-declined", "evt-offsite", "evt-ooo", "evt-untitled"]);
    expect(by.get("evt-design-review")).toMatchObject({ kind: "event", title: "Design review", startsAt: "2026-10-23T09:00:00.000Z", endsAt: "2026-10-23T09:30:00.000Z", allDay: false, busy: true, response: "accepted", online: true, guests: 2, mine: true });
    expect(by.get("evt-planning")).toMatchObject({ response: "organiser", online: true, guests: 2 });
    expect(by.get("evt-declined")).toMatchObject({ response: "declined", online: false, guests: 1 });
    expect(by.get("evt-offsite")).toMatchObject({ allDay: true, busy: false, startsAt: "2026-10-23T23:00:00.000Z", endsAt: "2026-10-24T23:00:00.000Z", response: "organiser" });
    expect(by.get("evt-ooo")).toMatchObject({ busy: true });
    expect(by.get("evt-untitled")).toMatchObject({ title: "(No title)", response: "needs_action" });
    // The sink drops links off the adapter's link hosts; Google's own event links pass.
    expect(hostAllowed(by.get("evt-design-review")!.url!, adapter.linkHosts)).toBe(true);
    expect(hostAllowed(by.get("evt-untitled")!.url!, adapter.linkHosts)).toBe(false);
    expect(s.gone).toEqual(["evt-cancelled"]);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].from.toISOString()).toBe("2026-10-21T23:00:00.000Z");
    expect(s.windows[0].to.toISOString()).toBe("2026-11-06T00:00:00.000Z");
    expect(s.windows[0].seen).toHaveLength(6);
  });

  it("stops after 3 pages and reconciles only up to the last start it saw", async () => {
    const { http, conn: c } = client();
    const { s, sink: k } = sink();
    let n = 0;
    mock.set(`GET ${EVENTS}`, () => {
      n++;
      const start = new Date(Date.UTC(2026, 9, 22 + n, 9)).toISOString();
      return { json: { items: [{ id: `e${n}`, status: "confirmed", summary: `E${n}`, start: { dateTime: start }, end: { dateTime: start.replace("T09", "T10") }, organizer: { self: true }, updated: start }], nextPageToken: `p${n + 1}` } };
    });
    await adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() + 15_000 });
    expect(n).toBe(3);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].to.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("stops at the deadline", async () => {
    const { http, conn: c } = client();
    const { sink: k } = sink();
    let n = 0;
    mock.set(`GET ${EVENTS}`, () => { n++; return { json: { items: [], nextPageToken: "more" } }; });
    await adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() - 1 });
    expect(n).toBe(1);
  });

  it("maps one event: skipped kinds, cancelled, a video entry point", () => {
    expect(googleEventItem({ id: "x", status: "cancelled" }, tz)).toBe("gone");
    expect(googleEventItem({ id: "x", eventType: "workingLocation", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } }, tz)).toBeNull();
    expect(googleEventItem({ id: "x", start: {}, end: {} }, tz)).toBeNull();
    const w = calendarWindow(now, tz);
    expect(w.from.toISOString()).toBe("2026-10-21T23:00:00.000Z");
  });

  it("Google's 403 usage limits become a backoff; a non-organiser change is NOT_ALLOWED", async () => {
    const { http, calls } = client();
    mock.set(`GET ${EVENTS}`, { status: 403, json: fixture("google-calendar/error.rateLimit.json") });
    await expect(http.request({ url: EVENTS })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls.backoff).toEqual([60]);
    mock.set(`GET ${EVENTS}`, { status: 403, json: fixture("google-calendar/error.nonOrganizer.json") });
    await expect(http.request({ url: EVENTS })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    mock.set(`GET ${EVENTS}`, { status: 429, json: {}, headers: { "retry-after": "30" } });
    await expect(http.request({ url: EVENTS })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
  });
});

describe("Google Calendar: acting", () => {
  it("block: private, the exact card, sendUpdates=none, a private opaque event; Undo deletes it", async () => {
    const { http, conn: c } = client();
    const i = parsed("block", { title: "Deep work", startsAt: "2026-10-23T13:00:00.000Z", endsAt: "2026-10-23T14:00:00.000Z" });
    const p = await spec("block").prepare(input(c, http, i));
    expect(p).toEqual({ risk: "private", summary: "Block 14:00–15:00 for “Deep work”", readback: { to: ["Only you"], what: "A private block on your Google Calendar, Friday 23 October 14:00–15:00" }, appearsAs: "you" });
    mock.set(`POST ${EVENTS}`, { json: fixture("google-calendar/event.block.json") });
    const r = await spec("block").run(input(c, http, i));
    const call = mock.calls.at(-1)!;
    expect(new URL(call.url).searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(call.body!)).toEqual({ summary: "Deep work", start: { dateTime: "2026-10-23T13:00:00.000Z" }, end: { dateTime: "2026-10-23T14:00:00.000Z" }, visibility: "private", transparency: "opaque", extendedProperties: { private: { boredroom: "block" } } });
    expect(r.undo).toEqual({ kind: "block", data: { eventId: "blk-0001", version: "2026-10-22T09:00:00.000Z" } });
    expect(r.item).toMatchObject({ externalId: "blk-0001", response: "organiser", guests: 0 });

    mock.set(`GET ${EVENTS}/blk-0001`, { json: { id: "blk-0001", status: "confirmed", updated: "2026-10-22T09:00:00.000Z" } });
    mock.set(`DELETE ${EVENTS}/blk-0001`, { status: 204 });
    await spec("block").undo!({ conn: c, http, data: r.undo!.data });
    const del = mock.calls.at(-1)!;
    expect(del.method).toBe("DELETE");
    expect(new URL(del.url).searchParams.get("sendUpdates")).toBe("none");
  });

  it("Undo refuses a block that was edited or removed since", async () => {
    const { http, conn: c } = client();
    mock.set(`GET ${EVENTS}/blk-0002`, { json: { id: "blk-0002", status: "confirmed", updated: "2026-10-22T10:00:00.000Z" } });
    await expect(spec("block").undo!({ conn: c, http, data: { eventId: "blk-0002", version: "2026-10-22T09:00:00.000Z" } })).rejects.toMatchObject({ code: "CONFLICT" });
    mock.set(`GET ${EVENTS}/blk-0003`, { status: 404, json: { error: { code: 404 } } });
    await expect(spec("block").undo!({ conn: c, http, data: { eventId: "blk-0003", version: "v" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mock.calls.some((x) => x.method === "DELETE")).toBe(false);
  });

  it("move: private without guests (sendUpdates=none, Undo), shared with guests (sendUpdates=all); only the organiser's events", async () => {
    const { http, conn: c } = client();
    const i = parsed("move", { startsAt: "2026-10-24T09:00:00.000Z", endsAt: "2026-10-24T09:30:00.000Z" });
    const solo = stored({ externalId: "blk-0001", title: "Deep work", guests: 0 });
    const p1 = await spec("move").prepare(input(c, http, i, solo));
    expect(p1).toMatchObject({ risk: "private", summary: "Move “Deep work”", readback: { to: ["Only you"], what: "“Deep work” moves to Saturday 24 October 10:00–10:30" } });
    mock.set(`PATCH ${EVENTS}/blk-0001`, { json: { ...fixture<Record<string, unknown>>("google-calendar/event.block.json"), updated: "2026-10-22T11:00:00.000Z" } });
    const r1 = await spec("move").run(input(c, http, i, solo));
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("sendUpdates")).toBe("none");
    expect(JSON.parse(mock.calls.at(-1)!.body!)).toEqual({ start: { dateTime: "2026-10-24T09:00:00.000Z" }, end: { dateTime: "2026-10-24T09:30:00.000Z" } });
    expect(r1.undo).toEqual({ kind: "move", data: { eventId: "blk-0001", startsAt: solo.startsAt, endsAt: solo.endsAt, version: "2026-10-22T11:00:00.000Z" } });

    const meeting = stored({ externalId: "evt-planning", title: "Planning", guests: 3 });
    const p2 = await spec("move").prepare(input(c, http, i, meeting));
    expect(p2).toMatchObject({ risk: "shared", summary: "Move “Planning”", readback: { to: ["The 3 guests, who get the new time"], what: "“Planning” moves to Saturday 24 October 10:00–10:30" }, appearsAs: "as you (ada@example.com)", people: 3 });
    mock.set(`PATCH ${EVENTS}/evt-planning`, { json: { id: "evt-planning", updated: "x", start: { dateTime: i.startsAt }, end: { dateTime: i.endsAt } } });
    const r2 = await spec("move").run(input(c, http, i, meeting));
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("sendUpdates")).toBe("all");
    expect(r2.undo).toBeNull();

    await expect(spec("move").prepare(input(c, http, i, stored({ response: "accepted", guests: 4 })))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("invite: shared, one line per guest, sendUpdates=all with the attendees", async () => {
    const { http, conn: c } = client();
    const i = parsed("invite", { title: "Design review", startsAt: "2026-10-23T13:00:00.000Z", endsAt: "2026-10-23T13:30:00.000Z", guests: ["Ada@Example.com", "grace@example.com"] });
    const p = await spec("invite").prepare(input(c, http, i));
    expect(p).toEqual({
      risk: "shared", summary: "Invite 2 people to “Design review”",
      readback: { to: ["ada@example.com, by email invitation from your Google Calendar", "grace@example.com, by email invitation from your Google Calendar"], what: "“Design review”, Friday 23 October 14:00–14:30" },
      appearsAs: "as you (ada@example.com)", people: 2,
    });
    mock.set(`POST ${EVENTS}`, { json: fixture("google-calendar/event.invite.json") });
    const r = await spec("invite").run(input(c, http, i));
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("sendUpdates")).toBe("all");
    expect(JSON.parse(mock.calls.at(-1)!.body!).attendees).toEqual([{ email: "ada@example.com" }, { email: "grace@example.com" }]);
    expect(r.summary).toBe("Invited 2 people to “Design review”");
    expect(() => spec("invite").input.parse({ ...i, guests: ["not-an-email"] })).toThrow();
  });

  it("rsvp: shared, names the organiser; patches only the person's own answer with sendUpdates=all", async () => {
    const { http, conn: c } = client();
    const item = stored({ response: "needs_action", guests: 1 });
    mock.set(`GET ${EVENTS}/evt-design-review`, (req) => ({ json: fixture(req.url.searchParams.get("fields")?.startsWith("organizer") ? "google-calendar/event.organizer.json" : "google-calendar/event.attendees.json") }));
    const i = parsed("rsvp", { response: "accept", note: "See you there" });
    const p = await spec("rsvp").prepare(input(c, http, i, item));
    expect(p).toEqual({ risk: "shared", summary: "Accept “Design review”", detail: "See you there", readback: { to: ["The organiser, Grace Hopper"], what: "You accept “Design review” on Friday 23 October at 10:00, with your note" }, appearsAs: "as you (ada@example.com)", people: 1 });
    mock.set(`PATCH ${EVENTS}/evt-design-review`, { json: { id: "evt-design-review" } });
    const r = await spec("rsvp").run(input(c, http, i, item));
    const patch = mock.calls.at(-1)!;
    expect(new URL(patch.url).searchParams.get("sendUpdates")).toBe("all");
    expect(JSON.parse(patch.body!).attendees).toEqual([
      { email: "ada@example.com", self: true, responseStatus: "accepted", comment: "See you there" },
      { email: "grace@example.com", organizer: true, responseStatus: "accepted", displayName: "Grace Hopper" },
    ]);
    expect(r.summary).toBe("Accepted “Design review”");
    await expect(spec("rsvp").prepare(input(c, http, parsed("rsvp", { response: "decline" }), stored({ response: "organiser" })))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("cancel: destructive, organiser only, sendUpdates=all with guests; honest that Google sends no note", async () => {
    const { http, conn: c } = client();
    const item = stored({ externalId: "evt-planning", title: "Planning", guests: 3 });
    const p = await spec("cancel").prepare(input(c, http, parsed("cancel", { note: "Moving to next week" }), item));
    expect(p).toEqual({
      risk: "destructive", summary: "Cancel “Planning”",
      readback: { to: ["Your calendar", "The 3 guests, who are told"], what: "“Planning” on Friday 23 October is cancelled. Google Calendar can't send your note with it" },
      appearsAs: "as you (ada@example.com)", people: 3,
    });
    mock.set(`DELETE ${EVENTS}/evt-planning`, { status: 204 });
    await spec("cancel").run(input(c, http, parsed("cancel", {}), item));
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("sendUpdates")).toBe("all");
    mock.set(`DELETE ${EVENTS}/blk-9`, { status: 204 });
    await spec("cancel").run(input(c, http, parsed("cancel", {}), stored({ externalId: "blk-9", guests: 0 })));
    expect(new URL(mock.calls.at(-1)!.url).searchParams.get("sendUpdates")).toBe("none");
    await expect(spec("cancel").prepare(input(c, http, parsed("cancel", {}), stored({ response: "accepted" })))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("every action is personal-only and on calendar_action; inputs are validated", () => {
    expect(adapter.actions.map((a) => a.name)).toEqual(["block", "move", "invite", "rsvp", "cancel"]);
    for (const a of adapter.actions) { expect(a.tool).toBe("calendar_action"); expect(a.kinds).toEqual(["personal"]); }
    expect(() => spec("block").input.parse({ title: "x", startsAt: "2026-10-23T14:00:00Z", endsAt: "2026-10-23T13:00:00Z" })).toThrow();
    expect(() => spec("block").input.parse({ title: "x".repeat(121), startsAt: "2026-10-23T13:00:00Z", endsAt: "2026-10-23T14:00:00Z" })).toThrow();
    expect(() => spec("rsvp").input.parse({ response: "maybe" })).toThrow();
  });

  it("words for days and ranges", () => {
    expect(dayWords("2026-10-23T09:00:00Z", "Europe/London")).toBe("Friday 23 October");
    expect(whenWords("2026-10-23T22:00:00Z", "2026-10-24T00:30:00Z", "Europe/London")).toBe("Friday 23 October 23:00 – Saturday 24 October 01:30");
  });
});

describe("Google Calendar: revoking", () => {
  it("revokes the refresh token at Google's endpoint without a bearer header", async () => {
    const { http, conn: c } = client();
    mock.set("POST https://oauth2.googleapis.com/revoke", { json: {} });
    await adapter.revoke!({ conn: c, http, tokens: fakeTokens() });
    const call = mock.calls.at(-1)!;
    expect(call.body).toBe("token=test-refresh-token-0000");
    expect(call.headers.get("authorization")).toBeNull();
  });
});
