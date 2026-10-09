/**
 * Workspace commitments (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). When
 * the owner or HR turns tracking on, the workspace's assistant notes commitments in tracked group conversations (never
 * direct messages): a promise or an agreed ask is labelled "Noted" and handed to its committer to accept onto their own
 * list; an open ask waits 60 minutes and then goes to the asked person (unless they muted the asker's assistant); the
 * to-do's completion closes it; anything unanswered expires after 7 days; a withdrawn message cancels it; an interrupted
 * accept never makes a second to-do.
 *
 * Company A (company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Ada Nwosu and Ben Okafor), Olu
 * Adeyemi (her assistant is Max) and Sam Sales (leads Sales: Olu). Local test database only (TEST_DATABASE_URL on
 * localhost). No model: the detection is handed in as `DetectedCommitment` rows, as the worker's scan hands them.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam, setTeamMember } from "@/server/services/orgs";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { setMute } from "@/server/services/assistant-items";
import { createChannel, openChannel, openDirect, sendMessage, thread, withdrawMessage } from "@/server/services/messaging";
import { withUser } from "@/server/db";
import * as C from "@/server/services/commitments";
import { LOOP_LIMITS, LOOP_WORDS, type DetectedCommitment } from "@/lib/commitments";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext, olu: OrgContext, sam: OrgContext;
let design: string;   // the Design team channel (David, Ada, Ben)
let launch: string;   // a named channel Ada made with Ben and Olu
let direct: string;   // Ada and Ben's direct thread

const id = (c: OrgContext) => c.membership.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const say = async (c: OrgContext, conversationId: string, body: string, replyToId?: string) => (await sendMessage(c, { conversationId, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const det = (p: Pick<DetectedCommitment, "conversationId" | "sourceMessageId" | "kind" | "committerMembershipId"> & Partial<DetectedCommitment>): DetectedCommitment => ({
  agreementMessageId: null, askerMembershipId: null, title: "Send the deck", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(), ...p,
});
const notifications = (membershipId: string, type: string) => adminQuery<{ title: string; body: string | null; href: string | null; resource_id: string | null; deduplication_key: string }>(
  "SELECT title, body, href, resource_id, deduplication_key FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at", [membershipId, type]);
const labelOf = async (messageId: string) => (await adminQuery<{ state: string }>("SELECT state FROM message_labels WHERE message_id = $1", [messageId]))[0]?.state ?? null;
const statusOf = async (cid: string) => (await adminQuery<{ status: string }>("SELECT status FROM commitments WHERE id = $1", [cid]))[0]?.status;
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
/** A promise by Ben in #Design, noted. */
async function benPromises(body = "I'll send the deck Thursday", title = "Send the deck"): Promise<{ cid: string; msg: string }> {
  const msg = await say(ben, design, body);
  const r = await C.insertDetectedCommitments(a.ownerCtx.org.id, [det({ conversationId: design, sourceMessageId: msg, kind: "promise", committerMembershipId: id(ben), title })]);
  expect(r.created).toHaveLength(1);
  return { cid: r.created[0], msg };
}

/** A promise by Ada in #Design, noted (Ben's day fills up during this file). */
async function adaPromises(body: string, title: string): Promise<{ cid: string; msg: string }> {
  const msg = await say(ada, design, body);
  const r = await C.insertDetectedCommitments(a.ownerCtx.org.id, [det({ conversationId: design, sourceMessageId: msg, kind: "promise", committerMembershipId: id(ada), title })]);
  expect(r.created).toHaveLength(1);
  return { cid: r.created[0], msg };
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  const sales = (await createTeam(owner, "Sales")).id;
  olu = await joinViaInvitation(mary, await createVerifiedUser("olu@company-a.test", "Olu Adeyemi"), "employee", sales, "EMP-010");
  sam = await joinViaInvitation(owner, await createVerifiedUser("sam@company-a.test", "Sam Sales"), "manager", sales, "MGR-002");
  await setTeamMember(owner, sales, id(sam), { isManager: true });
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  design = await openChannel(david, a.teamId);
  launch = (await createChannel(ada, { title: "Launch", memberIds: [id(ben), id(olu)] })).id;
  direct = await openDirect(ada, id(ben));
});

