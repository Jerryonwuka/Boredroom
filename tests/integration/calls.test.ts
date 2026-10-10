/**
 * Calls end to end (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, contract G.2), on the test
 * database with LiveKit faked (`setLiveKitForTests`, a made-up project: nothing reaches LiveKit Cloud). Company A: Olu
 * Owner, Mary HR, David leads Design (Ada, Ben).
 * - One-to-one by `to`: Ben's /calls/now rings with Ada's assistant and face; Join gives a 10-minute token for exactly his
 *   identity, the call's room and the contract's grants; heartbeats; Ben leaves → completed, one line, both read marks,
 *   the room deleted once.
 * - Decline with a message (his own DM, no missed call); missed after 30 s (one notification, however often it settles);
 *   Do not disturb and quiet hours (added silently, missed at 30 s); the caller hanging up (cancelled, missed).
 * - A group call in #Design: who is rung (online, available, not quiet, not in another call), a joiner, people who do not
 *   read the channel (HR, the owner) can neither see nor join it; 50 in it then full; a second start answers the live one;
 *   in another call (409, then leaveOther); a silent device; the 4-hour cap; 15 minutes alone.
 * - Realtime (a LISTEN sees inserts and state changes, nothing for a heartbeat); LiveKit kept in step (a leaver removed,
 *   the sweep removing a stranger and deleting a leftover room); history from each side; live calls; who is on a call;
 *   Messages (the call line on a thread, `last_is_call`, no toast).
 * - Fix review (10 October 2026): a heartbeat compares LiveKit's room with who is in the call (someone who came back with
 *   a token they kept is out within seconds, at most every 15 seconds a call); a declined call's line says so and is read
 *   for the person who declined it; a late join reads the missed-call notification and the notch's card stops offering
 *   Join.
 */
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reqState = vi.hoisted(() => ({ cookie: null as string | null, ip: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "boredroom_session" && reqState.cookie ? { name, value: reqState.cookie } : undefined) }),
  headers: async () => new Headers(reqState.ip ? { "x-forwarded-for": reqState.ip } : {}),
}));

// A made-up LiveKit project: tokens are signed with this secret and never leave the test.
const LK_KEY = "APItestkey";
const LK_SECRET = "test-secret-that-is-long-enough-000000000000";
process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = LK_KEY;
process.env.LIVEKIT_API_SECRET = LK_SECRET;

import { TokenVerifier } from "livekit-server-sdk";
import { adminQuery, adminUrl, resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture, type FixtureUser } from "@/server/services/fixtures";
import { withSystem, withUser, withWorker } from "@/server/db";
import { issueSession } from "@/server/auth";
import { sha256 } from "@/server/lib/crypto";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests, type LiveKitGateway, type LiveKitParticipant, type LiveKitRoom } from "@/server/lib/livekit";
import {
  callHistory, callHeartbeat, declineCall, endCall, forgetReconcileThrottleForTests, getCallView, joinCall, leaveCall, liveCalls, membersOnCall,
  settleCall, startCall, sweepCalls,
} from "@/server/services/calls";
import { incomingMessages, inbox, openChannel, openDirect, sendMessage, thread } from "@/server/services/messaging";
import { noticeFacts, type NoticeRow } from "@/server/services/notice-facts";
import { saveQuietHours } from "@/server/services/routines";
import { localParts } from "@/server/lib/time";
import { GET as nowGET } from "@/app/api/orgs/[org]/calls/now/route";
import { GET as historyGET, POST as startPOST } from "@/app/api/orgs/[org]/calls/route";
import { POST as joinPOST } from "@/app/api/orgs/[org]/calls/[id]/join/route";
import { GET as callGET } from "@/app/api/orgs/[org]/calls/[id]/route";
import { GET as liveGET } from "@/app/api/orgs/[org]/calls/live/route";
import { POST as heartbeatPOST } from "@/app/api/orgs/[org]/calls/[id]/heartbeat/route";
import { POST as declinePOST } from "@/app/api/orgs/[org]/calls/[id]/decline/route";
import type { OrgContext } from "@/server/lib/api";
import { CALL_LIMITS, type CallsNow, type CallView } from "@/lib/calls";

// ---- The fake LiveKit ------------------------------------------------------------------------------------------------------
const lk = {
  deleted: [] as string[],
  removed: [] as { room: string; identity: string }[],
  rooms: [] as LiveKitRoom[],
  people: new Map<string, LiveKitParticipant[]>(),
};
const fake: LiveKitGateway = {
  async listRooms() { return lk.rooms; },
  async listParticipants(room) { return lk.people.get(room) ?? []; },
  async deleteRoom(room) { lk.deleted.push(room); lk.rooms = lk.rooms.filter((r) => r.name !== room); },
  async removeParticipant(room, identity) { lk.removed.push({ room, identity }); },
};

let a: CompanyFixture;
let olu: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string;
const sessions = new Map<string, string>();
const ORG = { org: "company-a" };
const id = (c: OrgContext) => c.membership.id;
const LAGOS = "Africa/Lagos";
const hhmm = (d: Date) => { const p = localParts(d, LAGOS); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

function as(u: FixtureUser) { reqState.cookie = sessions.get(u.email) ?? null; }
type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, method: string, path: string, params: P, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: body !== undefined ? { "content-type": "application/json" } : {} };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handler(new Request(`http://localhost:3000${path}`, init), { params: Promise.resolve(params) });
}
async function now(u: FixtureUser): Promise<CallsNow> {
  as(u);
  const r = await call(nowGET, "GET", "/api/orgs/company-a/calls/now", ORG);
  expect(r.status).toBe(200);
  return r.json();
}

