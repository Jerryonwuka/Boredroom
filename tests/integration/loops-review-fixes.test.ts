/**
 * Phase 7b review fixes (9 October 2026), against the database:
 * - the scan's cursor keeps the message's exact time, so a second scan reads nothing (and the organisation is not due);
 * - "Note commitments here" turned back on records when (0049), and nothing said while it was off is read as context;
 * - a reply that both agrees and promises is the ask agreed: one commitment, never an open ask and a promise;
 * - the owner's Everyone list settles on the spot (the scope binds its parameters);
 * - a promise's "asker" never reads the committer's decline reason; an ask's asker does;
 * - an ask of the person and their own "On it" to it are one loose end;
 * - an answer recorded but never posted is posted by the sweep; starting a session on a blocked task settles its block;
 * - twin loose ends: acting on one closes the other, and two presses at once make one to-do;
 * - jobs an older worker killed ("no handler for job type …") are claimed straight to running by this worker, never put
 *   back where that worker takes them again.
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (Design: Ada Nwosu, Ben Okafor). Local test database only.
 * No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { openChannel, sendMessage } from "@/server/services/messaging";
import { updateTask } from "@/server/services/tasks";
import { startSession } from "@/server/services/sessions";
import { scanWorkspaceCommitments, trackedOrgsDue } from "@/server/services/commitment-detect";
import { scanLooseEnds } from "@/server/services/loose-end-detect";
import * as LE from "@/server/services/loose-ends";
import { claimKilledJobs } from "../../worker/schedule";
import * as C from "@/server/services/commitments";
import * as B from "@/server/services/task-blocks";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string;

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, body: string, replyToId?: string) => (await sendMessage(c, { conversationId: design, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
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

describe("the scan's cursor", () => {
  it("a second scan reads nothing, and the organisation is no longer due", async () => {
    await say(ben, "I'll send the deck Thursday");
    const first = await scanWorkspaceCommitments(owner.org.id, { now: later(30), useModel: false });
    expect(first.read).toBeGreaterThan(0);
    const second = await scanWorkspaceCommitments(owner.org.id, { now: later(40), useModel: false });
    expect(second).toMatchObject({ read: 0, created: 0 });
    expect((await trackedOrgsDue({ now: later(50) })).map((o) => o.organisationId)).not.toContain(owner.org.id);
  });
});

describe("the conversation's own switch (0049)", () => {
  it("turning it back on records when, and the off period is not read as context either", async () => {
    await C.setConversationTracking(david, design, false);
    const off = await say(ada, "Ben, can you send the salary review to HR by Thursday?");
    await C.setConversationTracking(david, design, true);
    const [row] = await adminQuery<{ since: string | null }>("SELECT track_commitments_since AS since FROM conversations WHERE id = $1", [design]);
    expect(row.since).not.toBeNull();
    // Ben agrees after it is back on: the ask he agrees to was said while it was off, so there is nothing to note.
    await say(ben, "On it", off);
    await scanWorkspaceCommitments(owner.org.id, { now: later(60), useModel: false });
    expect(await adminQuery("SELECT id FROM commitments WHERE source_message_id = $1", [off])).toEqual([]);
  });
});

describe("agreeing and promising in one reply", () => {
  it("is the ask agreed: one commitment for the work", async () => {
    const ask = await say(ada, "Ben, can you fix the login bug by Friday?");
    const reply = await say(ben, "I'll fix the login bug by Friday", ask);
    await scanWorkspaceCommitments(owner.org.id, { now: later(90), useModel: false });
    const rows = await adminQuery<{ kind: string; source_message_id: string; agreement_message_id: string | null }>(
      "SELECT kind, source_message_id, agreement_message_id FROM commitments WHERE source_message_id = ANY($1::uuid[]) OR agreement_message_id = ANY($1::uuid[])", [[ask, reply]]);
    expect(rows).toEqual([{ kind: "agreed_ask", source_message_id: ask, agreement_message_id: reply }]);
  });
});

describe("reading", () => {
  it("the owner's Everyone list settles without an error, and a scope the person may not read is refused first", async () => {
    const warnings: string[] = [];
    const was = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
    try {
      const r = await C.listCommitments(owner, { scope: "all" });
      expect(r.ready).toBe(true);
      await expect(C.listCommitments(ada, { scope: "all" })).rejects.toMatchObject({ status: 403 });
    } finally { console.warn = was; }
    expect(warnings.filter((w) => w.includes("settling commitments"))).toEqual([]);
  });

  it("a promise's addressee never reads the decline reason; an ask's asker does", async () => {
    const p = await say(ben, "Ada, I'll send you the fonts tomorrow");
    const ask = await say(ada, "Ben, can you check the footer by Friday?");
    const [promise, agreed] = (await C.insertDetectedCommitments(owner.org.id, [
      { conversationId: design, sourceMessageId: p, agreementMessageId: null, kind: "promise", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Send Ada the fonts", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() },
      { conversationId: design, sourceMessageId: ask, agreementMessageId: p, kind: "agreed_ask", committerMembershipId: id(ben), askerMembershipId: id(ada), title: "Check the footer", dueAt: null, dueWords: null, detectedBy: "builtin", confidence: 0.9, messageAt: new Date().toISOString() },
    ])).created;
    await C.declineCommitment(ben, promise, "Private reason");
    await C.declineCommitment(ben, agreed, "Out next week");
    expect((await C.getCommitment(ada, promise))?.declineReason ?? null).toBeNull();
    expect((await C.getCommitment(ben, promise))?.declineReason).toBe("Private reason");
    expect((await C.getCommitment(ada, agreed))?.declineReason).toBe("Out next week");
  });
});

describe("loose ends", () => {
  it("an ask of the person and their own “On it” to it are one loose end", async () => {
    const dm = (await import("@/server/services/messaging")).openDirect;
    const conv = await dm(david, id(ben));
    const ask = (await sendMessage(david, { conversationId: conv, body: "Ben, can you fix the signup form by Friday?" }, { startMention: false })).id;
    await sendMessage(ben, { conversationId: conv, body: "On it", replyToId: ask }, { startMention: false });
    const r = await scanLooseEnds(ben, { source: "on_demand", useModel: false });
    const mine = r.found.filter((v) => v.message.conversationId === conv);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("promise");
  });
});

describe("twin loose ends", () => {
  async function twins(body: string) {
    const conv = await (await import("@/server/services/messaging")).openDirect(owner, id(ben));
    const ask = (await sendMessage(owner, { conversationId: conv, body }, { startMention: false })).id;
    const yes = (await sendMessage(ben, { conversationId: conv, body: "On it", replyToId: ask }, { startMention: false })).id;
    const base = { conversationId: conv, counterpartMembershipId: id(owner), title: "Fix the login bug", dueAt: null, dueWords: null, detectedBy: "builtin" as const, confidence: 0.8 };
    const [asked, promised] = await LE.insertLooseEnds(ben, [
      { ...base, messageId: ask, contextMessageId: null, kind: "asked_of_me" },
      { ...base, messageId: yes, contextMessageId: ask, kind: "promise" },
    ], { source: "on_demand" });
    return { asked, promised };
  }
  const todos = async () => (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM tasks WHERE assignee_membership_id = $1 AND title = 'Fix the login bug'", [id(ben)]))[0].n;

  it("a to-do made from one closes the other: its own press is refused, and the list shows it done elsewhere", async () => {
    const before = await todos();
    const { asked, promised } = await twins("Ben, can you fix the login bug by Friday?");
    await LE.looseEndToTodo(ben, asked.id, { title: "Fix the login bug" });
    await expect(LE.looseEndToTodo(ben, promised.id, { title: "Fix the login bug" })).rejects.toMatchObject({ status: 409 });
    expect(await todos()).toBe(before + 1);
    const list = await LE.listLooseEnds(ben, { status: "all" });
    expect(list.items.find((v) => v.id === promised.id)?.status).toBe("resolved");
  });

  it("two presses at once, one on each, make one to-do", async () => {
    const before = await todos();
    const { asked, promised } = await twins("Ben, could you fix the login bug before the demo?");
    const r = await Promise.allSettled([
      LE.looseEndToTodo(ben, asked.id, { title: "Fix the login bug" }),
      LE.looseEndToTodo(ben, promised.id, { title: "Fix the login bug" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await todos()).toBe(before + 1);
  });
});

describe("jobs an older worker killed", () => {
  it("are claimed straight to running under this worker's name, once, with attempts left, of types it knows", async () => {
    const ins = async (type: string, attempts: number, err = "no handler for job type " + type) => (await adminQuery<{ id: string }>(
      "INSERT INTO jobs(type, state, attempts, last_error, finished_at) VALUES ($1, 'dead', $2, $3, now()) RETURNING id", [type, attempts, err]))[0].id;
    const killed = await ins("commitments.scan", 1);
    const spent = await ins("commitments.scan", 8);
    const unknown = await ins("something.new", 1);
    const failedHere = await ins("commitments.scan", 1, "boom");
    const got = await claimKilledJobs("test-worker:1", ["commitments.scan", "commitments.sweep"]);
    expect(got.map((j) => j.id)).toEqual([killed]);
    expect(got[0]).toMatchObject({ type: "commitments.scan", attempts: 2 });
    const rows = await adminQuery<{ id: string; state: string; locked_by: string | null }>("SELECT id, state, locked_by FROM jobs WHERE id = ANY($1::uuid[]) ORDER BY id", [[killed, spent, unknown, failedHere]]);
    expect(rows.find((x) => x.id === killed)).toMatchObject({ state: "running", locked_by: "test-worker:1" });
    for (const other of [spent, unknown, failedHere]) expect(rows.find((x) => x.id === other)?.state).toBe("dead");
    expect(await claimKilledJobs("test-worker:2", ["commitments.scan"])).toEqual([]);
  });
});

describe("blocked on whom", () => {
  it("an answer recorded but not posted is posted by the sweep, as the answerer", async () => {
    await blocked(ada, a.taskIds.homepage);
    const v = await B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(ben), question: "Can you send the copy?" });
    await B.answerBlock(ben, v.id, { answer: "Sent.", unblock: false });
    // As if the posting had failed: the comment link is cleared and the answer made older than two minutes.
    await adminQuery("UPDATE task_blocks SET comment_id = NULL, answered_at = now() - interval '5 minutes' WHERE id = $1", [v.id]);
    await B.settleBlocks({ limit: 10 });
    const rows = await adminQuery<{ author_membership_id: string; body: string }>(
      "SELECT c.author_membership_id, c.body FROM task_comments c JOIN task_blocks b ON b.comment_id = c.id WHERE b.id = $1", [v.id]);
    expect(rows).toEqual([{ author_membership_id: id(ben), body: "Answer to Ada's question: Sent." }]);
  });

  it("starting a session on a blocked task settles its “blocked on you” at once", async () => {
    await blocked(ada, a.taskIds.homepage);
    const v = await B.setBlock(ada, a.taskIds.homepage, { waitingOn: id(david), question: "Can you approve the layout?" });
    await startSession(ada, { taskId: a.taskIds.homepage });
    const [row] = await adminQuery<{ status: string }>("SELECT status FROM task_blocks WHERE id = $1", [v.id]);
    expect(row.status).toBe("cleared");
  });
});