// ---- 1. The switches ---------------------------------------------------------------------------------------------------------

describe("the switches", () => {
  it("tracking is off until the owner or HR turns it on, and records since when", async () => {
    expect(await withUser(ada.user.profileId, (db) => C.commitmentSettings(db, ada.org.id))).toEqual({ ready: true, track: false, threadFollowUps: false, since: null });
    await expect(C.saveCommitmentSettings(david, { track: true })).rejects.toMatchObject({ status: 403, message: LOOP_WORDS.settings.forbidden });
    await expect(C.saveCommitmentSettings(ada, { track: true })).rejects.toMatchObject({ status: 403 });
    const on = await C.saveCommitmentSettings(owner, { track: true });
    expect(on).toMatchObject({ ready: true, track: true, threadFollowUps: false });
    expect(on.since).not.toBeNull();
    // Off and on again: "since" moves on (nothing said while it was off is ever read for it).
    await C.saveCommitmentSettings(mary, { track: false });
    await new Promise((r) => setTimeout(r, 20));
    const again = await C.saveCommitmentSettings(mary, { track: true, threadFollowUps: true });
    expect(again.threadFollowUps).toBe(true);
    expect(Date.parse(again.since!)).toBeGreaterThan(Date.parse(on.since!));
    // On while on: "since" stays.
    expect((await C.saveCommitmentSettings(owner, { track: true })).since).toBe(again.since);
    await C.saveCommitmentSettings(owner, { threadFollowUps: false });
    expect(await adminQuery("SELECT action, metadata FROM audit_events WHERE action = 'settings.commitments' ORDER BY occurred_at LIMIT 1")).toEqual([{ action: "settings.commitments", metadata: { track: true, threadFollowUps: false } }]);
  });

  it("the conversation's switch: whoever runs it (the team lead on a team channel), never staff, never a direct thread", async () => {
    const t = await withUser(ben.user.profileId, (db) => C.conversationTrackingIn(db, ben, design));
    expect(t).toEqual({ ready: true, workspaceOn: true, here: true, tracked: true, canChange: false, applies: true, workspaceAssistantName: "Brenda" });
    await expect(C.setConversationTracking(ben, design, false)).rejects.toMatchObject({ status: 403, message: LOOP_WORDS.conversationSwitch.forbidden });
    expect(await C.setConversationTracking(david, design, false)).toEqual({ trackCommitments: false });
    expect(await withUser(david.user.profileId, (db) => C.conversationTrackingIn(db, david, design))).toMatchObject({ here: false, tracked: false, canChange: true });
    expect(await C.setConversationTracking(david, design, true)).toEqual({ trackCommitments: true });
    await expect(C.setConversationTracking(ada, direct, true)).rejects.toMatchObject({ status: 422, message: LOOP_WORDS.errors.direct });
    expect(await withUser(ada.user.profileId, (db) => C.conversationTrackingIn(db, ada, direct))).toMatchObject({ ready: true, applies: false, tracked: false });
    // Olu does not read #Design: 404.
    await expect(C.setConversationTracking(olu, design, false)).rejects.toMatchObject({ status: 404 });
    expect(await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action = 'conversation.track_commitments'")).toEqual([{ n: 2 }]);
  });
});

// ---- 2. A promise, from noted to done -----------------------------------------------------------------------------------------

describe("a promise in a tracked channel", () => {
  let cid: string, msg: string;

  it("is noted: a label everyone in the conversation sees, and the committer told", async () => {
    ({ cid, msg } = await benPromises());
    expect(await labelOf(msg)).toBe("noted");
    // The label in the thread, for every reader; nobody else reads it.
    const th = await thread(ada, design);
    expect(th!.messages.find((m) => m.id === msg)!.commitment_label).toEqual({ state: "noted", text: "Noted", private: false });
    expect(th!.commitments).toMatchObject({ ready: true, applies: true, tracked: true });
    for (const reader of [a.manager, a.employee, a.employee2]) {
      expect(await appQueryAs(reader.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [msg])).toEqual([{ state: "noted" }]);
    }
    for (const outsider of [a.owner, a.hr]) {
      expect(await appQueryAs(outsider.profileId, "SELECT state FROM message_labels WHERE message_id = $1", [msg])).toEqual([]);
    }
    const n = await notifications(id(ben), "brenda.commitment");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: "Brenda noted you said you'd “Send the deck”", body: LOOP_WORDS.notifications.commitmentBody, resource_id: cid, href: `/app/company-a/home/assistants?f=${cid}`, deduplication_key: `commitment:${cid}` });
    const waiting = await C.waitingCommitments(ben);
    expect(waiting.map((w) => [w.kind, w.kind === "blocked_on" ? null : w.commitment.id])).toEqual([["commitment", cid]]);
    const v = waiting[0].kind === "commitment" ? waiting[0].commitment : null;
    expect(v).toMatchObject({
      kind: "promise", status: "proposed", display: "waiting", viewer: "committer", title: "Send the deck", badge: { label: "Needs your answer", tone: "warning" },
      canAccept: true, canDecline: true, canDismiss: true, canMarkDone: false, acceptMakesTodo: true,
      where: { conversationId: design, kind: "team", name: "#Design" },
      message: { id: msg, quote: "I'll send the deck Thursday", withdrawn: false, href: `/app/company-a/messages?c=${design}#m-${msg}` },
      committer: { membershipId: id(ben), name: "Ben Okafor", firstName: "Ben" }, asker: null, todo: null,
    });
    // David leads Ben, but a proposal never reaches a supervisor.
    expect(await C.getCommitment(david, cid)).toBeNull();
    expect((await C.listCommitments(david, { scope: "team" })).items).toEqual([]);
  });

  it("nothing in a direct thread, an untracked conversation, or with the workspace switch off", async () => {
    const dm = await say(ben, direct, "I'll send you the invoice tomorrow");
    expect(await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: direct, sourceMessageId: dm, kind: "promise", committerMembershipId: id(ben) })])).toEqual({ created: [], skipped: 1 });
    await C.setConversationTracking(ada, launch, false);
    const l = await say(ben, launch, "I'll draft the launch post");
    expect(await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: launch, sourceMessageId: l, kind: "promise", committerMembershipId: id(ben) })])).toEqual({ created: [], skipped: 1 });
    await C.setConversationTracking(ada, launch, true);
    await C.saveCommitmentSettings(owner, { track: false });
    const d = await say(ben, design, "I'll fix the footer");
    expect(await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: d, kind: "promise", committerMembershipId: id(ben) })])).toEqual({ created: [], skipped: 1 });
    await C.saveCommitmentSettings(owner, { track: true });
    // A message never commits someone else: Ada's words cannot make Ben's promise.
    const hers = await say(ada, design, "Ben will do the slides");
    expect((await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: hers, kind: "promise", committerMembershipId: id(ben) })])).created).toEqual([]);
    // Olu does not read #Design: he can owe nothing there.
    const ask = await say(ada, design, "Olu, can you check the copy?");
    expect((await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: ask, kind: "open_ask", committerMembershipId: id(olu), askerMembershipId: id(ada) })])).created).toEqual([]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM commitments WHERE source_message_id = ANY($1::uuid[])", [[dm, l, d, hers, ask]])).toEqual([{ n: 0 }]);
  });

  it("accept: a to-do owned by the committer, linked to the message and the commitment", async () => {
    await expect(C.acceptCommitment(impersonated(ben), cid, {})).rejects.toMatchObject({ status: 403, message: LOOP_WORDS.errors.impersonated("Ben") });
    await expect(C.acceptCommitment(ada, cid, {})).rejects.toMatchObject({ status: 404 });
    const r = await C.acceptCommitment(ben, cid, { dueAt: "2026-10-15T17:00:00+01:00" });
    expect(r.note).toBeNull();
    expect(r.commitment).toMatchObject({ status: "open", display: "open", canMarkDone: true, canAccept: false, dueAt: "2026-10-15T16:00:00.000Z", dueLabel: "Thu 15 Oct, 17:00" });
    const taskId = r.commitment.todo!.id;
    const [t] = await adminQuery<{ assignee_membership_id: string; created_by: string; title: string; expected_output: string; due_at: string }>(
      "SELECT assignee_membership_id, created_by, title, expected_output, due_at FROM tasks WHERE id = $1", [taskId]);
    expect(t).toMatchObject({ assignee_membership_id: id(ben), created_by: id(ben), title: "Send the deck", due_at: "2026-10-15T16:00:00.000Z" });
    expect(t.expected_output).toContain(`Noted in #Design: http://localhost:3000/app/company-a/messages?c=${design}#m-${msg}`);
    expect(await adminQuery("SELECT todo_task_id, lease_until FROM commitments WHERE id = $1", [cid])).toEqual([{ todo_task_id: taskId, lease_until: null }]);
    expect(await labelOf(msg)).toBe("noted");
    // Accepted: now David sees it on his team's list, without the words of anything unanswered.
    const team = await C.listCommitments(david, { scope: "team" });
    expect(team.items.map((i) => [i.id, i.viewer, i.declineReason])).toEqual([[cid, "supervisor", null]]);
    expect(team.people).toEqual([{ membershipId: id(ben), name: "Ben Okafor" }]);
    // A second accept: already answered.
    await expect(C.acceptCommitment(ben, cid, {})).rejects.toMatchObject({ status: 409, code: "ITEM_CLOSED" });
    expect(await adminQuery("SELECT summary FROM brenda_actions WHERE membership_id = $1 AND tool = 'commitment'", [id(ben)])).toEqual([{ summary: "Accepted a commitment onto your list" }]);
  });

  it("the to-do completed → done (on the next read, and by the sweep), the label says Done", async () => {
    const taskId = (await adminQuery<{ todo_task_id: string }>("SELECT todo_task_id FROM commitments WHERE id = $1", [cid]))[0].todo_task_id;
    await adminQuery("UPDATE tasks SET status = 'completed', completed_at = now() WHERE id = $1", [taskId]);
    expect(await C.commitmentsDue()).toBe(true);
    const v = await C.getCommitment(ben, cid);
    expect(v).toMatchObject({ status: "done", display: "done", badge: { label: "Done", tone: "success" } });
    expect(await adminQuery("SELECT done_by FROM commitments WHERE id = $1", [cid])).toEqual([{ done_by: "todo" }]);
    expect(await labelOf(msg)).toBe("done");
    const th = await thread(ben, design);
    expect(th!.messages.find((m) => m.id === msg)!.commitment_label).toEqual({ state: "done", text: "Done", private: false });
  });

  it("mark done by hand, with or without a to-do", async () => {
    const p = await benPromises("I'll book the room", "Book the room");
    await C.acceptCommitment(ben, p.cid, {});
    await expect(C.markCommitmentDone(ada, p.cid)).rejects.toMatchObject({ status: 404 });
    expect(await C.markCommitmentDone(ben, p.cid)).toMatchObject({ status: "done" });
    expect(await adminQuery("SELECT done_by FROM commitments WHERE id = $1", [p.cid])).toEqual([{ done_by: "person" }]);
    expect(await labelOf(p.msg)).toBe("done");
    // Done already: as it is.
    expect(await C.markCommitmentDone(ben, p.cid)).toMatchObject({ status: "done" });
  });
});