/** Ends every live call (as the database owner) and clears the rate limits, so each test starts clean. */
async function clean() {
  await adminQuery(`SELECT app_call_close(id, 'completed', NULL, now()) FROM calls WHERE state <> 'ended'`);
  await adminQuery(`UPDATE calls SET room_closed_at = now() WHERE room_closed_at IS NULL`);
  await adminQuery(`UPDATE profiles SET presence = 'active'`);
  await adminQuery(`DELETE FROM auth_rate_limits`);
  lk.deleted = []; lk.removed = []; lk.rooms = []; lk.people.clear();
}
const callRow = async (callId: string) => (await adminQuery<{ state: string; end_reason: string | null; room_closed_at: string | null; line_message_id: string | null; answered_at: string | null; recap_state: string }>(
  `SELECT state, end_reason, room_closed_at, line_message_id, answered_at, recap_state FROM calls WHERE id = $1`, [callId]))[0];
const partRow = async (callId: string, m: string) => (await adminQuery<{ state: string; role: string; notified_at: string | null }>(
  `SELECT state, role, notified_at FROM call_participants WHERE call_id = $1 AND membership_id = $2`, [callId, m]))[0];
const missedNotices = async (callId: string, m: string) => (await adminQuery<{ id: string; title: string }>(
  `SELECT id, title FROM notifications WHERE type = 'call.missed' AND resource_id = $1 AND recipient_membership_id = $2`, [callId, m]));
/** Online: a web session seen now (or long ago). */
async function seen(u: FixtureUser, minutesAgo: number) {
  await adminQuery(`UPDATE auth_sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE user_id = $1`, [u.authUserId, minutesAgo]);
}

