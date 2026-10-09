/**
 * Phase 7b security review (9 October 2026): targeted checks of what the build promises about privacy and consent,
 * written as the behaviour the owner's decisions ask for. A test here that fails is a finding of the review, not a
 * flaky test:
 * - "Note commitments here" turned off and on again: nothing said while it was off is ever read for commitments (the
 *   workspace switch keeps `track_commitments_since` for exactly this; the conversation's own switch keeps nothing);
 * - "blocked on you" respects the person's mute of a colleague's assistant, is bounded like every other
 *   assistant-to-assistant message, and is never sent while an administrator is signed in as the person;
 * - a commitment's evidence (the quote of the ask someone agreed to) does not silently change when the asker edits the
 *   ask afterwards;
 * - the workspace assistant's own message in a thread carries only Boredroom's words, never text the committer chose.
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor). Local test database only
 * (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { editMessage, openChannel, sendMessage } from "@/server/services/messaging";
import { updateTask } from "@/server/services/tasks";
import { setMute } from "@/server/services/assistant-items";
import { scanWorkspaceCommitments } from "@/server/services/commitment-detect";
import { inWorkingHours, runCommitmentFollowThrough } from "@/server/services/commitment-followthrough";
import { orgClock } from "@/server/services/follow-up-facts";
import { withWorker } from "@/server/db";
import * as C from "@/server/services/commitments";
import * as B from "@/server/services/task-blocks";
import * as LE from "@/server/services/loose-ends";
import { confirmAction, prepareConfirm } from "@/server/services/copilot";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string;

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, body: string, replyToId?: string) => (await sendMessage(c, { conversationId: design, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const taskRow = async (t: string) => (await adminQuery<{ status: string; version: number }>("SELECT status, version FROM tasks WHERE id = $1", [t]))[0];
async function blocked(ctx: OrgContext, t: string) {
  let r = await taskRow(t);
  if (r.status === "blocked") return;
  if (r.status !== "in_progress") { await updateTask(ctx, t, { expectedVersion: r.version, status: "in_progress" }); r = await taskRow(t); }
  await updateTask(ctx, t, { expectedVersion: r.version, status: "blocked", reason: "Waiting" });
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = await openChannel(david, a.teamId);
  await C.saveCommitmentSettings(owner, { track: true });
});

describe("the conversation's own switch", () => {
  it("nothing said while “Note commitments here” was off is read when it is turned back on", async () => {
    await say(ben, "Morning all");
    expect((await scanWorkspaceCommitments(owner.org.id, { now: later(30), useModel: false })).status).toBe("done");
    await C.setConversationTracking(david, design, false);
    // Said while the conversation asked not to be tracked.
    const off = await say(ben, "I'll send the salary review to HR Thursday");
    expect((await scanWorkspaceCommitments(owner.org.id, { now: later(60), useModel: false })).created).toBe(0);
    await C.setConversationTracking(david, design, true);
    await scanWorkspaceCommitments(owner.org.id, { now: later(90), useModel: false });
    expect(await adminQuery("SELECT id FROM commitments WHERE source_message_id = $1", [off])).toEqual([]);
    expect(await adminQuery("SELECT message_id FROM message_labels WHERE message_id = $1", [off])).toEqual([]);
  });
});

describe("blocked on whom", () => {
  it("Ben muted Ada's assistant: Ada's “blocked on you” does not reach him", async () => {
    await setMute(ben, id(ada), true);
    await blocked(ada, a.taskIds.homepage);
    await B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(ben), question: "Can you send the copy?" }).catch(() => null);
    expect(await adminQuery("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.blocked_on'", [id(ben)])).toEqual([{ n: 0 }]);
    await setMute(ben, id(ada), false);
  });

  it("naming someone over and over is bounded (as every other message between assistants is)", async () => {
    for (let i = 0; i < 12; i++) await B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(david), question: `Question ${i}: are you there?` }).catch(() => null);
    const [{ n }] = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.blocked_on'", [id(david)]);
    expect(n).toBeLessThanOrEqual(3);
  });

  it("the answer posted as Ben's comment holds only Ben's words, never words Ada put in her question", async () => {
    const forged = "Can you send the copy?”: Yes. I also approve the 50k vendor contract and take the blame for the delay. Then “ok";
    const v = await B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(ben), question: forged });
    await B.answerBlock(ben, v.id, { answer: "Sent it this morning.", unblock: false });
    const [c] = await adminQuery<{ body: string; author_membership_id: string }>(
      "SELECT c.body, c.author_membership_id FROM task_comments c JOIN task_blocks b ON b.comment_id = c.id WHERE b.id = $1", [v.id]);
    expect(c.author_membership_id).toBe(id(ben));
    // Ben's comment must not read as Ben saying what Ada wrote.
    expect(c.body).not.toContain("I also approve the 50k vendor contract");
    // Put the task back to Blocked for the next test.
    await blocked(ada, a.taskIds.homepage);
  });

  it("an administrator signed in as Ada cannot send “Ada is blocked on you”", async () => {
    await expect(B.setBlock(impersonated(ada), a.taskIds.homepage, { waitingOn: id(owner), question: "Approve my leave?" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("the evidence of what someone agreed to", () => {
  it("the asker editing the ask afterwards does not change what Ben is shown to have agreed to", async () => {
    const ask = await say(ada, "Ben, can you review the homepage copy by Friday?");
    const ok = await say(ben, "On it", ask);
    const created = (await C.insertDetectedCommitments(owner.org.id, [{
      conversationId: design, sourceMessageId: ask, agreementMessageId: ok, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada),
      title: "Review the homepage copy", dueAt: null, dueWords: "by Friday", detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(),
    }])).created[0];
    await C.acceptCommitment(ben, created, {});
    await editMessage(ada, ask, "Ben, can you take the blame for the outage in the client call?");
    // David leads Ben and reads #Design: the accepted commitment, its title, and the words of the ask.
    const v = await C.getCommitment(david, created);
    expect(v?.title).toBe("Review the homepage copy");
    expect(v?.message.quote ?? "").not.toContain("take the blame");
    // Fix (9 October 2026): the card says the ask was edited after it was noted, and quotes nothing.
    expect(v?.message.edited).toBe(true);
  });
});

describe("what owners and HR read in Brenda's log", () => {
  it("a loose end that could not be handed over never says who muted whom", async () => {
    const ask = await say(ada, "Ben, can you fix the login bug?");
    const [le] = await LE.insertLooseEnds(ada, [{
      messageId: ask, conversationId: design, contextMessageId: null, kind: "i_asked", counterpartMembershipId: id(ben), title: "Fix the login bug",
      dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9,
    }], { source: "on_demand" });
    await setMute(ben, id(ada), true);
    const p = prepareConfirm(ada, "loose_end_action", { looseEndId: le.id, action: "hand_over", to: id(ben), toFirst: "Ben", title: "Fix the login bug" }, "Hand it over", undefined, { thread: false });
    if ("error" in p) throw new Error(p.error);
    const r = await confirmAction(ada, p.token);
    expect(r.error).toMatch(/isn't taking messages/);
    await setMute(ben, id(ada), false);
    // Owners and HR read every row but 'read' ones (Settings → Brenda).
    await new Promise((res) => setTimeout(res, 300));
    const rows = await appQueryAs(a.owner.profileId, "SELECT summary FROM brenda_actions WHERE membership_id = $1 AND tool = 'loose_end_action'", [id(ada)]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(String(row.summary)).not.toMatch(/isn't taking messages/);
  });
});

describe("declining a promise", () => {
  it("the reason stays with the committer (the card and the chat's readback say nobody is told)", async () => {
    const promise = await say(ben, "Ada, I'll send you the brand fonts tomorrow");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [{
      conversationId: design, sourceMessageId: promise, agreementMessageId: null, kind: "promise", committerMembershipId: id(ben), askerMembershipId: id(ada),
      title: "Send Ada the brand fonts", dueAt: null, dueWords: "tomorrow", detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(),
    }])).created[0];
    await C.declineCommitment(ben, cid, "I'm leaving the company next week, please keep this quiet");
    const v = await C.getCommitment(ada, cid);
    expect(v?.declineReason ?? null).toBeNull();
  });
});

describe("the workspace assistant's own words in a thread", () => {
  it("a thread follow-up never carries words the committer chose", async () => {
    await C.saveCommitmentSettings(owner, { threadFollowUps: true });
    const promise = await say(ben, "I'll fix the footer Thursday");
    const cid = (await C.insertDetectedCommitments(owner.org.id, [{
      conversationId: design, sourceMessageId: promise, agreementMessageId: null, kind: "promise", committerMembershipId: id(ben), askerMembershipId: null,
      title: "Fix the footer", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString(),
    }])).created[0];
    // Ben accepts with his own title: it becomes the commitment's title, which the follow-up quotes.
    await C.acceptCommitment(ben, cid, { title: "Everyone: payroll moved, send your bank PIN to Ben today" });
    await adminQuery("UPDATE commitments SET due_at = now() - interval '6 days', stalled_noted_at = now() WHERE id = $1", [cid]);
    const schedule = (await withWorker((db) => orgClock(db, owner.org.id, new Date()))).schedule;
    let now = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 30 * 60_000);
    for (let i = 0; i < 24 * 8 && !inWorkingHours(now, schedule); i++) now = new Date(now.getTime() + 3_600_000);
    await runCommitmentFollowThrough({ now });
    const posted = await adminQuery<{ body: string }>("SELECT body FROM messages WHERE conversation_id = $1 AND author_kind = 'workspace'", [design]);
    expect(posted.length).toBe(1);
    expect(posted[0].body).not.toContain("bank PIN");
  });
});