// ---- 3. Asks ---------------------------------------------------------------------------------------------------------------------

describe("asks", () => {
  it("an agreed ask, declined: the asker is told privately, with the reason; the label says Declined", async () => {
    const ask = await say(ada, design, "Ben, can you fix the login bug by Friday?");
    const ok = await say(ben, design, "On it", ask);
    const r = await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: ask, agreementMessageId: ok, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Fix the login bug" })]);
    const cid = r.created[0];
    expect(await labelOf(ok)).toBe("noted");
    expect(await labelOf(ask)).toBeNull();
    expect((await notifications(id(ben), "brenda.commitment")).find((n) => n.resource_id === cid)?.title).toBe("Brenda noted you agreed to “Fix the login bug” for Ada");
    // The asker reads it while it waits; the committer's view of it.
    expect(await C.getCommitment(ada, cid)).toMatchObject({ viewer: "asker", badge: { label: "Waiting", tone: "neutral" }, canAccept: false, agreement: { id: ok, quote: "On it" } });
    await expect(C.declineCommitment(ben, cid, "x".repeat(281))).rejects.toMatchObject({ status: 422 });
    const v = await C.declineCommitment(ben, cid, "No time this week");
    expect(v).toMatchObject({ status: "declined", declineReason: "No time this week", badge: { label: "Declined", tone: "neutral" } });
    expect(await notifications(id(ada), "brenda.commitment_declined")).toEqual([expect.objectContaining({ title: "Ben can't take on “Fix the login bug”", body: "“No time this week”" })]);
    expect(await labelOf(ok)).toBe("declined");
    // Declined never reaches a supervisor.
    expect(await C.getCommitment(david, cid)).toBeNull();
    expect((await C.getCommitment(ada, cid))!.declineReason).toBe("No time this week");
  });

  it("not a commitment: the label says so and the asker is NOT told", async () => {
    const ask = await say(ada, design, "Ben, could you share the brand fonts?");
    const ok = await say(ben, design, "Sure", ask);
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: ask, agreementMessageId: ok, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Share the brand fonts" })])).created[0];
    const before = (await notifications(id(ada), "brenda.commitment_declined")).length;
    expect(await C.dismissCommitment(ben, cid)).toMatchObject({ status: "dismissed", badge: { label: "Not a commitment", tone: "neutral" } });
    expect(await labelOf(ok)).toBe("dismissed");
    expect(await notifications(id(ada), "brenda.commitment_declined")).toHaveLength(before);
    expect((await thread(ada, design))!.messages.find((m) => m.id === ok)!.commitment_label).toEqual({ state: "dismissed", text: "Not a commitment", private: true, other: "Ben" });
  });

  it("an open ask waits 60 minutes, then reaches the asked person; accepted, it is labelled and the asker told", async () => {
    const ask = await say(ada, launch, "Ben, can you write the release notes?");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: launch, sourceMessageId: ask, kind: "open_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Write the release notes" })])).created[0];
    expect(await statusOf(cid)).toBe("asked");
    expect(await labelOf(ask)).toBeNull();
    // Inside the hour: nobody told, and Ben does not see it yet; Ada does.
    expect(await C.sweepCommitments()).toMatchObject({ asksDelivered: 0 });
    expect(await notifications(id(ben), "brenda.open_ask")).toEqual([]);
    expect(await C.getCommitment(ben, cid)).toBeNull();
    expect((await C.waitingCommitments(ben)).some((w) => w.kind !== "blocked_on" && w.commitment.id === cid)).toBe(false);
    expect(await C.getCommitment(ada, cid)).toMatchObject({ viewer: "asker", status: "asked" });
    // After it: told once.
    expect((await C.sweepCommitments({ now: later(61) })).asksDelivered).toBe(1);
    expect((await C.sweepCommitments({ now: later(62) })).asksDelivered).toBe(0);
    expect(await notifications(id(ben), "brenda.open_ask")).toEqual([expect.objectContaining({ title: "Ada asked you to “Write the release notes”", body: "Take it on? Ada is told what you decide.", deduplication_key: `commitment.ask:${cid}` })]);
    const w = (await C.waitingCommitments(ben)).find((x) => x.kind === "open_ask");
    expect(w && w.kind === "open_ask" ? w.commitment.id : null).toBe(cid);
    const r = await C.acceptCommitment(ben, cid, {});
    expect(r.commitment).toMatchObject({ status: "open", kind: "open_ask" });
    expect(await labelOf(ask)).toBe("noted");
    expect(await notifications(id(ada), "brenda.commitment_accepted")).toEqual([expect.objectContaining({ title: "Ben took on “Write the release notes”" })]);
  });

  it("an open ask to someone who muted the asker's assistant: never told (refused at once, or expiring quietly)", async () => {
    await setMute(olu, id(ada), true);
    const ask = await say(ada, launch, "Olu, can you check the pricing copy?");
    expect((await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: launch, sourceMessageId: ask, kind: "open_ask", committerMembershipId: id(olu), askerMembershipId: id(ada) })])).created).toEqual([]);
    await setMute(olu, id(ada), false);
    const ask2 = await say(ada, launch, "Olu, can you send the figures?");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: launch, sourceMessageId: ask2, kind: "open_ask", committerMembershipId: id(olu), askerMembershipId: id(ada), title: "Send the figures" })])).created[0];
    await setMute(olu, id(ada), true);
    expect((await C.sweepCommitments({ now: later(61) })).asksDelivered).toBe(0);
    expect(await notifications(id(olu), "brenda.open_ask")).toEqual([]);
    expect(await adminQuery("SELECT status, notified_at, ask_notify_after FROM commitments WHERE id = $1", [cid])).toEqual([{ status: "asked", notified_at: null, ask_notify_after: null }]);
    // Seven days on it expires, and Olu never sees it.
    expect((await C.sweepCommitments({ now: later(8 * 24 * 60) })).expired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(cid)).toBe("expired");
    expect((await C.listCommitments(olu, { scope: "mine" })).items.some((i) => i.id === cid)).toBe(false);
    await setMute(olu, id(ada), false);
  });

  it("an \"On it\" before the hour turns the open ask into a proposal with the agreement's label", async () => {
    // David asks (Ada has used her three asks of Ben today).
    const ask = await say(david, design, "Ben, can you update the style guide?");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: ask, kind: "open_ask", committerMembershipId: id(ben), askerMembershipId: id(david), title: "Update the style guide" })])).created[0];
    expect(cid).toBeTruthy();
    const ok = await say(ben, design, "Will do", ask);
    // Someone else's words can never be the agreement.
    const notBens = await say(ada, design, "thanks");
    expect(await C.markAgreed(cid, notBens)).toBe(false);
    expect(await C.markAgreed(cid, ok)).toBe(true);
    expect(await C.markAgreed(cid, ok)).toBe(false);
    expect(await adminQuery("SELECT kind, status, agreement_message_id, ask_notify_after, notified_at IS NOT NULL AS told FROM commitments WHERE id = $1", [cid]))
      .toEqual([{ kind: "agreed_ask", status: "proposed", agreement_message_id: ok, ask_notify_after: null, told: true }]);
    expect(await labelOf(ok)).toBe("noted");
    expect(await labelOf(ask)).toBeNull();
    expect((await notifications(id(ben), "brenda.commitment")).find((n) => n.resource_id === cid)?.title).toBe("Brenda noted you agreed to “Update the style guide” for David");
    expect((await notifications(id(ben), "brenda.open_ask")).some((n) => n.resource_id === cid)).toBe(false);
  });
});