beforeAll(async () => {
  await resetTestDatabase();
  forget0054();
  setLiveKitForTests(fake);
  a = await buildCompany("a", { names: { owner: "Olu Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  olu = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  for (const u of [a.owner, a.hr, a.manager, a.employee, a.employee2]) sessions.set(u.email, await withSystem((db) => issueSession(db, u.authUserId, { method: "password" })));
  // Ada named her assistant Max (orange).
  await adminQuery(`INSERT INTO assistant_profiles(membership_id, organisation_id, name, colour) VALUES ($1, $2, 'Max', 'orange')
                    ON CONFLICT (membership_id) DO UPDATE SET name = 'Max', colour = 'orange'`, [id(ada), olu.org.id]);
  design = await openChannel(david, a.teamId);
});

afterAll(() => { setLiveKitForTests(null); });
beforeEach(clean);

describe("a one-to-one call", () => {
  it("Ada calls Ben: he is rung with Max's face, joins with a token that is his alone, and leaving ends it once", async () => {
    as(a.employee);
    const res = await call(startPOST, "POST", "/api/orgs/company-a/calls", ORG, { to: id(ben) });
    expect(res.status).toBe(201);
    const started = await res.json() as { call: CallView; existing: boolean; connection: { url: string; token: string; identity: string } };
    expect(started.existing).toBe(false);
    expect(started.call).toMatchObject({ kind: "direct", state: "ringing", where: { kind: "direct", name: "Ben Okafor" }, me: { role: "caller", state: "joined", canEnd: true } });
    expect(started.connection).toMatchObject({ url: "wss://test.livekit.invalid", identity: id(ada) });
    const callId = started.call.id;

    const benNow = await now(a.employee2);
    expect(benNow).toMatchObject({ ready: true, available: true, me: id(ben), active: null, pollMs: 2000 });
    expect(benNow.ringing).toHaveLength(1);
    expect(benNow.ringing[0]).toMatchObject({ id: callId, kind: "direct", inAnotherCall: false, where: { name: "Ada Obi", href: `/app/company-a/messages?c=${started.call.where.conversationId}` },
      caller: { membershipId: id(ada), name: "Ada Obi", firstName: "Ada", assistant: { name: "Max", colour: "orange" } } });
    expect(benNow.ringing[0].caller.assistant.face).toMatchObject({ hi: expect.any(String), mid: expect.any(String), edge: expect.any(String) });
    expect(Date.parse(benNow.ringing[0].expiresAt) - Date.parse(benNow.ringing[0].rangAt)).toBe(30_000);
    const adaNow = await now(a.employee);
    expect(adaNow.ringing).toEqual([]);
    expect(adaNow.active).toMatchObject({ id: callId, kind: "direct", inRoom: 1, href: `/app/company-a/calls/${callId}` });
    expect(adaNow.pollMs).toBe(4000);

    as(a.employee2);
    const joined = await call(joinPOST, "POST", `/api/orgs/company-a/calls/${callId}/join`, { org: "company-a", id: callId }, {});
    expect(joined.status).toBe(200);
    const j = await joined.json() as { call: CallView; connection: { token: string; identity: string; expiresAt: string } };
    expect(j.call).toMatchObject({ state: "active", inRoom: 2, me: { state: "joined", canLeave: true, canEnd: true } });
    expect(j.call.durationSeconds).toBe(0);
    // The token: Ben's identity, this call's room, exactly the contract's grants, 2 minutes (fix review, 10 October 2026:
    // CALL_LIMITS.tokenTtl, it was 10), the tiles' metadata.
    const claims = await new TokenVerifier(LK_KEY, LK_SECRET).verify(j.connection.token);
    expect(claims.sub).toBe(id(ben));
    expect(claims.name).toBe("Ben Okafor");
    expect(claims.video).toEqual({
      roomJoin: true, room: `call-${callId}`, canPublish: true, canSubscribe: true, canPublishData: true,
      canPublishSources: ["microphone", "camera", "screen_share", "screen_share_audio"], canUpdateOwnMetadata: false,
    });
    expect(Number(claims.exp) - Number(claims.nbf)).toBe(CALL_LIMITS.tokenTtlMs / 1000);
    expect(CALL_LIMITS.tokenTtlMs).toBe(120_000);
    expect(JSON.parse(String(claims.metadata))).toEqual({ v: 1, name: "Ben Okafor", profileId: ben.user.profileId, avatarKey: null, assistant: { name: "Brenda", colour: expect.any(String), visor: expect.any(String), eyes: expect.any(String) } });
    expect(claims.roomConfig).toMatchObject({ name: `call-${callId}`, emptyTimeout: 300, departureTimeout: 20, maxParticipants: 50 });

    as(a.employee);
    for (const who of [a.employee, a.employee2]) {
      as(who);
      const hb = await call(heartbeatPOST, "POST", `/api/orgs/company-a/calls/${callId}/heartbeat`, { org: "company-a", id: callId });
      expect(await hb.json()).toEqual({ state: "ok" });
    }
    const on = await withUser(olu.user.profileId, (db) => membersOnCall(db, olu.org.id));
    expect([...on].sort()).toEqual([id(ada), id(ben)].sort());

    const left = await leaveCall(ben, callId);
    expect(left.call).toMatchObject({ state: "ended", endReason: "completed", me: { state: "left", canJoin: false } });
    const row = await callRow(callId);
    expect(row.room_closed_at).not.toBeNull();
    expect(lk.deleted).toEqual([`call-${callId}`]);
    const lines = await adminQuery<{ id: string; body: string; author_kind: string; call_part: string; created_at: string }>(
      `SELECT id, body, author_kind, call_part, created_at FROM messages WHERE call_id = $1`, [callId]);
    expect(lines).toEqual([expect.objectContaining({ body: "Call, under a minute", author_kind: "workspace", call_part: "line" })]);
    expect(row.line_message_id).toBe(lines[0].id);
    const reads = await adminQuery<{ membership_id: string; ok: boolean }>(
      `SELECT membership_id, last_read_at >= $2::timestamptz AS ok FROM conversation_reads WHERE conversation_id = $1`, [started.call.where.conversationId, lines[0].created_at]);
    expect(reads.filter((r) => r.ok).map((r) => r.membership_id).sort()).toEqual([id(ada), id(ben)].sort());
    // Settling again changes nothing.
    await settleCall(callId);
    expect(lk.deleted).toHaveLength(1);
    expect((await adminQuery(`SELECT 1 FROM messages WHERE call_id = $1`, [callId]))).toHaveLength(1);
    expect((await now(a.employee)).active).toBeNull();
  });

  it("Ben declines with a message: his own words in the thread, the call declined, no missed call", async () => {
    const s = await startCall(ada, { to: id(ben) });
    as(a.employee2);
    const res = await call(declinePOST, "POST", `/api/orgs/company-a/calls/${s.call.id}/decline`, { org: "company-a", id: s.call.id }, { message: "  Can't talk now. I'll call you back.  " });
    expect(res.status).toBe(200);
    const d = await res.json() as { call: CallView; messageId: string };
    expect(d.call).toMatchObject({ state: "ended", endReason: "declined", me: { state: "declined" } });
    const m = await adminQuery<{ body: string; sender_membership_id: string; author_kind: string; conversation_id: string }>(
      `SELECT body, sender_membership_id, author_kind, conversation_id FROM messages WHERE id = $1`, [d.messageId]);
    expect(m).toEqual([{ body: "Can't talk now. I'll call you back.", sender_membership_id: id(ben), author_kind: "person", conversation_id: s.call.where.conversationId }]);
    expect(await missedNotices(s.call.id, id(ben))).toEqual([]);
    // Too long a message is refused before anything happens.
    const s2 = await startCall(ada, { to: id(ben) });
    await expect(declineCall(ben, s2.call.id, "x".repeat(281))).rejects.toMatchObject({ status: 422 });
    expect((await partRow(s2.call.id, id(ben))).state).toBe("ringing");
    await expect(declineCall(ada, s2.call.id)).rejects.toMatchObject({ status: 409, code: "ALREADY_ANSWERED" });
  });

  it("Ben declines without a message: the line says he declined, read for both of them, and no missed call (fix review)", async () => {
    const s = await startCall(ada, { to: id(ben) });
    await declineCall(ben, s.call.id);
    expect(await callRow(s.call.id)).toMatchObject({ state: "ended", end_reason: "declined" });
    const line = await adminQuery<{ body: string; created_at: string }>(`SELECT body, created_at FROM messages WHERE call_id = $1`, [s.call.id]);
    expect(line.map((l) => l.body)).toEqual(["Declined call from Ada"]);
    // Read for the caller and for the person who declined it: nothing unread in their thread for a call he refused.
    const reads = await adminQuery<{ membership_id: string; ok: boolean }>(
      `SELECT membership_id, last_read_at >= $2::timestamptz AS ok FROM conversation_reads WHERE conversation_id = $1`, [s.call.where.conversationId, line[0].created_at]);
    expect(reads.filter((r) => r.ok).map((r) => r.membership_id).sort()).toEqual([id(ada), id(ben)].sort());
    expect((await inbox(ben)).direct.find((c) => c.id === s.call.where.conversationId)?.unread ?? 0).toBe(0);
    expect(await missedNotices(s.call.id, id(ben))).toEqual([]);
    // The thread draws the declined call as such.
    const t = await thread(ben, s.call.where.conversationId);
    expect(t!.messages.find((m) => m.call?.id === s.call.id)?.call).toMatchObject({ part: "line", state: "ended", endReason: "declined", answeredAt: null });
  });

  it("missed after 30 seconds: one notification however often it settles, the line, Ben unread and Ada read", async () => {
    const s = await startCall(ada, { to: id(ben) });
    const later = new Date(Date.now() + 31_000);
    await settleCall(s.call.id, { now: later });
    await settleCall(s.call.id, { now: later });
    await settleCall(s.call.id);
    expect(await callRow(s.call.id)).toMatchObject({ state: "ended", end_reason: "missed" });
    const notes = await missedNotices(s.call.id, id(ben));
    expect(notes).toEqual([{ id: expect.any(String), title: "Missed call from Ada Obi" }]);
    const line = await adminQuery<{ body: string; created_at: string }>(`SELECT body, created_at FROM messages WHERE call_id = $1`, [s.call.id]);
    expect(line.map((l) => l.body)).toEqual(["Missed call from Ada"]);
    const reads = await adminQuery<{ membership_id: string; ok: boolean }>(
      `SELECT membership_id, last_read_at >= $2::timestamptz AS ok FROM conversation_reads WHERE conversation_id = $1`, [s.call.where.conversationId, line[0].created_at]);
    expect(reads.find((r) => r.membership_id === id(ada))?.ok).toBe(true);
    expect(reads.find((r) => r.membership_id === id(ben))?.ok ?? false).toBe(false);
  });

  it("on Do not disturb, and in quiet hours, Ben is not rung: the call is missed silently at 30 s, with its notification", async () => {
    await adminQuery(`UPDATE profiles SET presence = 'busy' WHERE id = $1`, [ben.user.profileId]);
    const s = await startCall(ada, { to: id(ben) });
    expect((await partRow(s.call.id, id(ben))).state).toBe("invited");
    expect((await now(a.employee2)).ringing).toEqual([]);
    await settleCall(s.call.id, { now: new Date(Date.now() + 31_000) });
    expect(await callRow(s.call.id)).toMatchObject({ state: "ended", end_reason: "missed" });
    expect(await missedNotices(s.call.id, id(ben))).toHaveLength(1);

    await adminQuery(`UPDATE profiles SET presence = 'active'`);
    const t = new Date();
    await saveQuietHours(ben, { enabled: true, start: hhmm(new Date(t.getTime() - 60 * 60_000)), end: hhmm(new Date(t.getTime() + 2 * 60 * 60_000)), days: [0, 1, 2, 3, 4, 5, 6] });
    const q = await startCall(ada, { to: id(ben) });
    expect((await partRow(q.call.id, id(ben))).state).toBe("invited");
    expect((await now(a.employee2)).ringing).toEqual([]);
    await settleCall(q.call.id, { now: new Date(Date.now() + 31_000) });
    expect(await missedNotices(q.call.id, id(ben))).toHaveLength(1);
    await saveQuietHours(ben, { enabled: false, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] });
  });

  it("Ada hangs up before Ben answers: cancelled, and Ben missed it", async () => {
    const s = await startCall(ada, { to: id(ben) });
    const e = await endCall(ada, s.call.id);
    expect(e.call).toMatchObject({ state: "ended", endReason: "cancelled" });
    expect((await partRow(s.call.id, id(ben))).state).toBe("missed");
    expect(await missedNotices(s.call.id, id(ben))).toHaveLength(1);
  });
});

describe("a group call in #Design", () => {
  it("rings the readers who are online and available; others join; HR and the owner cannot see it", async () => {
    // Ada online; Ben online but in quiet hours; Olu and Mary do not read #Design. David starts.
    await seen(a.employee, 0); await seen(a.employee2, 0);
    const t = new Date();
    await saveQuietHours(ben, { enabled: true, start: hhmm(new Date(t.getTime() - 60 * 60_000)), end: hhmm(new Date(t.getTime() + 2 * 60 * 60_000)), days: [0, 1, 2, 3, 4, 5, 6] });
    const s = await startCall(david, { conversationId: design });
    await saveQuietHours(ben, { enabled: false, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] });
    expect(s.call).toMatchObject({ kind: "group", where: { kind: "team", name: "#Design" } });
    expect((await partRow(s.call.id, id(ada))).state).toBe("ringing");
    expect(await partRow(s.call.id, id(ben))).toBeUndefined();
    const line = await adminQuery<{ body: string }>(`SELECT body FROM messages WHERE call_id = $1`, [s.call.id]);
    expect(line.map((l) => l.body)).toEqual(["David started a call"]);
    expect((await now(a.employee)).ringing[0]).toMatchObject({ id: s.call.id, kind: "group", where: { name: "#Design" } });

    // A second start in the same channel answers the live call.
    as(a.employee2);
    const again = await call(startPOST, "POST", "/api/orgs/company-a/calls", ORG, { conversationId: design });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ existing: true, connection: null, call: { id: s.call.id } });
    // Ben was not rung but reads #Design: he joins.
    const b = await joinCall(ben, s.call.id);
    expect(b.call.me).toMatchObject({ role: "joiner", state: "joined" });
    expect(b.call.state).toBe("active");
    // Live in the thread header and on the Calls page.
    as(a.employee);
    const live = await (await call(liveGET, "GET", `/api/orgs/company-a/calls/live?conversation=${design}`, ORG)).json() as { live: { id: string; inRoom: number; youAreIn: boolean }[] };
    expect(live.live).toEqual([expect.objectContaining({ id: s.call.id, inRoom: 2, youAreIn: false })]);
    // Mary (HR, not in the team) and Olu (owner) cannot see or join it.
    for (const who of [mary, olu]) {
      expect(await getCallView(who, s.call.id)).toBeNull();
      await expect(joinCall(who, s.call.id)).rejects.toMatchObject({ status: 404 });
      expect(await liveCalls(who)).toEqual([]);
    }
    as(a.hr);
    expect((await call(callGET, "GET", `/api/orgs/company-a/calls/${s.call.id}`, { org: "company-a", id: s.call.id })).status).toBe(404);
    // Ben leaving a live group call takes his device out of the room.
    await leaveCall(ben, s.call.id);
    expect(lk.removed).toContainEqual({ room: `call-${s.call.id}`, identity: id(ben) });
    expect((await callRow(s.call.id)).state).toBe("active");
  });

  it("offline, Do not disturb and people already on a call are not rung", async () => {
    await seen(a.employee, 30); // Ada: last seen half an hour ago
    await seen(a.employee2, 0);
    await adminQuery(`UPDATE profiles SET presence = 'busy' WHERE id = $1`, [ben.user.profileId]);
    const s = await startCall(david, { conversationId: design });
    expect(await adminQuery(`SELECT membership_id FROM call_participants WHERE call_id = $1 AND role = 'invitee'`, [s.call.id])).toEqual([]);
    await clean();
    // Ben online and available but in a call with Ada: not rung.
    await seen(a.employee2, 0); await seen(a.employee, 0);
    const d = await startCall(ada, { to: id(ben) });
    await joinCall(ben, d.call.id);
    const g = await startCall(david, { conversationId: design });
    expect(await adminQuery(`SELECT membership_id FROM call_participants WHERE call_id = $1 AND role = 'invitee'`, [g.call.id])).toEqual([]);
  });

  it("50 people in a call: the 51st is told it is full", async () => {
    const s = await startCall(david, { conversationId: design });
    // 49 more members of Design, in the call (rows written as the database owner).
    await adminQuery(`
      WITH n AS (SELECT g FROM generate_series(1, 49) g),
      au AS (INSERT INTO auth_users(email, password_hash, email_verified_at) SELECT 'filler' || g || '@company-a.test', 'x', now() FROM n RETURNING id, email),
      pr AS (INSERT INTO profiles(auth_user_id, display_name, email) SELECT id, 'Filler ' || split_part(email, '@', 1), email FROM au RETURNING id),
      ms AS (INSERT INTO memberships(organisation_id, user_id, employee_code, role) SELECT $1, id, 'FIL-' || upper(substr(md5(id::text), 1, 8)), 'employee' FROM pr RETURNING id),
      tm AS (INSERT INTO team_members(team_id, organisation_id, membership_id) SELECT $2, $1, id FROM ms RETURNING membership_id)
      INSERT INTO call_participants(call_id, organisation_id, membership_id, role, state, first_joined_at, joined_at, last_seen_at)
      SELECT $3, $1, membership_id, 'joiner', 'joined', now(), now(), now() + interval '45 seconds' FROM tm`, [olu.org.id, a.teamId, s.call.id]);
    await expect(joinCall(ben, s.call.id)).rejects.toMatchObject({ status: 409, code: "CALL_FULL" });
    const v = await getCallView(ben, s.call.id);
    expect(v?.inRoom).toBe(50);
    expect(v?.me.canJoin).toBe(false);
    await adminQuery(`UPDATE call_participants SET state = 'left', left_at = now() WHERE call_id = $1 AND role = 'joiner'`, [s.call.id]);
  });

  it("someone on another call: starting one is refused with where it is; joining with leaveOther ends a one-to-one call", async () => {
    const d = await startCall(ada, { to: id(ben) });
    await joinCall(ben, d.call.id);
    const g = await startCall(david, { conversationId: design });
    await expect(startCall(ada, { to: id(david) })).rejects.toMatchObject({ status: 409, code: "IN_ANOTHER_CALL", details: { callId: d.call.id, where: { name: "Ben Okafor" } } });
    await expect(joinCall(ada, g.call.id)).rejects.toMatchObject({ status: 409, code: "IN_ANOTHER_CALL" });
    const j = await joinCall(ada, g.call.id, { leaveOther: true });
    expect(j.call.me.state).toBe("joined");
    expect(await callRow(d.call.id)).toMatchObject({ state: "ended", end_reason: "completed" });
    expect(lk.deleted).toContain(`call-${d.call.id}`);
    expect((await now(a.employee)).active?.id).toBe(g.call.id);
  });
});

