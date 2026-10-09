/**
 * Phase 7b end to end (owner decisions, 8 October 2026: "Brenda keeps the loops closed", second part), the way it really
 * runs: the workspace's scan reads a tracked channel with its built-in rules (no model) and notes an agreed ask and a
 * promise, its cursor moves on so a second scan notes nothing again; Ben accepts and David's end-of-day report shows it
 * under Commitments; the notch carries the noted card; David's chase finds a task stalled a second time and the answer
 * suggests a new due date that nothing applies until he confirms; Ada's "Loose ends" routine runs through the worker as
 * her and keeps what it found, privately.
 *
 * Run LAST, after every builder's part is in. Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (Design: Ada
 * Nwosu, Ben Okafor). Local test database only (TEST_DATABASE_URL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { addComment, createTask } from "@/server/services/tasks";
import { openChannel, sendMessage, thread } from "@/server/services/messaging";
import { desktopState } from "@/server/services/desktop";
import { processFollowUpIds, processFollowUp, replyToFollowUp, getFollowUp } from "@/server/services/follow-ups";
import { buildDailyReport, commitmentsMarkdown } from "@/server/services/daily-report";
import { scanWorkspaceCommitments } from "@/server/services/commitment-detect";
import * as C from "@/server/services/commitments";
import * as LE from "@/server/services/loose-ends";
import * as RP from "@/server/services/replans";
import * as R from "@/server/services/routines";
import type { RoutineView } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const JOB = { jobId: "loops-e2e", attempt: 1 };
let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, ada: OrgContext, ben: OrgContext;
let design: string;

const id = (c: OrgContext) => c.membership.id;
const say = async (c: OrgContext, body: string, replyToId?: string) => (await sendMessage(c, { conversationId: design, body, replyToId: replyToId ?? null }, { startMention: false })).id;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

async function worker() {
  const schedule = await import("../../worker/schedule");
  const { handlers } = await import("../../worker/handlers");
  return { schedule, handlers };
}
async function previewAndEnable(ctx: OrgContext, routineId: string): Promise<RoutineView> {
  const p = await R.previewRoutine(ctx, routineId);
  return R.enableRoutine(ctx, routineId, { consentHash: p.consent.hash });
}
let bumps = 0;
async function dueSoon(routineId: string) {
  const at = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000 + ++bumps * 60_000);
  await adminQuery("UPDATE routines SET next_run_at = $2 WHERE id = $1", [routineId, at.toISOString()]);
}
/** The worker at the routine's time: the scheduler queues its `routine.run` job and the handler runs it. */
async function workerRuns(routineId: string) {
  const { schedule, handlers } = await worker();
  const [r] = await adminQuery<{ next_run_at: string }>("SELECT next_run_at FROM routines WHERE id = $1", [routineId]);
  const at = new Date(r.next_run_at);
  await schedule.scheduleRoutines(new Date(at.getTime() - 30_000));
  const [job] = await adminQuery<{ payload: Record<string, unknown> }>("SELECT payload FROM jobs WHERE type = 'routine.run' AND dedup_key = $1", [`routine.run:${routineId}:${at.toISOString()}`]);
  expect(job, "the scheduler queued the routine").toBeDefined();
  await handlers["routine.run"](job.payload, JOB);
  const [run] = await adminQuery<{ id: string; status: string; delivery: string }>("SELECT id, status, delivery FROM routine_runs WHERE routine_id = $1 AND due_at = $2", [routineId, at.toISOString()]);
  return run;
}
/** A follow-up taken to its answer as the worker does (from the facts, or asking Ben once and passing on his reply). */
async function answered(followUpId: string) {
  await processFollowUpIds([followUpId], { useModel: false });
  const [f] = await adminQuery<{ status: string }>("SELECT status FROM follow_ups WHERE id = $1", [followUpId]);
  if (f.status === "asking") {
    await replyToFollowUp(ben, followUpId, { choice: "on_track", note: "Nearly there" }, { useModel: false, start: false });
    await processFollowUp(followUpId, { useModel: false });
  }
  return (await adminQuery<{ status: string }>("SELECT status FROM follow_ups WHERE id = $1", [followUpId]))[0].status;
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Ada Nwosu", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; ada = a.employeeCtx; ben = a.employee2Ctx;
  design = await openChannel(david, a.teamId);
});

