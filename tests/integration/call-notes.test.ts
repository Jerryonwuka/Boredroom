/**
 * Brenda's notes on calls, the people's side (owner decisions, 8 October 2026: phase 8, contract G.3), on the test
 * database with LiveKit faked (nothing reaches LiveKit Cloud) and no model. Company A: Olu Owner, Mary HR, David leads
 * Design (Ada, Ben).
 * - Whether notes can be offered: the plan, the AI connection, the workspace's `call_notes` switch (403 NOTES_NOT_AVAILABLE).
 * - Whoever turns them on is included; lines only from people in the call who said yes, while notes are on; a repeated
 *   seq is ignored; "Not me" deletes that person's lines; lines more than a minute after notes went off, or after the
 *   person left, are refused; the 2,000 cap; the rate limit; nothing while impersonated.
 * - Words SPOKEN outside the speaker's own window are refused whatever the device sends (fix review, 10 October 2026):
 *   before notes were switched on, before their own yes, after notes went off, after they left. The same answer again
 *   keeps the time it was first given.
 * - The transcript: readable by the people who were on the call and by nobody else (the owner, HR, the team's lead, a
 *   channel reader who never joined: 404), never while impersonated (403).
 * - The `call_notes` switch: refused before migration 0054, saved after.
 * - Switched off for the workspace (or the plan loses the AI assistant), notes stop at once (fix review, 10 October 2026):
 *   the live call's notes go off and its devices' next lines are refused, even within the minute that lets the last
 *   words of a call arrive.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A made-up LiveKit project: nothing leaves the test.
process.env.LIVEKIT_URL = "wss://test.livekit.invalid";
process.env.LIVEKIT_API_KEY = "APItestkey";
process.env.LIVEKIT_API_SECRET = "test-secret-that-is-long-enough-000000000000";
// An AI connection that is never called (the notes routes only ask whether there is one).
const realKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";

import { adminQuery, resetTestDatabase } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0054 } from "@/server/lib/schema-0054";
import { setLiveKitForTests, type LiveKitGateway } from "@/server/lib/livekit";
import { joinCall, leaveCall, startCall } from "@/server/services/calls";
import { addCallLines, callNotesAvailability, callTranscript, setCallNoteConsent, setCallNotes } from "@/server/services/call-notes";
import { abilitiesView, saveWorkspaceAbility } from "@/server/services/abilities";
import { openChannel } from "@/server/services/messaging";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";

const fake: LiveKitGateway = {
  async listRooms() { return []; }, async listParticipants() { return []; },
  async deleteRoom() { /* gone */ }, async removeParticipant() { /* gone */ },
};

let a: CompanyFixture;
let olu: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string;
const id = (c: OrgContext) => c.membership.id;
/** The workspace on a plan with the AI assistant (the fixture's plan may not have it). */
const ai = (c: OrgContext, on = true): OrgContext => ({ ...c, plan: { ...c.plan, features: { ...c.plan.features, AI_ASSISTANT: on } } });
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "00000000-0000-4000-8000-0000000000aa", adminEmail: "support@boredroom.test" } } });
const T0 = () => Date.now();
const line = (seq: number, text = `Line ${seq}`) => ({ seq, at: T0(), text });