// ---- 4. Time and the unexpected --------------------------------------------------------------------------------------------------

describe("expiry, withdrawal and an interrupted accept", () => {
  it("unanswered for 7 days: expired, the label gone, the notification closed", async () => {
    const p = await benPromises("I'll tidy the icon set", "Tidy the icon set");
    expect(await labelOf(p.msg)).toBe("noted");
    await C.sweepCommitments({ now: later(7 * 24 * 60 + 5) });
    expect(await statusOf(p.cid)).toBe("expired");
    expect(await labelOf(p.msg)).toBeNull();
    expect(await adminQuery("SELECT read_at IS NOT NULL AS read, body FROM notifications WHERE deduplication_key = $1", [`commitment:${p.cid}`])).toEqual([{ read: true, body: LOOP_WORDS.errors.expired }]);
  });

  it("past its time an accept answers 409 ITEM_EXPIRED, before any sweep", async () => {
    const msg = await say(ben, design, "I'll send the moodboard");
    const old = new Date(Date.now() - 8 * 86_400_000);
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: msg, kind: "promise", committerMembershipId: id(ben), title: "Send the moodboard", messageAt: old.toISOString() })], { now: old })).created[0];
    await expect(C.acceptCommitment(ben, cid, {})).rejects.toMatchObject({ status: 409, code: "ITEM_EXPIRED" });
  });

  it("its message withdrawn before an answer: cancelled, the label gone", async () => {
    const p = await benPromises("I'll call the printer", "Call the printer");
    await withdrawMessage(ben, p.msg);
    expect(await C.getCommitment(ben, p.cid)).toMatchObject({ status: "cancelled", message: { withdrawn: true, quote: null } });
    expect(await labelOf(p.msg)).toBeNull();
  });

  it("an accept interrupted before the to-do was recorded: open without a to-do, never a second one, the person told", async () => {
    const p = await benPromises("I'll order the samples", "Order the samples");
    expect(await withUser(ben.user.profileId, (db) => db.one<{ r: string }>("SELECT app_commitment_decide($1, 'accept', NULL) AS r", [p.cid]))).toEqual({ r: "ok" });
    const tasks = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM tasks"))[0].n;
    expect((await C.sweepCommitments({ now: later(1) })).interrupted).toBe(0);
    expect((await C.sweepCommitments({ now: later(6) })).interrupted).toBe(1);
    expect(await adminQuery("SELECT status, todo_task_id FROM commitments WHERE id = $1", [p.cid])).toEqual([{ status: "open", todo_task_id: null }]);
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM tasks"))[0].n).toBe(tasks);
    expect(await notifications(id(ben), "brenda.commitment")).toEqual(expect.arrayContaining([expect.objectContaining({ title: LOOP_WORDS.notifications.acceptInterrupted, deduplication_key: `commitment.interrupted:${p.cid}` })]));
    expect(await labelOf(p.msg)).toBe("noted");
  });

  it("an owner's accept tracks it without a to-do", async () => {
    const everyone = await openChannel(owner, null);
    const msg = await say(owner, everyone, "I'll sign the contracts Friday");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: everyone, sourceMessageId: msg, kind: "promise", committerMembershipId: id(owner), title: "Sign the contracts" })])).created[0];
    expect((await notifications(id(owner), "brenda.commitment"))[0].body).toBe(`${LOOP_WORDS.inbox.commitmentQuestionNoTodos} ${LOOP_WORDS.inbox.nothingChanges}`);
    const r = await C.acceptCommitment(owner, cid, {});
    expect(r).toMatchObject({ note: null, commitment: { status: "open", todo: null, acceptMakesTodo: false } });
  });
});