describe("the workspace notes commitments in a tracked channel", () => {
  let agreed: string, promise: string, ok: string;

  it("the built-in scan notes an agreed ask and a promise, and reads each message once", async () => {
    expect((await scanWorkspaceCommitments(owner.org.id, { useModel: false })).status).toBe("off");
    await C.saveCommitmentSettings(owner, { track: true });
    const ask = await say(ada, "Ben, can you fix the login bug by Friday?");
    ok = await say(ben, "On it", ask);
    const deck = await say(ben, "I'll send the deck Thursday");
    const r = await scanWorkspaceCommitments(owner.org.id, { now: later(30), useModel: false });
    expect(r).toMatchObject({ status: "done", engine: "builtin" });
    expect(r.created).toBe(2);
    const rows = await adminQuery<{ id: string; kind: string; committer_membership_id: string; asker_membership_id: string | null; source_message_id: string; agreement_message_id: string | null; status: string; detected_by: string }>(
      "SELECT id, kind, committer_membership_id, asker_membership_id, source_message_id, agreement_message_id, status, detected_by FROM commitments ORDER BY created_at");
    const ag = rows.find((x) => x.kind === "agreed_ask")!;
    const pr = rows.find((x) => x.kind === "promise")!;
    expect(ag).toMatchObject({ committer_membership_id: id(ben), asker_membership_id: id(ada), source_message_id: ask, agreement_message_id: ok, status: "proposed", detected_by: "builtin" });
    expect(pr).toMatchObject({ committer_membership_id: id(ben), source_message_id: deck, status: "proposed" });
    agreed = ag.id; promise = pr.id;
    // The cursor moved on: a second look notes nothing again.
    const again = await scanWorkspaceCommitments(owner.org.id, { now: later(60), useModel: false });
    expect(again.created).toBe(0);
    expect(await adminQuery("SELECT count(*)::int AS n FROM commitments")).toEqual([{ n: 2 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM commitment_scan_cursors WHERE conversation_id = $1", [design])).toEqual([{ n: 1 }]);
    // Everyone in #Design sees the labels.
    const t = await thread(ada, design);
    expect(t!.messages.find((m) => m.id === ok)!.commitment_label).toEqual({ state: "noted", text: "Noted" });
    expect(t!.messages.find((m) => m.id === deck)!.commitment_label).toEqual({ state: "noted", text: "Noted" });
  });

  it("the notch carries Ben's cards; Ben accepts; David's report shows it under Commitments", async () => {
    const s = await desktopState(ben);
    expect(s.loops.ready).toBe(true);
    expect(s.loops.commitments.map((c) => c.id).sort()).toEqual([agreed, promise].sort());
    expect(s.loops.commitments.find((c) => c.id === agreed)).toMatchObject({ kind: "commitment", title: "Brenda noted you agreed to Ada's ask: “Fix the login bug”", from: { name: "Ada Nwosu" } });
    const accepted = await C.acceptCommitment(ben, promise, {});
    expect(accepted.commitment.todo).not.toBeNull();
    await C.acceptCommitment(ben, agreed, { dueAt: new Date(Date.now() - 3_600_000).toISOString() });
    const report = await buildDailyReport(david, { useAssistant: false });
    expect(report.commitments).not.toBeNull();
    expect(report.commitments!.madeToday!.length).toBe(2);
    expect(report.commitments!.overdue!.length).toBe(1);
    const md = commitmentsMarkdown(david.org.slug, report.commitments!).join("\n");
    expect(md).toContain("## Commitments");
    expect(md).toContain("[commitment](/app/company-a/commitments?c=");
    expect(md).toContain("[message](/app/company-a/messages?c=");
    // Ada asked: told it was taken on.
    expect(await adminQuery("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.commitment_accepted'", [id(ada)])).toEqual([{ n: 1 }]);
  });
});

describe("a task stalled a second time gets a re-plan the lead confirms", () => {
  it("the chase asks twice; the second answer suggests a new due date; nothing moves until David confirms", async () => {
    const stalled = (await createTask(david, { projectId: a.projectId, title: "Pricing table", expectedOutput: "Pricing table, done.", assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: 240, dueAt: new Date(Date.now() - 86_400_000).toISOString(), captureRequirement: "none", addToMyDay: false })).id;
    await adminQuery(`SET session_replication_role = replica;
      UPDATE tasks SET created_at = created_at - interval '10 days' WHERE id = '${stalled}';
      UPDATE task_status_history SET occurred_at = occurred_at - interval '10 days' WHERE task_id = '${stalled}';
      SET session_replication_role = origin;`);
    const v = await R.createRoutine(david, { template: "chase_stalled", cadence: { kind: "weekdays" }, time: "16:00", teamIds: null });
    await previewAndEnable(david, v.id);
    await dueSoon(v.id);
    const first = await workerRuns(v.id);
    expect(first.status).toBe("done");
    const [fu1] = await adminQuery<{ id: string }>("SELECT id FROM follow_ups WHERE task_id = $1 ORDER BY created_at", [stalled]);
    expect(["answered", "expired", "declined"]).toContain(await answered(fu1.id));
    expect(await RP.replanForFollowUp(david, fu1.id)).toBeNull();
    // Ben moved it once, five days ago; it stalled again since.
    const c = await addComment(ben, stalled, "Started on the layout");
    await adminQuery(`SET session_replication_role = replica; UPDATE task_comments SET created_at = now() - interval '5 days' WHERE id = '${c.id}'; SET session_replication_role = origin;`);
    await dueSoon(v.id);
    const second = await workerRuns(v.id);
    expect(second.status).toBe("done");
    const ids = (await adminQuery<{ id: string }>("SELECT id FROM follow_ups WHERE task_id = $1 ORDER BY created_at", [stalled])).map((r) => r.id);
    expect(ids).toHaveLength(2);
    const before = (await adminQuery<{ due_at: string }>("SELECT due_at FROM tasks WHERE id = $1", [stalled]))[0].due_at;
    expect(["answered", "expired", "declined"]).toContain(await answered(ids[1]));
    const plan = await RP.replanForFollowUp(david, ids[1]);
    expect(plan).toMatchObject({ status: "proposed", taskId: stalled, canConfirm: true });
    expect((await getFollowUp(david, ids[1]))!.replan).toMatchObject({ id: plan!.id });
    expect(await adminQuery("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.replan'", [id(david)])).toEqual([{ n: 1 }]);
    expect((await adminQuery<{ due_at: string }>("SELECT due_at FROM tasks WHERE id = $1", [stalled]))[0].due_at).toBe(before);
    expect(await RP.replanForFollowUp(ben, ids[1])).toBeNull();
    const done = await RP.confirmReplan(david, plan!.id, {});
    expect(done.status).toBe("confirmed");
    expect((await adminQuery<{ due_at: string }>("SELECT due_at FROM tasks WHERE id = $1", [stalled]))[0].due_at).toBe(plan!.proposedDueAt);
  });
});

describe("Ada's Loose ends routine, through the worker", () => {
  it("runs as her with the built-in rules, keeps what it found privately, and reports it to her alone", async () => {
    const dm = (await import("@/server/services/messaging")).openDirect;
    const direct = await dm(ada, id(ben));
    await sendMessage(ada, { conversationId: direct, body: "I'll send the slides tomorrow" }, { startMention: false });
    await sendMessage(ben, { conversationId: direct, body: "Can you review the budget by Friday?" }, { startMention: false });
    const v = await R.createRoutine(ada, { template: "loose_ends", cadence: { kind: "daily" }, time: "17:30" });
    await previewAndEnable(ada, v.id);
    await dueSoon(v.id);
    const run = await workerRuns(v.id);
    expect(run.status).toBe("done");
    const found = await adminQuery<{ kind: string; source: string; membership_id: string }>("SELECT kind, source, membership_id FROM loose_ends ORDER BY created_at");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((f) => f.membership_id === id(ada) && f.source === "routine")).toBe(true);
    expect(found.map((f) => f.kind)).toEqual(expect.arrayContaining(["promise", "asked_of_me"]));
    expect((await LE.listLooseEnds(ada)).counts.open).toBe(found.length);
    expect((await LE.listLooseEnds(ben)).items).toEqual([]);
    expect((await desktopState(ada)).loops.looseEnds.open).toBe(found.length);
    const out = (await R.getRun(ada, run.id)).output!;
    expect(out.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["promise", "asked_of_me"]));
  });
});
