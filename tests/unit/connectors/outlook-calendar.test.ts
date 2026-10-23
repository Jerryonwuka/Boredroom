/**
 * Outlook Calendar adapter and the shared Microsoft helper (calendars + chat group; owner decisions, 22 October 2026:
 * connectors; spec §8.2, §9.5, §16.2). No database and no network: injected token deps and mockProviders with fixtures
 * hand-written from Microsoft's public reference (tests/fixtures/connectors/microsoft). An unmocked call throws.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adapter, outlookEventItem } from "@/server/connectors/adapters/outlook-calendar";
import { fromGraphTime, interpretGraph, msScopes, toGraphTime } from "@/server/connectors/adapters/microsoft";
import { httpFor, hostAllowed, type HttpDeps } from "@/server/connectors/http";
import { authorizeUrl } from "@/server/connectors/oauth";
import { fixture, fakeTokens, mockProviders, type ProviderMock } from "@/server/connectors/testing";
import { ConnectorError, type ActInput, type ActionSpec, type Actor, type ConnectionRef, type NormalisedItem, type StoredItem, type SyncSink } from "@/server/connectors/types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN = "test-ms-access-token-0001";
const saved = { ...process.env };

const conn = (over: Partial<ConnectionRef> = {}): ConnectionRef => ({
  id: randomUUID(), organisationId: randomUUID(), provider: "outlook_calendar", kind: "personal", membershipId: "m-1", connectedBy: "m-1",
  externalAccountId: "48d31887-5fad-4d73-a9f5-3c356e68a038", externalTenantId: null, accountLabel: "ada@example.com", scopes: [], settings: {}, canRead: true, canAct: true, ...over,
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
  id: randomUUID(), externalId: "AAMkAD-design", externalKey: null, kind: "event", title: "Design review", url: null, state: null, containerLabel: null,
  sourceExternalId: null, assigneeExternalId: null, startsAt: "2026-10-23T09:00:00.000Z", endsAt: "2026-10-23T09:30:00.000Z", guests: 2, response: "accepted", ...over,
});
const spec = (name: string) => adapter.actions.find((a) => a.name === name) as ActionSpec;
const act = (c: ConnectionRef, http: ReturnType<typeof client>["http"], i: Record<string, unknown>, item: StoredItem | null = null): ActInput<Record<string, unknown>> =>
  ({ conn: c, http, actor, input: i, item, source: null, now: new Date("2026-10-22T09:00:00Z") });
const parsed = (name: string, i: Record<string, unknown>) => spec(name).input.parse(i) as Record<string, unknown>;

let mock: ProviderMock;
beforeAll(() => {
  process.env.MICROSOFT_CLIENT_ID = "test-ms-client-id";
  process.env.MICROSOFT_CLIENT_SECRET = "test-ms-client-secret";
  process.env.APP_ORIGIN = "https://boredroom.test";
  mock = mockProviders({});
});
afterEach(() => { mock.calls.length = 0; });
afterAll(() => { mock.restore(); process.env = saved; });

describe("Outlook Calendar: connecting", () => {
  it("the common tenant, query response mode, account picker, nonce, PKCE; read scopes and the acting one", () => {
    const url = (a: boolean) => new URL(authorizeUrl(adapter, { kind: "personal", act: a, upgrade: false, state: "S", nonce: "N", codeChallenge: "C", scopes: adapter.oauth.scopes({ kind: "personal", act: a }) }));
    const u = url(false);
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("openid profile email offline_access User.Read Calendars.ReadBasic");
    expect(u.searchParams.get("response_mode")).toBe("query");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect(u.searchParams.get("nonce")).toBe("N");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/outlook/callback");
    expect(url(true).searchParams.get("scope")).toBe("openid profile email offline_access User.Read Calendars.ReadBasic Calendars.ReadWrite");
    expect(adapter.oauth.tokenUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(adapter.oauth.refresh).toBe("rotating");
  });

  it("parses the token answer; Graph-prefixed scopes, OpenID and offline_access read as asked", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    const t = adapter.oauth.parseToken(fixture("microsoft/token.ok.json"), now);
    expect(t.refreshToken).toBe("0.AAAA-test-ms-refresh-0001");
    expect(t.expiresAt?.toISOString()).toBe("2026-10-22T10:02:16.000Z");
    expect(adapter.oauth.scopes({ kind: "personal", act: true }).every((s) => t.scopes!.includes(s))).toBe(true);
    const r = adapter.oauth.parseToken(fixture("microsoft/token.read-only.json"), now);
    expect(adapter.oauth.scopes({ kind: "personal", act: true }).every((s) => r.scopes!.includes(s))).toBe(false);
    expect(adapter.oauth.scopes({ kind: "personal", act: false }).every((s) => r.scopes!.includes(s))).toBe(true);
    expect(msScopes({ scope: "https://graph.microsoft.com/calendars.readwrite" })).toEqual(["Calendars.ReadWrite"]);
  });

  it("errors: admin approval, reconnect, never Microsoft's words", () => {
    const err = (f: string) => { try { adapter.oauth.parseToken(fixture(f), new Date()); } catch (e) { return e as ConnectorError; } throw new Error("no error"); };
    const admin = err("microsoft/token.error.admin.json");
    expect(admin.code).toBe("ADMIN_APPROVAL");
    expect(admin.message).not.toContain("AADSTS");
    expect(err("microsoft/token.error.grant.json").code).toBe("REAUTH_REQUIRED");
  });

  it("identifies the account from /me and the id_token's tenant", async () => {
    const { http } = client();
    mock.set(`GET ${GRAPH}/me`, { json: fixture("microsoft/me.json") });
    const a = await adapter.identify({ kind: "personal", http, tokens: fakeTokens({ facts: { idTokenClaims: { tid: "72F988BF-86F1-41AF-91AB-2D7CD011DB47" } } }), pending: {} });
    expect(a).toEqual({ externalAccountId: "48d31887-5fad-4d73-a9f5-3c356e68a038", externalTenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47", accountLabel: "ada@example.com", identity: { externalUserId: "48d31887-5fad-4d73-a9f5-3c356e68a038", email: "ada@example.com" } });
    expect(new URL(mock.calls[0].url).searchParams.get("$select")).toBe("id,displayName,mail,userPrincipalName");
  });
});

describe("Outlook Calendar: sync", () => {
  const now = new Date("2026-10-23T08:00:00Z");
  const tz = "Europe/London";

  it("re-lists the window through calendarView in UTC, follows nextLink, reconciles the window", async () => {
    const { http, conn: c } = client();
    const { s, sink: k } = sink();
    mock.set(`GET ${GRAPH}/me/calendarView`, (req) => ({ json: fixture(req.url.searchParams.get("$skip") ? "microsoft/calendarView.page2.json" : "microsoft/calendarView.page1.json") }));
    const r = await adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() + 15_000 });
    expect(r).toEqual({ cursor: null, more: false });
    expect(mock.calls).toHaveLength(2);
    const first = mock.calls[0];
    const q = new URL(first.url).searchParams;
    expect(q.get("startDateTime")).toBe("2026-10-21T23:00:00.000Z");
    expect(q.get("endDateTime")).toBe("2026-11-06T00:00:00.000Z");
    expect(q.get("$top")).toBe("100");
    expect(q.get("$orderby")).toBe("start/dateTime");
    expect(q.get("$select")).not.toMatch(/body|location/);
    expect(first.headers.get("prefer")).toBe('outlook.timezone="UTC"');
    expect(mock.calls[1].headers.get("prefer")).toBe('outlook.timezone="UTC"');

    const by = new Map(s.upserts.map((i) => [i.externalId, i]));
    expect([...by.keys()]).toEqual(["AAMkAD-design", "AAMkAD-planning", "AAMkAD-tentative", "AAMkAD-holiday", "AAMkAD-wfh"]);
    // Guests: everyone but the person themself and rooms.
    expect(by.get("AAMkAD-design")).toMatchObject({ startsAt: "2026-10-23T09:00:00.000Z", endsAt: "2026-10-23T09:30:00.000Z", busy: true, response: "accepted", online: true, guests: 2, allDay: false, mine: true });
    expect(by.get("AAMkAD-planning")).toMatchObject({ response: "organiser", guests: 2, online: false });
    expect(by.get("AAMkAD-tentative")).toMatchObject({ response: "tentative", busy: true, guests: 0 });
    expect(by.get("AAMkAD-holiday")).toMatchObject({ allDay: true, busy: false, startsAt: "2026-10-26T00:00:00.000Z", endsAt: "2026-10-27T00:00:00.000Z" });
    expect(by.get("AAMkAD-wfh")).toMatchObject({ busy: false, response: "needs_action" });
    expect(hostAllowed(by.get("AAMkAD-design")!.url!, adapter.linkHosts)).toBe(true);
    expect(s.gone).toEqual(["AAMkAD-cancelled"]);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].to.toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("refuses a nextLink off Graph's host", async () => {
    const { http, conn: c } = client();
    const { sink: k } = sink();
    mock.set(`GET ${GRAPH}/me/calendarView`, { json: fixture("microsoft/calendarView.offhost.json") });
    await expect(adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() + 15_000 })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(mock.calls.every((x) => new URL(x.url).host === "graph.microsoft.com")).toBe(true);
  });

  it("stops after 5 pages and reconciles only up to the last start seen", async () => {
    const { http, conn: c } = client();
    const { s, sink: k } = sink();
    let n = 0;
    mock.set(`GET ${GRAPH}/me/calendarView`, () => {
      n++;
      const day = String(22 + n).padStart(2, "0");
      return { json: { value: [{ id: `e${n}`, subject: `E${n}`, start: { dateTime: `2026-10-${day}T09:00:00.0000000`, timeZone: "UTC" }, end: { dateTime: `2026-10-${day}T10:00:00.0000000`, timeZone: "UTC" }, isOrganizer: true }], "@odata.nextLink": `${GRAPH}/me/calendarView?$skip=${n * 100}` } };
    });
    await adapter.sync!({ conn: c, http, stream: "events", cursor: null, full: true, selected: [], now, timeZone: tz, sink: k, deadline: Date.now() + 15_000 });
    expect(n).toBe(5);
    expect(s.windows[0].to.toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });

  it("Graph times and errors", async () => {
    expect(fromGraphTime({ dateTime: "2026-10-23T09:00:00.0000000", timeZone: "UTC" })).toBe("2026-10-23T09:00:00.000Z");
    expect(fromGraphTime({ dateTime: "2026-10-23T10:00:00", timeZone: "Europe/London" })).toBe("2026-10-23T09:00:00.000Z");
    expect(fromGraphTime({ dateTime: "nonsense", timeZone: "UTC" })).toBeNull();
    expect(toGraphTime("2026-10-23T13:00:00.000Z")).toEqual({ dateTime: "2026-10-23T13:00:00", timeZone: "UTC" });
    expect(outlookEventItem({ id: "x", isCancelled: true }, "UTC", null)).toBe("gone");
    const res = (status: number, f: string, headers: Record<string, string> = {}) => ({ status, headers: new Headers(headers), body: fixture(f) });
    expect(interpretGraph(res(403, "microsoft/error.accessDenied.json"))?.code).toBe("FORBIDDEN");
    expect(interpretGraph(res(404, "microsoft/error.notFound.json"))?.code).toBe("NOT_FOUND");
    expect(interpretGraph(res(401, "microsoft/error.invalidToken.json"))?.code).toBe("REAUTH_REQUIRED");
    expect(interpretGraph(res(503, "microsoft/error.throttled.json", { "retry-after": "12" }))).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 12 });

    const { http, calls } = client();
    mock.set(`GET ${GRAPH}/me/events/x`, { status: 429, json: fixture("microsoft/error.throttled.json"), headers: { "retry-after": "7" } });
    await expect(http.request({ url: `${GRAPH}/me/events/x` })).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 7 });
    expect(calls.backoff).toEqual([7]);
  });
});

describe("Outlook Calendar: acting", () => {
  it("block: private, the exact card; a private busy event with no attendees; Undo deletes it unless edited", async () => {
    const { http, conn: c } = client();
    const i = parsed("block", { title: "Deep work", startsAt: "2026-10-23T13:00:00.000Z", endsAt: "2026-10-23T14:00:00.000Z" });
    const p = await spec("block").prepare(act(c, http, i));
    expect(p).toEqual({ risk: "private", summary: "Block 14:00–15:00 for “Deep work”", readback: { to: ["Only you"], what: "A private block on your Outlook Calendar, Friday 23 October 14:00–15:00" }, appearsAs: "you" });
    mock.set(`POST ${GRAPH}/me/events`, { status: 201, json: fixture("microsoft/event.block.json") });
    const r = await spec("block").run(act(c, http, i));
    expect(JSON.parse(mock.calls.at(-1)!.body!)).toEqual({ subject: "Deep work", start: { dateTime: "2026-10-23T13:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-23T14:00:00", timeZone: "UTC" }, sensitivity: "private", showAs: "busy" });
    expect(r.undo).toEqual({ kind: "block", data: { eventId: "AAMkAD-block", version: "ck-block-1" } });

    mock.set(`GET ${GRAPH}/me/events/AAMkAD-block`, { json: { id: "AAMkAD-block", changeKey: "ck-block-1", isCancelled: false } });
    mock.set(`DELETE ${GRAPH}/me/events/AAMkAD-block`, { status: 204 });
    await spec("block").undo!({ conn: c, http, data: r.undo!.data });
    expect(mock.calls.at(-1)!.method).toBe("DELETE");

    mock.set(`GET ${GRAPH}/me/events/AAMkAD-block`, { json: { id: "AAMkAD-block", changeKey: "ck-block-2", isCancelled: false } });
    mock.calls.length = 0;
    await expect(spec("block").undo!({ conn: c, http, data: r.undo!.data })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mock.calls.some((x) => x.method === "DELETE")).toBe(false);
  });

  it("move: PATCH /me/events/{id}; private without guests (Undo), shared with guests; organiser only", async () => {
    const { http, conn: c } = client();
    const i = parsed("move", { startsAt: "2026-10-24T09:00:00.000Z", endsAt: "2026-10-24T10:00:00.000Z" });
    const solo = stored({ externalId: "AAMkAD-block", title: "Deep work", guests: 0, response: "organiser" });
    expect(await spec("move").prepare(act(c, http, i, solo))).toMatchObject({ risk: "private", readback: { to: ["Only you"], what: "“Deep work” moves to Saturday 24 October 10:00–11:00" } });
    mock.set(`PATCH ${GRAPH}/me/events/AAMkAD-block`, { json: { ...fixture<Record<string, unknown>>("microsoft/event.block.json"), changeKey: "ck-block-3" } });
    const r = await spec("move").run(act(c, http, i, solo));
    expect(JSON.parse(mock.calls.at(-1)!.body!)).toEqual({ start: { dateTime: "2026-10-24T09:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-24T10:00:00", timeZone: "UTC" } });
    expect(r.undo).toMatchObject({ kind: "move", data: { eventId: "AAMkAD-block", version: "ck-block-3" } });
    const meeting = stored({ externalId: "AAMkAD-planning", title: "Planning", guests: 2, response: "organiser" });
    expect(await spec("move").prepare(act(c, http, i, meeting))).toMatchObject({ risk: "shared", readback: { to: ["The 2 guests, who get the new time"] }, appearsAs: "as you (ada@example.com)" });
    await expect(spec("move").prepare(act(c, http, i, stored()))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("invite: Outlook sends the invitations to the attendees", async () => {
    const { http, conn: c } = client();
    const i = parsed("invite", { title: "Design review", startsAt: "2026-10-23T13:00:00.000Z", endsAt: "2026-10-23T13:30:00.000Z", guests: ["grace@example.com"] });
    expect(await spec("invite").prepare(act(c, http, i))).toEqual({
      risk: "shared", summary: "Invite 1 person to “Design review”",
      readback: { to: ["grace@example.com, by email invitation from your Outlook Calendar"], what: "“Design review”, Friday 23 October 14:00–14:30" },
      appearsAs: "as you (ada@example.com)", people: 1,
    });
    mock.set(`POST ${GRAPH}/me/events`, { status: 201, json: fixture("microsoft/event.block.json") });
    await spec("invite").run(act(c, http, i));
    expect(JSON.parse(mock.calls.at(-1)!.body!).attendees).toEqual([{ emailAddress: { address: "grace@example.com" }, type: "required" }]);
  });

  it("rsvp: the accept, tentativelyAccept and decline endpoints with the note and sendResponse", async () => {
    const { http, conn: c } = client();
    const item = stored();
    mock.set(`GET ${GRAPH}/me/events/AAMkAD-design`, { json: fixture("microsoft/event.organizer.json") });
    const p = await spec("rsvp").prepare(act(c, http, parsed("rsvp", { response: "tentative", note: "Might be late" }), item));
    expect(p).toEqual({ risk: "shared", summary: "Tentatively accept “Design review”", detail: "Might be late", readback: { to: ["The organiser, Grace Hopper"], what: "You tentatively accept “Design review” on Friday 23 October at 10:00, with your note" }, appearsAs: "as you (ada@example.com)", people: 1 });
    for (const [response, path] of [["accept", "accept"], ["tentative", "tentativelyAccept"], ["decline", "decline"]] as const) {
      mock.set(`POST ${GRAPH}/me/events/AAMkAD-design/${path}`, { status: 202 });
      await spec("rsvp").run(act(c, http, parsed("rsvp", { response, note: "Thanks" }), item));
      const call = mock.calls.at(-1)!;
      expect(new URL(call.url).pathname).toBe(`/v1.0/me/events/AAMkAD-design/${path}`);
      expect(JSON.parse(call.body!)).toEqual({ comment: "Thanks", sendResponse: true });
    }
    await expect(spec("rsvp").prepare(act(c, http, parsed("rsvp", { response: "accept" }), stored({ response: "organiser" })))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("cancel: destructive; /cancel with the note when there are guests, DELETE when there are none", async () => {
    const { http, conn: c } = client();
    const meeting = stored({ externalId: "AAMkAD-planning", title: "Planning", guests: 2, response: "organiser" });
    const p = await spec("cancel").prepare(act(c, http, parsed("cancel", { note: "Moving to next week" }), meeting));
    expect(p).toEqual({ risk: "destructive", summary: "Cancel “Planning”", detail: "Moving to next week", readback: { to: ["Your calendar", "The 2 guests, who are told"], what: "“Planning” on Friday 23 October is cancelled" }, appearsAs: "as you (ada@example.com)", people: 2 });
    mock.set(`POST ${GRAPH}/me/events/AAMkAD-planning/cancel`, { status: 202 });
    await spec("cancel").run(act(c, http, parsed("cancel", { note: "Moving to next week" }), meeting));
    expect(JSON.parse(mock.calls.at(-1)!.body!)).toEqual({ comment: "Moving to next week" });
    mock.set(`DELETE ${GRAPH}/me/events/AAMkAD-block`, { status: 204 });
    await spec("cancel").run(act(c, http, parsed("cancel", {}), stored({ externalId: "AAMkAD-block", guests: 0, response: "organiser" })));
    expect(mock.calls.at(-1)!.method).toBe("DELETE");
    await expect(spec("cancel").prepare(act(c, http, parsed("cancel", {}), stored()))).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("has no revoke endpoint (the card says where to remove the app)", () => {
    expect(adapter.revoke).toBeUndefined();
  });
});