describe("time settles calls", () => {
  it("a device silent past its grace has left: a one-to-one call ends", async () => {
    const d = await startCall(ada, { to: id(ben) });
    await joinCall(ben, d.call.id);
    // Ben's device: no heartbeat for 100 seconds (beyond the 90 s to connect, then 45 s).
    await adminQuery(`UPDATE call_participants SET last_seen_at = now() - interval '100 seconds' WHERE call_id = $1 AND membership_id = $2`, [d.call.id, id(ben)]);
    // His view settles on read.
    const v = await getCallView(ada, d.call.id);
    expect(v).toMatchObject({ state: "ended", endReason: "completed" });
    expect((await partRow(d.call.id, id(ben))).state).toBe("left");
    expect(await callHeartbeat(ben, d.call.id)).toEqual({ state: "ended" });
  });

  it("the 4-hour cap, and 15 minutes alone", async () => {
    const d = await startCall(ada, { to: id(ben) });
    await joinCall(ben, d.call.id);
    await settleCall(d.call.id, { now: new Date(Date.now() + 4 * 3_600_000 + 60_000) });
    expect(await callRow(d.call.id)).toMatchObject({ state: "ended", end_reason: "cap" });

    const g = await startCall(david, { conversationId: design });
    await adminQuery(`UPDATE call_participants SET last_seen_at = now() + interval '20 minutes' WHERE call_id = $1 AND membership_id = $2`, [g.call.id, id(david)]);
    await settleCall(g.call.id, { now: new Date(Date.now() + 14 * 60_000) });
    expect((await callRow(g.call.id)).state).not.toBe("ended");
    await settleCall(g.call.id, { now: new Date(Date.now() + 16 * 60_000) });
    expect(await callRow(g.call.id)).toMatchObject({ state: "ended", end_reason: "alone" });
  });

  it("a heartbeat from someone who has left says so", async () => {
    const g = await startCall(david, { conversationId: design });
    await joinCall(ben, g.call.id);
    await leaveCall(ben, g.call.id);
    expect(await callHeartbeat(ben, g.call.id)).toEqual({ state: "left" });
    await expect(callHeartbeat(olu, g.call.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("realtime and LiveKit kept in step", () => {
  it("a LISTEN sees a call's inserts and state changes, and nothing for a heartbeat", async () => {
    const c = new Client({ connectionString: adminUrl() });
    await c.connect();
    const got: { table: string; op: string }[] = [];
    c.on("notification", (n) => { const p = JSON.parse(n.payload ?? "{}"); if (String(p.table).startsWith("call")) got.push({ table: p.table, op: p.op }); });
    await c.query(`LISTEN org_${olu.org.id.replace(/-/g, "")}`);
    try {
      const s = await startCall(ada, { to: id(ben) });
      await joinCall(ben, s.call.id);
      await new Promise((r) => setTimeout(r, 200));
      expect(got).toEqual(expect.arrayContaining([{ table: "calls", op: "INSERT" }, { table: "call_participants", op: "INSERT" }, { table: "calls", op: "UPDATE" }, { table: "call_participants", op: "UPDATE" }]));
      const before = got.length;
      await callHeartbeat(ada, s.call.id);
      await callHeartbeat(ben, s.call.id);
      await new Promise((r) => setTimeout(r, 200));
      expect(got.length).toBe(before);
    } finally { await c.end(); }
  });

  it("the sweep takes a stranger out of a live room and deletes a leftover room of an ended call", async () => {
    const g = await startCall(david, { conversationId: design });
    const old = await startCall(ada, { to: id(ben) });
    await leaveCall(ada, old.call.id);
    lk.people.set(`call-${g.call.id}`, [{ identity: id(david), joinedAt: Date.now() }, { identity: id(olu), joinedAt: Date.now() }]);
    lk.rooms = [
      { name: `call-${old.call.id}`, numParticipants: 0, createdAt: Date.now() - 10 * 60_000 },
      { name: `call-${g.call.id}`, numParticipants: 2, createdAt: Date.now() - 10 * 60_000 },
      { name: "someone-elses-room", numParticipants: 0, createdAt: Date.now() - 10 * 60_000 },
    ];
    lk.deleted = []; lk.removed = [];
    const r = await sweepCalls({ rooms: true });
    expect(lk.removed).toEqual([{ room: `call-${g.call.id}`, identity: id(olu) }]);
    expect(lk.deleted).toEqual([`call-${old.call.id}`]);
    expect(r.strayRooms).toBe(1);
  });
});

describe("fix review (10 October 2026)", () => {
  it("a heartbeat compares LiveKit's room with who is in the call, at most every 15 seconds a call", async () => {
    const g = await startCall(david, { conversationId: design });
    await joinCall(ada, g.call.id);
    await joinCall(ben, g.call.id);
    await leaveCall(ben, g.call.id);
    // Ben comes back to the room with the token he kept; nobody tells Boredroom (no webhook on localhost).
    const room = `call-${g.call.id}`;
    lk.people.set(room, [{ identity: id(david), joinedAt: Date.now() }, { identity: id(ada), joinedAt: Date.now() }, { identity: id(ben), joinedAt: Date.now() }]);
    lk.removed = [];
    forgetReconcileThrottleForTests();
    const beat = async (u: FixtureUser) => {
      as(u);
      const hb = await call(heartbeatPOST, "POST", `/api/orgs/company-a/calls/${g.call.id}/heartbeat`, { org: "company-a", id: g.call.id });
      expect(await hb.json()).toEqual({ state: "ok" });
    };
    await beat(a.employee);
    await expect.poll(() => lk.removed, { timeout: 3000 }).toEqual([{ room, identity: id(ben) }]);
    // Within 15 seconds no device compares again (one LiveKit request a call, whoever beats).
    lk.removed = [];
    forgetReconcileThrottleForTests();
    await beat(a.manager);
    await new Promise((r) => setTimeout(r, 300));
    expect(lk.removed).toEqual([]);
    // Fifteen seconds on, the next beat compares again.
    await adminQuery(`UPDATE calls SET reconciled_at = now() - interval '16 seconds' WHERE id = $1`, [g.call.id]);
    forgetReconcileThrottleForTests();
    await beat(a.manager);
    await expect.poll(() => lk.removed, { timeout: 3000 }).toEqual([{ room, identity: id(ben) }]);
    // A beat that is not "ok" never compares.
    lk.removed = [];
    await adminQuery(`UPDATE calls SET reconciled_at = NULL WHERE id = $1`, [g.call.id]);
    forgetReconcileThrottleForTests();
    as(a.employee2);
    const left = await call(heartbeatPOST, "POST", `/api/orgs/company-a/calls/${g.call.id}/heartbeat`, { org: "company-a", id: g.call.id });
    expect(await left.json()).toEqual({ state: "left" });
    await new Promise((r) => setTimeout(r, 300));
    expect(lk.removed).toEqual([]);
  });

  it("joining a call late reads its missed-call notification, and the notch's card stops offering Join", async () => {
    // Ada online, so David's call in #Design rings her; she lets it ring out, then joins while it goes on.
    await seen(a.employee, 0); await seen(a.employee2, 30);
    const g = await startCall(david, { conversationId: design });
    await adminQuery(`UPDATE call_participants SET last_seen_at = now() + interval '5 minutes' WHERE call_id = $1 AND membership_id = $2`, [g.call.id, id(david)]);
    await settleCall(g.call.id, { now: new Date(Date.now() + 31_000) });
    const rowsOf = () => withUser(ada.user.profileId, (db) => db.query<NoticeRow & { read_at: string | null }>(
      `SELECT id, type, title, body, href, resource_id, resource_type, deduplication_key, created_at, read_at FROM notifications
       WHERE recipient_membership_id = $1 AND type = 'call.missed' AND resource_id = $2`, [id(ada), g.call.id]));
    const before = await rowsOf();
    expect(before).toHaveLength(1);
    expect(before[0].read_at).toBeNull();
    expect((await noticeFacts(ada, before)).get(before[0].id)).toMatchObject({ kind: "call", live: true });
    // The late join (the web's Join, or the notch's Accept) reads it: the bell and the notch stop offering Join.
    await joinCall(ada, g.call.id);
    const after = await rowsOf();
    expect(after[0].read_at).not.toBeNull();
    expect((await noticeFacts(ada, after)).get(after[0].id)).toMatchObject({ kind: "call", live: false });
    // Someone else's missed call stays as it was.
    expect((await adminQuery(`SELECT 1 FROM notifications WHERE type = 'call.missed' AND resource_id = $1 AND recipient_membership_id <> $2 AND read_at IS NOT NULL`, [g.call.id, id(ada)]))).toEqual([]);
  });

  it("one ringer: while Ben's notch rings aloud on his network, his browser there shows the card without a ring", async () => {
    await clean();
    await adminQuery(`DELETE FROM call_ringers`);
    // Ben's notch: a desktop session of his own.
    const notch = await withSystem((db) => issueSession(db, a.employee2.authUserId, { method: "password" }));
    await adminQuery(`UPDATE auth_sessions SET kind = 'desktop' WHERE token_hash = $1`, [sha256(notch)]);
    const poll = async (token: string | null, query: string, ip: string): Promise<CallsNow> => {
      reqState.cookie = token; reqState.ip = ip;
      try {
        const r = await call(nowGET, "GET", `/api/orgs/company-a/calls/now${query}`, ORG);
        expect(r.status).toBe(200);
        return r.json();
      } finally { reqState.ip = null; }
    };
    const web = sessions.get(a.employee2.email)!;
    expect((await poll(web, "", "10.0.0.7")).ringsOnDesktop).toBe(false);
    // The notch says it rings aloud: the browser on the same network stays silent, one elsewhere still rings.
    expect((await poll(notch, "?ring=1", "10.0.0.7")).ringsOnDesktop).toBe(true);
    expect((await poll(web, "", "10.0.0.7")).ringsOnDesktop).toBe(true);
    expect((await poll(web, "", "192.168.1.20")).ringsOnDesktop).toBe(false);
    // Only Ben's own: Ada's browser on that network still rings.
    expect((await poll(sessions.get(a.employee.email)!, "", "10.0.0.7")).ringsOnDesktop).toBe(false);
    // The network is a keyed digest, never the address.
    const kept = await adminQuery<{ network: string }>(`SELECT network FROM call_ringers WHERE membership_id = $1`, [id(ben)]);
    expect(kept).toHaveLength(1);
    expect(kept[0].network).not.toContain("10.0.0.7");
    // A browser cannot claim to be the ringer.
    await adminQuery(`DELETE FROM call_ringers`);
    expect((await poll(web, "?ring=1", "10.0.0.7")).ringsOnDesktop).toBe(false);
    expect(await adminQuery(`SELECT 1 FROM call_ringers`)).toEqual([]);
    // The notch's sounds go off (or quiet hours start): ?ring=0 hands the ring back at once.
    await poll(notch, "?ring=1", "10.0.0.7");
    await poll(notch, "?ring=0", "10.0.0.7");
    expect((await poll(web, "", "10.0.0.7")).ringsOnDesktop).toBe(false);
    // A notch that stops polling (asleep, quit) hands it back after 20 seconds.
    await poll(notch, "?ring=1", "10.0.0.7");
    await adminQuery(`UPDATE call_ringers SET rings_at = now() - make_interval(secs => $1)`, [CALL_LIMITS.desktopRingerMs / 1000 + 1]);
    expect((await poll(web, "", "10.0.0.7")).ringsOnDesktop).toBe(false);
  });
});

describe("history, live calls and who is on a call", () => {
  it("each side's outcome: joined, missed, declined, not answered; the missed filter reads the missed-call notifications", async () => {
    await adminQuery(`DELETE FROM notifications WHERE type = 'call.missed'`);
    const answered = await startCall(ada, { to: id(ben) });
    await joinCall(ben, answered.call.id);
    await leaveCall(ada, answered.call.id);
    const missed = await startCall(ada, { to: id(ben) });
    await settleCall(missed.call.id, { now: new Date(Date.now() + 31_000) });
    const declined = await startCall(ada, { to: id(ben) });
    await declineCall(ben, declined.call.id);

    const benAll = await callHistory(ben, { filter: "all" });
    const outcome = (h: typeof benAll, callId: string) => h.items.find((i) => i.id === callId)?.outcome;
    expect(outcome(benAll, answered.call.id)).toBe("joined");
    expect(outcome(benAll, missed.call.id)).toBe("missed");
    expect(outcome(benAll, declined.call.id)).toBe("declined");
    const adaAll = await callHistory(ada, { filter: "all" });
    expect(outcome(adaAll, answered.call.id)).toBe("joined");
    expect(outcome(adaAll, missed.call.id)).toBe("not_answered");
    expect(adaAll.items.find((i) => i.id === answered.call.id)).toMatchObject({ youStarted: true, people: [expect.objectContaining({ membershipId: id(ben) })], peopleCount: 2, live: false });
    // Olu never sees their calls.
    expect((await callHistory(olu, { filter: "all" })).items.filter((i) => [answered.call.id, missed.call.id, declined.call.id].includes(i.id))).toEqual([]);

    expect((await adminQuery(`SELECT 1 FROM notifications WHERE type = 'call.missed' AND recipient_membership_id = $1 AND read_at IS NULL`, [id(ben)])).length).toBeGreaterThan(0);
    as(a.employee2);
    const res = await call(historyGET, "GET", "/api/orgs/company-a/calls?filter=missed&limit=50", ORG);
    const missedOnly = await res.json() as { ready: boolean; items: { id: string; outcome: string }[] };
    expect(missedOnly.ready).toBe(true);
    expect(missedOnly.items.every((i) => i.outcome === "missed")).toBe(true);
    expect(missedOnly.items.map((i) => i.id)).toContain(missed.call.id);
    expect(await adminQuery(`SELECT 1 FROM notifications WHERE type = 'call.missed' AND recipient_membership_id = $1 AND read_at IS NULL`, [id(ben)])).toEqual([]);
    // Paging.
    const page = await callHistory(ben, { filter: "all", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextBefore).toBe(page.items[0].startedAt);
    const next = await callHistory(ben, { filter: "all", limit: 1, before: page.nextBefore });
    expect(next.items[0].id).not.toBe(page.items[0].id);
  });

  it("live calls and who is on a call", async () => {
    await seen(a.employee2, 30); // Ben offline: not rung, so he reads the call without a row on it
    const g = await startCall(david, { conversationId: design });
    await joinCall(ada, g.call.id);
    const live = await liveCalls(ben, { conversationId: design });
    expect(live).toEqual([expect.objectContaining({ id: g.call.id, kind: "group", inRoom: 2, youAreIn: false, notesOn: false, href: `/app/company-a/calls/${g.call.id}` })]);
    expect(live[0].people.map((p) => p.membershipId).sort()).toEqual([id(ada), id(david)].sort());
    expect(await withWorker((db) => membersOnCall(db, olu.org.id))).toEqual(new Set([id(ada), id(david)]));
    const view = await getCallView(ben, g.call.id);
    expect(view?.me).toMatchObject({ access: "reader", canJoin: true, canLeave: false, canEnd: false });
    expect(await getCallView(ada, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("Messages", () => {
  it("a thread draws call lines with the call, the inbox says the last message is one, and no toast is raised", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const g = await startCall(david, { conversationId: design });
    await joinCall(ada, g.call.id);
    const t = await thread(ben, design);
    const line = t!.messages.find((m) => m.call?.id === g.call.id);
    expect(line?.call).toMatchObject({ part: "line", kind: "group", state: "active", inRoom: 2, joinedCount: 2, startedBy: { membershipId: id(david), firstName: "David" }, href: `/app/company-a/calls/${g.call.id}` });
    expect(line?.call?.joinedNames).toEqual(["David", "Ada"]);
    expect(line?.author_kind).toBe("workspace");
    expect(t!.messages.filter((m) => !m.call).every((m) => m.call === null)).toBe(true);
    const box = await inbox(ben);
    expect(box.channels.find((c) => c.id === design)?.last_is_call).toBe(true);
    expect(box.channels.find((c) => c.kind === "organisation")?.last_is_call).toBe(false);
    expect((await incomingMessages(ben, since)).filter((m) => m.conversation_id === design)).toEqual([]);
    // The direct thread's last message is the last one-to-one call's line; a person's message after it is not.
    const dm = await openDirect(ada, id(ben));
    expect(box.direct.find((c) => c.id === dm)?.last_is_call).toBe(true);
    await sendMessage(ada, { conversationId: dm, body: "Thanks for the call" });
    expect((await inbox(ben)).direct.find((c) => c.id === dm)?.last_is_call).toBe(false);
  });
});
