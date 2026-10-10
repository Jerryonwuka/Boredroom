/**
 * Who may see and do what with calls (owner decisions, 8 October 2026: phase 8, contract G.2), straight against the
 * database as the restricted app role (`appQueryAs`, row-level security) and through the services. Company A: Olu Owner,
 * Mary HR, David leads Design (Ada, Ben).
 * - A one-to-one call is its two people's alone: the owner, HR and the team lead read none of its rows.
 * - A channel's readers read its call's rows, but no transcript line and no recap: those are for the people who were on
 *   the call, with no owner, HR or lead exception.
 * - Nobody writes the calls tables directly, runs the worker's steps (settle, finish) or the internal ones (close,
 *   settle_at); every person's step checks the conversation (not readable: not_found; a non-reader rung: bad_people;
 *   Everyone or an archived channel: not_here).
 * - Every step is refused while someone else is signed in as the person; the reads still work.
 * - A message carrying a call is only ever the worker's; who started a call never changes.
 * - Consent: a "no" is shown to nobody else; a "yes" only to people with a row on the call.
 * - Who is on a call follows who reads its conversation (fix review, 10 October 2026): someone taken out of the channel
 *   or the team, or whose membership ends, is out of its live call at once (their row left, their device taken out of
 *   LiveKit's room) and can no longer join it again, beat, add words, switch notes or read its transcript; a ring to them
 *   is missed silently; a device that still beats before any settle is told "left" and taken out; a starter taken out
 *   cannot end the call for everyone.
 * LiveKit is faked; the made-up project's keys are set below.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = "APItestkey";
process.env.LIVEKIT_API_SECRET = "test-secret-that-is-long-enough-000000000000";

import { adminQuery, appQueryAs, resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withSystem, withUser } from "@/server/db";
import { issueSession } from "@/server/auth";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests } from "@/server/lib/livekit";
import {
  acceptCall, callHeartbeat, callHistory, callsNowIn, declineCall, endCall, getCallView, joinCall, leaveCall, liveCalls, startCall,
} from "@/server/services/calls";
import { createChannel, deleteConversation, openChannel, openDirect, sendMessage, updateChannel } from "@/server/services/messaging";
import { revokeMembership, setTeamMember } from "@/server/services/orgs";
import type { OrgContext } from "@/server/lib/api";

let a: CompanyFixture;
let olu: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string, dm: string, everyone: string;
let directCall: string, groupCall: string;
const id = (c: OrgContext) => c.membership.id;
const pid = (c: OrgContext) => c.user.profileId;

beforeAll(async () => {
  await resetTestDatabase();
  forget0054();
  setLiveKitForTests({ listRooms: async () => [], listParticipants: async () => [], deleteRoom: async () => undefined, removeParticipant: async () => undefined });
  a = await buildCompany("a", { names: { owner: "Olu Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  olu = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = await openChannel(david, a.teamId);
  everyone = await openChannel(olu, null);
  dm = await openDirect(ada, id(ben));
  // A one-to-one call, answered, with notes on and a line from each of them, and a recap (written as the owner).
  directCall = (await startCall(ada, { to: id(ben) })).call.id;
  await joinCall(ben, directCall);
  await withUser(pid(ada), (db) => db.query(`SELECT app_call_set_notes($1, true)`, [directCall]));
  await withUser(pid(ben), (db) => db.query(`SELECT app_call_consent($1, 'yes')`, [directCall]));
  const at = Date.now();
  await withUser(pid(ada), (db) => db.query(`SELECT app_call_add_lines($1, $2::jsonb)`, [directCall, JSON.stringify([{ seq: 1, at, text: "Ada speaking" }])]));
  await withUser(pid(ben), (db) => db.query(`SELECT app_call_add_lines($1, $2::jsonb)`, [directCall, JSON.stringify([{ seq: 2, at, text: "Ben speaking" }])]));
  // Over (Ben hung up): its rows stay, and Ada is free for the group call.
  await leaveCall(ben, directCall);
  // A group call in #Design: David started it, Ada joined; Ben (no session: offline, never rung) only reads the channel.
  groupCall = (await startCall(david, { conversationId: design })).call.id;
  await joinCall(ada, groupCall);
  await withUser(pid(ada), (db) => db.query(`SELECT app_call_set_notes($1, true)`, [groupCall]));
  await withUser(pid(ada), (db) => db.query(`SELECT app_call_add_lines($1, $2::jsonb)`, [groupCall, JSON.stringify([{ seq: 1, at: Date.now(), text: "Design talk" }])]));
  await adminQuery(`INSERT INTO call_recaps(call_id, organisation_id, summary, lines_delete_after) VALUES ($1, $2, 'A summary.', now() + interval '7 days')`, [groupCall, olu.org.id]);
});

afterAll(() => { setLiveKitForTests(null); });

describe("reading", () => {
  it("nobody outside a one-to-one call reads any of its rows: not the owner, HR or the team lead", async () => {
    for (const who of [olu, mary, david]) {
      expect(await appQueryAs(pid(who), `SELECT id FROM calls WHERE id = $1`, [directCall])).toEqual([]);
      expect(await appQueryAs(pid(who), `SELECT id FROM call_participants WHERE call_id = $1`, [directCall])).toEqual([]);
      expect(await appQueryAs(pid(who), `SELECT id FROM call_note_consents WHERE call_id = $1`, [directCall])).toEqual([]);
      expect(await appQueryAs(pid(who), `SELECT id FROM call_transcript_lines WHERE call_id = $1`, [directCall])).toEqual([]);
      expect(await getCallView(who, directCall)).toBeNull();
    }
    expect(await appQueryAs(pid(ada), `SELECT text FROM call_transcript_lines WHERE call_id = $1 ORDER BY seq`, [directCall])).toEqual([{ text: "Ada speaking" }, { text: "Ben speaking" }]);
    expect(await appQueryAs(pid(ben), `SELECT id FROM calls WHERE id = $1`, [directCall])).toHaveLength(1);
  });

  it("a channel's readers read its call, but not its transcript nor its recap; HR and the owner read nothing", async () => {
    expect(await appQueryAs(pid(ben), `SELECT id FROM calls WHERE id = $1`, [groupCall])).toHaveLength(1);
    expect((await appQueryAs(pid(ben), `SELECT membership_id FROM call_participants WHERE call_id = $1`, [groupCall])).length).toBe(2);
    expect(await appQueryAs(pid(ben), `SELECT id FROM call_transcript_lines WHERE call_id = $1`, [groupCall])).toEqual([]);
    expect(await appQueryAs(pid(ben), `SELECT call_id FROM call_recaps WHERE call_id = $1`, [groupCall])).toEqual([]);
    for (const who of [olu, mary]) {
      expect(await appQueryAs(pid(who), `SELECT id FROM calls WHERE id = $1`, [groupCall])).toEqual([]);
      expect(await appQueryAs(pid(who), `SELECT call_id FROM call_recaps WHERE call_id = $1`, [groupCall])).toEqual([]);
    }
    expect(await appQueryAs(pid(ada), `SELECT summary FROM call_recaps WHERE call_id = $1`, [groupCall])).toEqual([{ summary: "A summary." }]);
    expect(await appQueryAs(pid(david), `SELECT text FROM call_transcript_lines WHERE call_id = $1`, [groupCall])).toEqual([{ text: "Design talk" }]);
  });

  it("consent: a 'yes' is shown only to people with a row on the call, and a 'no' to nobody else", async () => {
    // Ada said yes on the group call (she turned notes on): David (on it) sees it; Ben (reads the channel only) does not.
    expect(await appQueryAs(pid(david), `SELECT membership_id, consent FROM call_note_consents WHERE call_id = $1`, [groupCall])).toEqual([{ membership_id: id(ada), consent: "yes" }]);
    expect(await appQueryAs(pid(ben), `SELECT membership_id FROM call_note_consents WHERE call_id = $1`, [groupCall])).toEqual([]);
    const v = await getCallView(ben, groupCall);
    expect(v?.notes.included).toEqual([]);
    expect(v?.me.access).toBe("reader");
    // Ada changes her mind: her lines go, and David sees nothing of her answer.
    await withUser(pid(ada), (db) => db.query(`SELECT app_call_consent($1, 'no')`, [groupCall]));
    expect(await appQueryAs(pid(david), `SELECT membership_id FROM call_note_consents WHERE call_id = $1`, [groupCall])).toEqual([]);
    expect(await appQueryAs(pid(ada), `SELECT consent FROM call_note_consents WHERE call_id = $1`, [groupCall])).toEqual([{ consent: "no" }]);
    expect(await appQueryAs(pid(david), `SELECT id FROM call_transcript_lines WHERE call_id = $1 AND membership_id = $2`, [groupCall, id(ada)])).toEqual([]);
    const dv = await getCallView(david, groupCall);
    expect(dv?.participants.find((p) => p.membershipId === id(ada))?.consent).toBeNull();
    expect(dv?.notes.included).toEqual([]);
    const av = await getCallView(ada, groupCall);
    expect(av?.notes.myConsent).toBe("no");
  });
});

describe("writing", () => {
  it("nobody writes the calls tables directly", async () => {
    await expect(appQueryAs(pid(ada), `INSERT INTO calls(organisation_id, conversation_id, conversation_kind, kind, room_name, started_by) VALUES ($1, $2, 'direct', 'direct', 'x', $3)`, [olu.org.id, dm, id(ada)])).rejects.toThrow();
    expect(await appQueryAs(pid(ada), `UPDATE calls SET state = 'ended', ended_at = now(), end_reason = 'completed' WHERE id = $1 RETURNING id`, [directCall])).toEqual([]);
    expect(await appQueryAs(pid(ada), `UPDATE call_participants SET state = 'left' WHERE call_id = $1 RETURNING id`, [directCall])).toEqual([]);
    expect(await appQueryAs(pid(ada), `UPDATE call_note_consents SET consent = 'yes' WHERE call_id = $1 RETURNING id`, [directCall])).toEqual([]);
    await expect(appQueryAs(pid(ada), `INSERT INTO call_note_consents(call_id, organisation_id, membership_id, consent) VALUES ($1, $2, $3, 'yes')`, [groupCall, olu.org.id, id(ben)])).rejects.toThrow();
    await expect(appQueryAs(pid(ada), `INSERT INTO call_transcript_lines(call_id, organisation_id, membership_id, seq, spoken_at, text) VALUES ($1, $2, $3, 99, now(), 'forged')`, [directCall, olu.org.id, id(ben)])).rejects.toThrow();
    expect(await appQueryAs(pid(ada), `DELETE FROM call_transcript_lines WHERE call_id = $1 RETURNING id`, [directCall])).toEqual([]);
    await expect(appQueryAs(pid(ada), `INSERT INTO call_recaps(call_id, organisation_id, summary, lines_delete_after) VALUES ($1, $2, 'forged', now())`, [directCall, olu.org.id])).rejects.toThrow();
    for (const t of ["calls", "call_participants", "call_note_consents", "call_recaps"]) {
      await expect(appQueryAs(pid(ada), `DELETE FROM ${t}`)).rejects.toThrow(/permission denied/);
    }
    expect((await adminQuery<{ state: string; end_reason: string }>(`SELECT state, end_reason FROM calls WHERE id = $1`, [directCall]))[0]).toEqual({ state: "ended", end_reason: "completed" });
  });

  it("the worker's steps and the internal ones are not the person's", async () => {
    await expect(appQueryAs(pid(ada), `SELECT app_call_settle($1, NULL)`, [directCall])).rejects.toThrow(/CALL_SETTLE_FORBIDDEN/);
    await expect(appQueryAs(pid(ada), `SELECT app_call_finish($1, 'empty')`, [directCall])).rejects.toThrow(/CALL_FINISH_FORBIDDEN/);
    await expect(appQueryAs(pid(ada), `SELECT app_call_close($1, 'completed', NULL, now())`, [directCall])).rejects.toThrow(/permission denied/);
    await expect(appQueryAs(pid(ada), `SELECT app_call_settle_at($1, now())`, [directCall])).rejects.toThrow(/permission denied/);
  });

  it("starting checks the conversation: not readable, a non-reader rung, Everyone, an archived channel", async () => {
    const start = async (who: OrgContext, conv: string, ring: string[] = [], quiet: string[] = []) =>
      (await appQueryAs(pid(who), `SELECT app_call_start($1, $2::uuid[], $3::uuid[]) AS r`, [conv, ring, quiet]))[0].r as { word: string };
    expect((await start(olu, dm)).word).toBe("not_found");
    expect((await start(mary, design)).word).toBe("not_found");
    // (#Design has a live call: a second start there answers it rather than checking whom it would ring.)
    expect((await start(david, design, [id(olu)])).word).toBe("exists");
    expect((await start(ada, everyone)).word).toBe("not_here");
    // (Ada is on the group call: Ben, who is on none, starts these.)
    const named = (await createChannel(ben, { title: "Launch", memberIds: [id(ada)] })).id;
    expect((await start(ben, named, [id(david)])).word).toBe("bad_people");
    await updateChannel(ben, named, { archived: true });
    expect((await start(ben, named)).word).toBe("not_here");
    await expect(startCall(ada, { conversationId: everyone })).rejects.toMatchObject({ status: 409, code: "CALL_NOT_HERE" });
    await expect(startCall(olu, { conversationId: dm })).rejects.toMatchObject({ status: 404 });
    // A direct call names exactly its other person.
    const dm2 = await openDirect(ben, id(olu));
    expect((await start(ben, dm2, [id(ada)])).word).toBe("bad_people");
    expect((await start(ben, dm2, [id(olu)], [id(olu)])).word).toBe("bad_people");
    expect((await start(ben, dm2, [], [])).word).toBe("bad_people");
  });

  it("every step is refused while someone else is signed in as the person; reading still works", async () => {
    const as = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "00000000-0000-0000-0000-000000000001", adminEmail: "support@boredroom.test" } } });
    const imp = as(ada);
    const refused = { status: 403, code: "FORBIDDEN", message: "Only Ada can be on calls. You're signed in as them." };
    await expect(startCall(imp, { to: id(ben) })).rejects.toMatchObject(refused);
    await expect(joinCall(imp, groupCall)).rejects.toMatchObject(refused);
    await expect(acceptCall(imp, groupCall)).rejects.toMatchObject(refused);
    await expect(declineCall(imp, groupCall)).rejects.toMatchObject(refused);
    await expect(leaveCall(imp, groupCall)).rejects.toMatchObject(refused);
    await expect(endCall(imp, groupCall)).rejects.toMatchObject(refused);
    await expect(callHeartbeat(imp, groupCall)).rejects.toMatchObject(refused);
    expect((await getCallView(imp, groupCall))?.id).toBe(groupCall);
    expect((await callHistory(imp, { filter: "all" })).ready).toBe(true);
    expect((await liveCalls(imp)).length).toBeGreaterThan(0);
  });

  it("a message carrying a call is only ever the worker's", async () => {
    await expect(appQueryAs(pid(ada), `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, call_id, call_part) VALUES ($1, $2, $3, 'Call, 1 h', $4, 'line')`,
      [olu.org.id, dm, id(ada), directCall])).rejects.toThrow(/messages_call_part_check/);
    await expect(appQueryAs(pid(ada), `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, author_kind, call_id, call_part) VALUES ($1, $2, $3, 'Call, 1 h', 'workspace', $4, 'line')`,
      [olu.org.id, dm, id(ada), directCall])).rejects.toThrow(/ASSISTANT_AUTHOR/);
    const mine = await sendMessage(ada, { conversationId: dm, body: "Hello" });
    await expect(appQueryAs(pid(ada), `UPDATE messages SET call_id = $2, call_part = 'line' WHERE id = $1`, [mine.id, directCall])).rejects.toThrow(/messages_call_part_check/);
    // The group call's line (the worker's, sent as David) cannot be edited or withdrawn by him.
    const line = (await adminQuery<{ id: string }>(`SELECT id FROM messages WHERE call_id = $1`, [groupCall]))[0];
    expect(await appQueryAs(pid(david), `UPDATE messages SET body = 'changed' WHERE id = $1 RETURNING id`, [line.id]).catch(() => [])).toEqual([]);
    expect((await adminQuery<{ body: string }>(`SELECT body FROM messages WHERE id = $1`, [line.id]))[0].body).toBe("David started a call");
  });

  it("who started a call, and where, never changes; its state only moves forward", async () => {
    await expect(adminQuery(`UPDATE calls SET started_by = $2 WHERE id = $1`, [directCall, id(ben)])).rejects.toThrow(/CALL_FIXED/);
    await expect(adminQuery(`UPDATE calls SET conversation_id = $2 WHERE id = $1`, [directCall, design])).rejects.toThrow(/CALL_FIXED/);
    await expect(adminQuery(`UPDATE call_participants SET membership_id = $2 WHERE call_id = $1 AND membership_id = $3`, [directCall, id(olu), id(ben)])).rejects.toThrow(/CALL_PARTICIPANT_FIXED/);
    await expect(adminQuery(`UPDATE calls SET state = 'active' WHERE id = $1`, [directCall])).rejects.toThrow(/CALL_TRANSITION/);
  });
});

describe("who is on a call follows who reads its conversation (fix review, 10 October 2026)", () => {
  // LiveKit, faked: who was taken out of which room.
  const lk = { removed: [] as { room: string; identity: string }[] };
  const room = (callId: string) => `call-${callId}`;
  const outOf = (callId: string) => lk.removed.filter((r) => r.room === room(callId)).map((r) => r.identity);
  const part = async (callId: string, c: OrgContext) => (await adminQuery<{ state: string; notified_at: string | null }>(
    `SELECT state, notified_at FROM call_participants WHERE call_id = $1 AND membership_id = $2`, [callId, id(c)]))[0];
  const word = async (c: OrgContext, sql: string, params: unknown[]) => (await withUser(pid(c), (db) => db.one<{ r: unknown }>(sql, params))).r;
  const closeAll = () => adminQuery(`SELECT app_call_close(id, 'completed', NULL, now()) FROM calls WHERE state <> 'ended'`);

  beforeAll(async () => {
    await closeAll();
    setLiveKitForTests({
      listRooms: async () => [], listParticipants: async () => [], deleteRoom: async () => undefined,
      removeParticipant: async (r, identity) => { lk.removed.push({ room: r, identity }); },
    });
  });
  beforeEach(async () => { lk.removed = []; await closeAll(); });

  it("taken out of a channel during its call: out of it at once, and nothing of it is theirs any more", async () => {
    // Ada makes #Side with Ben and David and calls there; both join. Notes on, Ben says yes and speaks.
    const side = (await createChannel(ada, { title: "Side", memberIds: [id(ben), id(david)] })).id;
    const callId = (await startCall(ada, { conversationId: side })).call.id;
    await joinCall(ben, callId);
    await joinCall(david, callId);
    await withUser(pid(ada), (db) => db.query(`SELECT app_call_set_notes($1, true)`, [callId]));
    await withUser(pid(ben), (db) => db.query(`SELECT app_call_consent($1, 'yes')`, [callId]));
    expect(await word(ben, `SELECT app_call_add_lines($1, $2::jsonb) AS r`, [callId, JSON.stringify([{ seq: 1, at: Date.now(), text: "Ben, before" }])])).toMatchObject({ word: "ok", accepted: 1 });
    expect(await callHeartbeat(ben, callId)).toEqual({ state: "ok" });

    // Ada takes Ben out of #Side: his row leaves now and his device is taken out of LiveKit's room; the call goes on.
    await updateChannel(ada, side, { memberIds: [id(david)] });
    expect((await part(callId, ben)).state).toBe("left");
    expect(outOf(callId)).toEqual([id(ben)]);
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [callId]))[0].state).toBe("active");

    // His device is told it has left; he cannot come back, beat, add words or switch notes.
    expect(await callHeartbeat(ben, callId)).toEqual({ state: "left" });
    await expect(joinCall(ben, callId)).rejects.toMatchObject({ status: 404 });
    await expect(acceptCall(ben, callId)).rejects.toMatchObject({ status: 404 });
    expect(await word(ben, `SELECT app_call_add_lines($1, $2::jsonb) AS r`, [callId, JSON.stringify([{ seq: 2, at: Date.now(), text: "Ben, after" }])])).toMatchObject({ word: "not_in_call", accepted: 0 });
    expect(await word(ben, `SELECT app_call_set_notes($1, false) AS r`, [callId])).toBe("not_in_call");
    // He still sees that he was on it (his history), but not how to join, nor the call among the live ones.
    const v = await getCallView(ben, callId);
    expect(v?.me).toMatchObject({ state: "left", canJoin: false, canLeave: false, canEnd: false });
    expect((await liveCalls(ben)).map((c) => c.id)).not.toContain(callId);
    expect((await callHistory(ben, { filter: "all" })).items.find((i) => i.id === callId)?.where.name).toBeNull();
    // What was said is for the people still on it: not his transcript any more (his own line included).
    expect(await appQueryAs(pid(ben), `SELECT id FROM call_transcript_lines WHERE call_id = $1`, [callId])).toEqual([]);
    expect(await appQueryAs(pid(ada), `SELECT text FROM call_transcript_lines WHERE call_id = $1`, [callId])).toEqual([{ text: "Ben, before" }]);
    // Ada and David go on, untouched.
    expect(await callHeartbeat(ada, callId)).toEqual({ state: "ok" });
    expect(await callHeartbeat(david, callId)).toEqual({ state: "ok" });
  });

  it("a device that still beats before any settle is told it has left, and is taken out of the room", async () => {
    const side = (await createChannel(ada, { title: "Side two", memberIds: [id(ben), id(david)] })).id;
    const callId = (await startCall(ada, { conversationId: side })).call.id;
    await joinCall(ben, callId);
    // Taken out of the channel behind the app's back (no settle ran): his row still says joined.
    await adminQuery(`DELETE FROM conversation_participants WHERE conversation_id = $1 AND membership_id = $2`, [side, id(ben)]);
    expect((await part(callId, ben)).state).toBe("joined");
    expect(await callHeartbeat(ben, callId)).toEqual({ state: "left" });
    expect((await part(callId, ben)).state).toBe("left");
    expect(outOf(callId)).toEqual([id(ben)]);
  });

  it("a ring to someone taken out of the channel is missed silently, and stops ringing", async () => {
    // Ben online (a session seen now), so Ada's call in #Side rings him.
    await withSystem((db) => issueSession(db, a.employee2.authUserId, { method: "password" }));
    const side = (await createChannel(ada, { title: "Side three", memberIds: [id(ben), id(david)] })).id;
    const callId = (await startCall(ada, { conversationId: side })).call.id;
    expect((await part(callId, ben)).state).toBe("ringing");
    expect((await withSystem((db) => callsNowIn(db, ben))).ringing.map((r) => r.id)).toContain(callId);
    await updateChannel(ada, side, { memberIds: [id(david)] });
    const p = await part(callId, ben);
    expect(p.state).toBe("missed");
    expect(p.notified_at).not.toBeNull();
    expect(await adminQuery(`SELECT 1 FROM notifications WHERE type = 'call.missed' AND resource_id = $1`, [callId])).toEqual([]);
    expect((await withSystem((db) => callsNowIn(db, ben))).ringing.map((r) => r.id)).not.toContain(callId);
  });

  it("a starter taken out of the channel cannot end the call for everyone", async () => {
    // Olu (the owner) runs #Ops with Ada and Ben; Ada starts a call there, Ben joins.
    const ops = (await createChannel(olu, { title: "Ops", memberIds: [id(ada), id(ben)] })).id;
    const callId = (await startCall(ada, { conversationId: ops })).call.id;
    await joinCall(ben, callId);
    // Taken out behind the app's back (no settle yet): still joined, no longer reading.
    await adminQuery(`DELETE FROM conversation_participants WHERE conversation_id = $1 AND membership_id = $2`, [ops, id(ada)]);
    expect((await getCallView(ada, callId))?.me).toMatchObject({ state: "joined", canEnd: false, canJoin: false });
    await expect(endCall(ada, callId)).rejects.toMatchObject({ status: 403 });
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [callId]))[0].state).toBe("active");
    // Leaving still works, and the call goes on for Ben until he is alone.
    await leaveCall(ada, callId);
    expect((await part(callId, ada)).state).toBe("left");
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [callId]))[0].state).toBe("active");
  });

  it("a channel deleted during its call ends it", async () => {
    const side = (await createChannel(ada, { title: "Side four", memberIds: [id(ben)] })).id;
    const callId = (await startCall(ada, { conversationId: side })).call.id;
    await joinCall(ben, callId);
    await deleteConversation(ada, side);
    expect((await adminQuery<{ state: string; end_reason: string }>(`SELECT state, end_reason FROM calls WHERE id = $1`, [callId]))[0]).toEqual({ state: "ended", end_reason: "completed" });
    expect(await callHeartbeat(ben, callId)).toEqual({ state: "ended" });
  });

  it("taken out of the team during the team call: out of it at once", async () => {
    const callId = (await startCall(david, { conversationId: design })).call.id;
    await joinCall(ada, callId);
    await joinCall(ben, callId);
    await setTeamMember(olu, a.teamId, id(ben), { isManager: false, remove: true });
    try {
      expect((await part(callId, ben)).state).toBe("left");
      expect(outOf(callId)).toEqual([id(ben)]);
      expect(await callHeartbeat(ben, callId)).toEqual({ state: "left" });
      await expect(joinCall(ben, callId)).rejects.toMatchObject({ status: 404 });
      expect(await callHeartbeat(ada, callId)).toEqual({ state: "ok" });
    } finally {
      await setTeamMember(olu, a.teamId, id(ben), { isManager: false });
    }
  });

  it("a membership that ends during a call: out of it at once (a one-to-one call ends)", async () => {
    const callId = (await startCall(ada, { to: id(ben) })).call.id;
    await joinCall(ben, callId);
    await revokeMembership(olu, id(ben));
    expect((await part(callId, ben)).state).toBe("left");
    expect((await adminQuery<{ state: string }>(`SELECT state FROM calls WHERE id = $1`, [callId]))[0].state).toBe("ended");
  });
});