// ---- 5. Limits and lists --------------------------------------------------------------------------------------------------------

describe("limits and lists", () => {
  it(`at most ${LOOP_LIMITS.proposalsPerPersonPerDay} a person a day, and ${LOOP_LIMITS.asksPerPairPerDay} asks a day from the same person`, async () => {
    // Olu, in #Launch: three asks from Ada pass, the fourth does not.
    const asks: DetectedCommitment[] = [];
    for (let i = 0; i < 4; i++) {
      const m = await say(ada, launch, `Olu, can you check item ${i}?`);
      asks.push(det({ conversationId: launch, sourceMessageId: m, kind: "open_ask", committerMembershipId: id(olu), askerMembershipId: id(ada), title: `Check item ${i}` }));
    }
    const today = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM commitments WHERE committer_membership_id = $1 AND kind <> 'promise' AND asker_membership_id = $2 AND created_at > now() - interval '1 day'", [id(olu), id(ada)]))[0].n;
    const r = await C.insertDetectedCommitments(owner.org.id, asks);
    expect(r.created).toHaveLength(Math.max(0, LOOP_LIMITS.asksPerPairPerDay - today));
    // Olu's own promises fill his day.
    const promises: DetectedCommitment[] = [];
    for (let i = 0; i < 12; i++) {
      const m = await say(olu, launch, `I'll prepare part ${i}`);
      promises.push(det({ conversationId: launch, sourceMessageId: m, kind: "promise", committerMembershipId: id(olu), title: `Prepare part ${i}` }));
    }
    await C.insertDetectedCommitments(owner.org.id, promises);
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM commitments WHERE committer_membership_id = $1 AND created_at > now() - interval '1 day'", [id(olu)]))[0].n).toBe(LOOP_LIMITS.proposalsPerPersonPerDay);
    // One per message and committer: the same row again is skipped.
    expect((await C.insertDetectedCommitments(owner.org.id, [promises[0]])).created).toEqual([]);
  });

  it("scopes: mine for everyone, team for leads, everyone's for the owner and HR; filters", async () => {
    expect((await C.listCommitments(ben, { scope: "mine" })).scopes).toEqual(["mine"]);
    expect((await C.listCommitments(david, { scope: "mine" })).scopes).toEqual(["mine", "team"]);
    expect((await C.listCommitments(owner, { scope: "mine" })).scopes).toEqual(["mine", "all"]);
    await expect(C.listCommitments(ben, { scope: "team" })).rejects.toMatchObject({ status: 403 });
    await expect(C.listCommitments(david, { scope: "all" })).rejects.toMatchObject({ status: 403 });
    // Sam leads Sales: Ben's are not his.
    expect((await C.listCommitments(sam, { scope: "team" })).items.some((i) => i.committer.membershipId === id(ben))).toBe(false);
    const all = await C.listCommitments(mary, { scope: "all" });
    expect(all.items.every((i) => i.status === "open" || i.status === "done")).toBe(true);
    expect(all.items.length).toBeGreaterThan(0);
    const byName = await C.listCommitments(mary, { scope: "all", person: "ben okafor" });
    expect(byName.items.every((i) => i.committer.membershipId === id(ben))).toBe(true);
    expect((await C.listCommitments(mary, { scope: "all", person: "Nobody Here" })).items).toEqual([]);
    const mine = await C.listCommitments(ben, { scope: "mine", status: "done" });
    expect(mine.items.every((i) => i.status === "done")).toBe(true);
    expect(mine.counts).toEqual(expect.objectContaining({ waiting: expect.any(Number), open: expect.any(Number), overdue: expect.any(Number) }));
    // Paging.
    const page1 = await C.listCommitments(ben, { scope: "mine", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextBefore).not.toBeNull();
    const page2 = await C.listCommitments(ben, { scope: "mine", limit: 2, before: page1.nextBefore });
    expect(page2.items.some((i) => page1.items.some((j) => j.id === i.id))).toBe(false);
  });

  it("overdue, the report's section and the notch", async () => {
    // Ben's day is full: past ten, nothing more is noted for him today.
    const full = await say(ben, design, "I'll send the invoices");
    expect((await C.insertDetectedCommitments(owner.org.id, [det({ conversationId: design, sourceMessageId: full, kind: "promise", committerMembershipId: id(ben) })])).created).toEqual([]);
    const p = await adaPromises("I'll send the invoices", "Send the invoices");
    await C.acceptCommitment(ada, p.cid, { dueAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(await C.getCommitment(ada, p.cid)).toMatchObject({ display: "overdue", badge: { label: "Overdue", tone: "danger" } });
    expect((await C.listCommitments(david, { scope: "team", status: "overdue" })).items.map((i) => i.id)).toEqual([p.cid]);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
    const rep = await C.commitmentsForReport(david, today);
    expect(rep!.overdue.map((i) => i.id)).toContain(p.cid);
    expect(rep!.madeToday.every((i) => i.committer.membershipId !== id(david))).toBe(true);
    expect(rep!.madeToday.map((i) => i.id)).toContain(p.cid);
    const notch = await C.loopsForDesktop(ada);
    expect(notch.ready).toBe(true);
    expect(notch.looseEnds).toEqual({ open: 0, href: "/app/company-a/home/loose-ends" });
    const fresh = await adaPromises("I'll share the recap", "Share the recap");
    const card = (await C.loopsForDesktop(ada)).commitments.find((c) => c.id === fresh.cid);
    expect(card).toEqual({ id: fresh.cid, kind: "commitment", title: "Brenda noted you said you'd “Share the recap”", what: "Share the recap", dueLabel: null, from: null, acceptLabel: "Add to my to-dos", href: `/app/company-a/home/assistants?f=${fresh.cid}` });
    await C.markCommitmentSeen(ada, fresh.cid);
    expect(await adminQuery("SELECT seen_at IS NOT NULL AS seen FROM commitments WHERE id = $1", [fresh.cid])).toEqual([{ seen: true }]);
    await expect(C.markCommitmentSeen(ben, fresh.cid)).rejects.toMatchObject({ status: 404 });
  });
});