async function refused(p: Promise<unknown>): Promise<AppError> {
  try { await p; } catch (err) { if (err instanceof AppError) return err; throw err; }
  throw new Error("expected a refusal");
}
async function lineCount(callId: string, m?: string): Promise<number> {
  const r = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM call_transcript_lines WHERE call_id = $1 AND ($2::uuid IS NULL OR membership_id = $2)`, [callId, m ?? null]);
  return r[0].n;
}
/** Ada calls Ben and he joins: a live one-to-one call. */
async function directCall(): Promise<string> {
  const s = await startCall(ai(ada), { to: id(ben) });
  await joinCall(ai(ben), s.call.id);
  return s.call.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  forget0054();
  setLiveKitForTests(fake);
  a = await buildCompany("a", { names: { owner: "Olu Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Obi", employee2: "Ben Okafor" } });
  olu = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = await openChannel(david, a.teamId);
});
afterAll(() => {
  setLiveKitForTests(null);
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
});
beforeEach(async () => {
  await adminQuery(`SELECT app_call_close(id, 'completed', NULL, now()) FROM calls WHERE state <> 'ended'`);
  await adminQuery(`DELETE FROM auth_rate_limits`);
  await adminQuery(`UPDATE brenda_settings SET abilities_off = '{}' WHERE organisation_id = $1`, [olu.org.id]);
  process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
});

describe("whether notes can be offered", () => {
  it("needs the AI assistant on the plan, an AI connection and the workspace's switch", async () => {
    expect(await callNotesAvailability(ai(ada))).toEqual({ available: true, reason: null });
    expect(await callNotesAvailability(ai(ada, false))).toEqual({ available: false, reason: "plan" });
    const callId = await directCall();
    const e1 = await refused(setCallNotes(ai(ada, false), callId, true));
    expect(e1).toMatchObject({ status: 403, code: "NOTES_NOT_AVAILABLE", message: "Notes on calls need the AI assistant on your plan." });

    delete process.env.ANTHROPIC_API_KEY;
    expect(await callNotesAvailability(ai(ada))).toEqual({ available: false, reason: "no_ai" });
    expect(await refused(setCallNotes(ai(ada), callId, true))).toMatchObject({ status: 403, code: "NOTES_NOT_AVAILABLE" });
    process.env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";

    await saveWorkspaceAbility(olu, { key: "call_notes", offered: false });
    expect(await callNotesAvailability(ai(ada))).toEqual({ available: false, reason: "off" });
    expect(await refused(setCallNotes(ai(ada), callId, true))).toMatchObject({ status: 403, message: "Notes on calls are switched off for this workspace." });
    await saveWorkspaceAbility(olu, { key: "call_notes", offered: true });
    const on = await setCallNotes(ai(ada), callId, true);
    expect(on.call.notes.state).toBe("on");
  });
});

describe("notes on a call", () => {
  it("includes whoever turns them on; takes lines only from people who said yes; Not me deletes theirs", async () => {
    const callId = await directCall();
    const on = await setCallNotes(ai(ada), callId, true);
    expect(on.call.notes).toMatchObject({ state: "on", myConsent: "yes", onBy: { membershipId: id(ada) } });
    expect(on.call.notes.included.map((p) => p.membershipId)).toEqual([id(ada)]);
    const audits = await adminQuery<{ action: string; metadata: Record<string, unknown> }>(`SELECT action, metadata FROM audit_events WHERE subject_id = $1`, [callId]);
    expect(audits).toEqual([{ action: "call.notes_on", metadata: {} }]);

    expect(await addCallLines(ai(ada), callId, [line(10), line(11)])).toEqual({ accepted: 2, refused: 0 });
    // A repeated seq is ignored.
    expect(await addCallLines(ai(ada), callId, [line(11, "again"), line(12)])).toEqual({ accepted: 1, refused: 1 });
    // Ben has not answered: no.
    expect(await refused(addCallLines(ai(ben), callId, [line(5)]))).toMatchObject({ status: 403, code: "NO_CONSENT" });
    // Olu was never in it.
    expect(await refused(addCallLines(ai(olu), callId, [line(5)]))).toMatchObject({ status: 404 });
    // Ben's view never shows anyone's "no"; he sees Ada included.
    const benYes = await setCallNoteConsent(ai(ben), callId, "yes");
    expect(benYes.call.notes.myConsent).toBe("yes");
    expect(await addCallLines(ai(ben), callId, [line(20), line(21), line(22)])).toEqual({ accepted: 3, refused: 0 });
    expect(await lineCount(callId, id(ben))).toBe(3);
    // Not me: Ben's lines go at once, and his next ones are refused; Ada's stay. Ada never sees his "no".
    const benNo = await setCallNoteConsent(ai(ben), callId, "no");
    expect(benNo.call.notes.myConsent).toBe("no");
    expect(await lineCount(callId, id(ben))).toBe(0);
    expect(await lineCount(callId, id(ada))).toBe(3);
    expect(await refused(addCallLines(ai(ben), callId, [line(23)]))).toMatchObject({ code: "NO_CONSENT" });
    const { getCallView } = await import("@/server/services/calls");
    const adaView = (await getCallView(ai(ada), callId))!;
    expect(adaView.notes.included.map((p) => p.membershipId)).toEqual([id(ada)]);
    expect(adaView.participants.find((p) => p.membershipId === id(ben))?.consent ?? null).toBeNull();
    // Bad lines and a bad choice.
    expect(await refused(addCallLines(ai(ada), callId, []))).toMatchObject({ status: 422 });
    expect(await refused(addCallLines(ai(ada), callId, [{ seq: 1, at: T0(), text: "   " }]))).toMatchObject({ status: 422 });
    expect(await refused(setCallNoteConsent(ai(ada), callId, "maybe" as never))).toMatchObject({ status: 422 });
  });

  it("refuses lines more than a minute after notes went off, or after the person left", async () => {
    const callId = await directCall();
    await setCallNotes(ai(ada), callId, true);
    await setCallNoteConsent(ai(ben), callId, "yes");
    const off = await setCallNotes(ai(ben), callId, false);
    expect(off.call.notes.state).toBe("off");
    // The last words still arrive within a minute.
    expect(await addCallLines(ai(ada), callId, [line(1)])).toEqual({ accepted: 1, refused: 0 });
    await adminQuery(`UPDATE calls SET notes_off_at = now() - interval '61 seconds' WHERE id = $1`, [callId]);
    expect(await refused(addCallLines(ai(ada), callId, [line(2)]))).toMatchObject({ status: 409, code: "NOTES_OFF" });
    // On again; Ben leaves (the direct call ends): within a minute his last words arrive, then nothing.
    await setCallNotes(ai(ada), callId, true);
    await leaveCall(ai(ben), callId);
    expect(await addCallLines(ai(ben), callId, [line(3)])).toEqual({ accepted: 1, refused: 0 });
    await adminQuery(`UPDATE call_participants SET left_at = now() - interval '61 seconds' WHERE call_id = $1 AND membership_id = $2`, [callId, id(ben)]);
    expect(await refused(addCallLines(ai(ben), callId, [line(4)]))).toMatchObject({ status: 409, code: "NOT_IN_CALL" });
    // Ended: notes cannot be switched or answered any more.
    expect(await refused(setCallNotes(ai(ada), callId, true))).toMatchObject({ status: 409, code: "CALL_ENDED" });
    expect(await refused(setCallNoteConsent(ai(ada), callId, "no"))).toMatchObject({ status: 409, code: "CALL_ENDED" });
  });

  it("keeps only words spoken after notes went on and the speaker's own yes, and before notes went off", async () => {
    const callId = await directCall();
    const ms = (v: unknown) => Date.parse(String(v));
    const times = async () => { const r = (await adminQuery<{ on: string; off: string | null }>(`SELECT notes_on_at AS "on", notes_off_at AS "off" FROM calls WHERE id = $1`, [callId]))[0]; return { on: ms(r.on), off: ms(r.off) }; };
    const saidAt = async (c: OrgContext) => ms((await adminQuery<{ at: string }>(`SELECT decided_at AS at FROM call_note_consents WHERE call_id = $1 AND membership_id = $2`, [callId, id(c)]))[0].at);
    const spoken = (seq: number, at: number) => ({ seq, at, text: `Line ${seq}` });

    await setCallNotes(ai(ada), callId, true);
    const onAt = (await times()).on;
    // Ada's words from before she switched notes on (the call had begun): refused; from then on, kept.
    expect(await addCallLines(ai(ada), callId, [spoken(1, onAt - 3_000)])).toEqual({ accepted: 0, refused: 1 });
    expect(await addCallLines(ai(ada), callId, [spoken(2, onAt)])).toEqual({ accepted: 1, refused: 0 });
    // Pressing "Brenda takes notes" again keeps the time she said yes.
    await setCallNotes(ai(ada), callId, true);
    expect(await saidAt(ada)).toBe(onAt);

    // Ben's words from while he had not answered, even with notes on: refused; from his yes on, kept.
    await setCallNoteConsent(ai(ben), callId, "yes");
    const benAt = await saidAt(ben);
    expect(await addCallLines(ai(ben), callId, [spoken(1, benAt - 3_000)])).toEqual({ accepted: 0, refused: 1 });
    expect(await addCallLines(ai(ben), callId, [spoken(2, benAt)])).toEqual({ accepted: 1, refused: 0 });
    // The same answer again keeps the time it was first given.
    await setCallNoteConsent(ai(ben), callId, "yes");
    expect(await saidAt(ben)).toBe(benAt);
    // Not me, then yes again: his lines went, and his window starts at the new yes.
    await setCallNoteConsent(ai(ben), callId, "no");
    await setCallNoteConsent(ai(ben), callId, "yes");
    const benAgain = await saidAt(ben);
    expect(benAgain).toBeGreaterThan(benAt);
    expect(await lineCount(callId, id(ben))).toBe(0);
    expect(await addCallLines(ai(ben), callId, [spoken(3, benAgain - 1_500)])).toEqual({ accepted: 0, refused: 1 });

    // Off the record: Ada switches notes off. Ben's words from just before the switch still arrive; his words after it
    // are refused, although they arrive well within the minute.
    await setCallNotes(ai(ada), callId, false);
    const offAt = (await times()).off;
    expect(await addCallLines(ai(ben), callId, [spoken(4, offAt - 500)])).toEqual({ accepted: 1, refused: 0 });
    expect(await addCallLines(ai(ben), callId, [spoken(5, offAt + 3_000)])).toEqual({ accepted: 0, refused: 1 });
    expect(await addCallLines(ai(ada), callId, [spoken(6, offAt + 3_000)])).toEqual({ accepted: 0, refused: 1 });

    // What is kept is exactly the words inside each speaker's window.
    const kept = await adminQuery<{ membership_id: string; seq: number }>(`SELECT membership_id, seq FROM call_transcript_lines WHERE call_id = $1 ORDER BY seq`, [callId]);
    expect(kept.map((l) => [l.membership_id === id(ada) ? "Ada" : "Ben", l.seq])).toEqual([["Ada", 2], ["Ben", 4]]);
  });

  it("refuses words spoken after the speaker left a call that goes on", async () => {
    // A team call in #Design: David starts it and turns notes on, Ada and Ben join and say yes, then Ben leaves.
    const s = await startCall(ai(david), { conversationId: design });
    const callId = s.call.id;
    await joinCall(ai(ada), callId);
    await joinCall(ai(ben), callId);
    await setCallNotes(ai(david), callId, true);
    await setCallNoteConsent(ai(ben), callId, "yes");
    await leaveCall(ai(ben), callId);
    const leftAt = Date.parse(String((await adminQuery<{ at: string }>(`SELECT left_at AS at FROM call_participants WHERE call_id = $1 AND membership_id = $2`, [callId, id(ben)]))[0].at));
    expect((await adminQuery<{ state: string; notes_state: string }>(`SELECT state, notes_state FROM calls WHERE id = $1`, [callId]))[0]).toEqual({ state: "active", notes_state: "on" });
    expect(await addCallLines(ai(ben), callId, [{ seq: 1, at: leftAt - 500, text: "Before I go" }])).toEqual({ accepted: 1, refused: 0 });
    expect(await addCallLines(ai(ben), callId, [{ seq: 2, at: leftAt + 3_000, text: "After I left" }])).toEqual({ accepted: 0, refused: 1 });
    expect(await lineCount(callId, id(ben))).toBe(1);
  });

  it("holds the 2,000-line cap and the rate limit", async () => {
    const callId = await directCall();
    await setCallNotes(ai(ada), callId, true);
    await adminQuery(
      `INSERT INTO call_transcript_lines(call_id, organisation_id, membership_id, seq, spoken_at, text)
       SELECT $1, $2, $3, g, now(), 'filler' FROM generate_series(1, 1995) g`, [callId, olu.org.id, id(ada)]);
    expect(await refused(addCallLines(ai(ada), callId, Array.from({ length: 10 }, (_, i) => line(5000 + i))))).toMatchObject({ status: 409, code: "TOO_MANY_LINES" });
    expect(await addCallLines(ai(ada), callId, [line(6000)])).toEqual({ accepted: 1, refused: 0 });
    await adminQuery(
      `INSERT INTO auth_rate_limits(bucket, window_start, hits) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / 600) * 600), 240)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = 240`, [`call.lines:${id(ada)}`]);
    expect(await refused(addCallLines(ai(ada), callId, [line(6001)]))).toMatchObject({ status: 429 });
  });

  it("does nothing while someone else is signed in as the person", async () => {
    const callId = await directCall();
    expect(await refused(setCallNotes(impersonated(ai(ada)), callId, true))).toMatchObject({ status: 403, message: "Only Ada can choose this." });
    await setCallNotes(ai(ada), callId, true);
    expect(await refused(setCallNoteConsent(impersonated(ai(ben)), callId, "yes"))).toMatchObject({ status: 403 });
    expect(await refused(addCallLines(impersonated(ai(ada)), callId, [line(1)]))).toMatchObject({ status: 403 });
    expect(await refused(callTranscript(impersonated(ai(ada)), callId))).toMatchObject({ status: 403, message: "Transcripts can't be read while you're signed in as someone else." });
  });
});

describe("notes switched off for the workspace (fix review, 10 October 2026)", () => {
  const notesState = async (callId: string) => (await adminQuery<{ notes_state: string; off: string | null }>(
    `SELECT notes_state, notes_off_at AS off FROM calls WHERE id = $1`, [callId]))[0];

  it("an owner switching notes off stops them on the call at once, and its lines are refused", async () => {
    const callId = await directCall();
    await setCallNotes(ai(ada), callId, true);
    await setCallNoteConsent(ai(ben), callId, "yes");
    expect(await addCallLines(ai(ben), callId, [line(1)])).toEqual({ accepted: 1, refused: 0 });
    await saveWorkspaceAbility(olu, { key: "call_notes", offered: false });
    // Off on the live call now (its devices hear it as a realtime event and stop)...
    expect(await notesState(callId)).toMatchObject({ notes_state: "off", off: expect.anything() });
    // ...and whatever a device still sends is refused, though it arrives within the minute the last words may take.
    expect(await refused(addCallLines(ai(ben), callId, [line(2)]))).toMatchObject({ status: 409, code: "NOTES_OFF" });
    expect(await refused(addCallLines(ai(ada), callId, [line(3)]))).toMatchObject({ status: 409, code: "NOTES_OFF" });
    expect(await lineCount(callId)).toBe(1);
    // Nobody can switch them on again until the workspace does.
    expect(await refused(setCallNotes(ai(ada), callId, true))).toMatchObject({ status: 403, code: "NOTES_NOT_AVAILABLE" });
    await saveWorkspaceAbility(olu, { key: "call_notes", offered: true });
    expect((await setCallNotes(ai(ada), callId, true)).call.notes.state).toBe("on");
  });

  it("a plan without the AI assistant stops them on the call too", async () => {
    const callId = await directCall();
    await setCallNotes(ai(ada), callId, true);
    expect(await addCallLines(ai(ada), callId, [line(1)])).toEqual({ accepted: 1, refused: 0 });
    expect(await refused(addCallLines(ai(ada, false), callId, [line(2)]))).toMatchObject({ status: 409, code: "NOTES_OFF" });
    expect((await notesState(callId)).notes_state).toBe("off");
    expect(await lineCount(callId)).toBe(1);
  });
});

describe("the transcript", () => {
  it("is readable by the people who were on the call and by nobody else", async () => {
    // A team call in #Design: David starts, Ada joins; Ben reads the channel but never joins.
    const s = await startCall(ai(david), { conversationId: design });
    const callId = s.call.id;
    await joinCall(ai(ada), callId);
    await setCallNotes(ai(david), callId, true);
    await setCallNoteConsent(ai(ada), callId, "yes");
    await addCallLines(ai(david), callId, [line(1, "Let's ship on Friday.")]);
    await addCallLines(ai(ada), callId, [line(2, "I'll send the deck.")]);
    for (const who of [david, ada]) {
      const t = await callTranscript(ai(who), callId);
      expect(t.lines.map((l) => [l.speaker.name, l.text])).toEqual([["David Lead", "Let's ship on Friday."], ["Ada Obi", "I'll send the deck."]]);
      expect(t.deleted).toBe(false);
    }
    // The owner, HR and a channel reader who never joined: as if it did not exist.
    for (const who of [olu, mary, ben]) expect(await refused(callTranscript(ai(who), callId))).toMatchObject({ status: 404 });
    // Ben's own direct rows show nothing either (row-level security, as the app role).
    const { appQueryAs } = await import("../helpers/db");
    expect(await appQueryAs(a.employee2.profileId, `SELECT * FROM call_transcript_lines WHERE call_id = $1`, [callId])).toHaveLength(0);
    expect(await appQueryAs(a.owner.profileId, `SELECT * FROM call_transcript_lines WHERE call_id = $1`, [callId])).toHaveLength(0);
    expect(await appQueryAs(a.employee.profileId, `SELECT * FROM call_transcript_lines WHERE call_id = $1`, [callId])).toHaveLength(2);
    // After the call: still theirs, with the date it goes.
    await leaveCall(ai(ada), callId);
    await leaveCall(ai(david), callId);
    const after = await callTranscript(ai(ada), callId);
    expect(after.lines).toHaveLength(2);
    expect(Date.parse(after.deleteAfter!)).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });
});

describe("the call_notes switch", () => {
  it("is refused before migration 0054 and saved after", async () => {
    await adminQuery(`ALTER TABLE calls RENAME TO calls_hidden_for_test`);
    forget0054();
    try {
      expect(await refused(saveWorkspaceAbility(olu, { key: "call_notes", offered: false }))).toMatchObject({ status: 503, code: "NOT_READY" });
      const view = await abilitiesView(olu);
      expect(view.cards.find((c) => c.key === "call_notes")).toMatchObject({ workspaceState: "Needs a database update", personal: { kind: "none", label: "Each call asks you" } });
      expect(await callNotesAvailability(ai(ada))).toEqual({ available: false, reason: "not_ready" });
    } finally {
      await adminQuery(`ALTER TABLE calls_hidden_for_test RENAME TO calls`);
      forget0054();
    }
    const saved = await saveWorkspaceAbility(olu, { key: "call_notes", offered: false });
    expect(saved.cards.find((c) => c.key === "call_notes")).toMatchObject({ workspace: { kind: "switch", offered: false }, workspaceState: "Off for this workspace", effective: false });
    const back = await saveWorkspaceAbility(olu, { key: "call_notes", offered: true });
    expect(back.cards.find((c) => c.key === "call_notes")).toMatchObject({ workspace: { kind: "switch", offered: true }, workspaceState: "On", effective: true });
    // Never a personal switch.
    const { savePersonalAbility } = await import("@/server/services/abilities");
    expect(await refused(savePersonalAbility(ada, { key: "call_notes", on: false }))).toMatchObject({ status: 400 });
  });
});
