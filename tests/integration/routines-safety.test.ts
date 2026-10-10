/**
 * Routines: safety, consent and privacy (review, 8 October 2026: phase 7a; fixed the same day). What a routine may do
 * after the person's Enable press, measured against what that press showed them; what arrives for the person while they
 * are quiet; what the workspace's plan allows; who can read the per-person columns; a run a stopped worker left behind;
 * a chase that has already asked about many stalls.
 *
 * Company A (workspace company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Olu and Ben), Olu
 * Adeyemi, Ben Okafor, Ada Nwosu (staff, on Sales). Local test database only (TEST_DATABASE_URL). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { changeRole, createTeam, setTeamMember } from "@/server/services/orgs";
import { createTask } from "@/server/services/tasks";
import { processFollowUpIds } from "@/server/services/follow-ups";
import { runTemplate, type TemplateResult } from "@/server/services/routine-templates";
import { withWorker } from "@/server/db";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { localParts } from "@/server/lib/time";
import * as R from "@/server/services/routines";
import { ROUTINE_WORDS, type RoutineInput, type RoutineView } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const LAGOS = "Africa/Lagos";
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext, ada: OrgContext;
let salesId: string;

const id = (c: OrgContext) => c.membership.id;
const hhmm = (d: Date) => { const p = localParts(d, LAGOS); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

async function enableNew(ctx: OrgContext, input: RoutineInput): Promise<RoutineView> {
  const v = await R.createRoutine(ctx, input);
  const p = await R.previewRoutine(ctx, v.id);
  return R.enableRoutine(ctx, v.id, { consentHash: p.consent.hash });
}

/** One run now, as the worker does it (claim, template as the person, finish). */
async function runNow(routineId: string, now = new Date()): Promise<{ skip: string } | { runId: string; result: TemplateResult; delivery: string }> {
  const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [routineId, now.toISOString()]);
  const c = await R.claimRun({ routineId, dueAt: r.next_run_at, now });
  if ("skip" in c) return { skip: c.skip };
  const result = await runTemplate(c.ctx, c.routine, { mode: "run", runId: c.runId, now, since: c.previousRunAt, timeZone: c.timeZone });
  const done = await R.completeRun(c.runId, result, { now });
  return { runId: c.runId, result, delivery: done.delivery };
}
function ran(r: Awaited<ReturnType<typeof runNow>>) {
  if ("skip" in r) throw new Error(`the run was skipped: ${r.skip}`);
  return r;
}

/** A task for `assignee`, set by `by`, with no progress for a week (or `days`). */
async function stalledTask(by: OrgContext, title: string, assignee: OrgContext, days = 7) {
  const t = (await createTask(by, { projectId: a.projectId, title, expectedOutput: `${title}, done.`, assigneeMembershipId: id(assignee), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
  await adminQuery(`SET session_replication_role = replica;
    UPDATE tasks SET created_at = created_at - interval '${days} days' WHERE id = '${t}';
    UPDATE task_status_history SET occurred_at = occurred_at - interval '${days} days' WHERE task_id = '${t}';
    SET session_replication_role = origin;`);
  return t;
}

const followUpsAbout = (taskId: string) => adminQuery<{ requester_membership_id: string; subject_membership_id: string }>(
  "SELECT requester_membership_id, subject_membership_id FROM follow_ups WHERE task_id = $1", [taskId]);
const routineRow = (routineId: string) => adminQuery<{ enabled: boolean; paused_reason: string | null }>("SELECT enabled, paused_reason FROM routines WHERE id = $1", [routineId]).then((r) => r[0]);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  salesId = (await createTeam(owner, "Sales")).id;
  ada = await joinViaInvitation(mary, await createVerifiedUser("ada@sales.company-a.test", "Ada Nwosu"), "employee", salesId, "EMP-010");
});

describe("a chase acts only on the people its Enable showed", () => {
  it("'the teams I lead': after David takes on Sales, the next run asks nobody, pauses and says why; enabled again, it may", async () => {
    const v = await enableNew(david, { template: "chase_stalled", cadence: { kind: "daily" }, time: "16:00", teamIds: null });
    expect(v.consent!.lines[0]).toContain("Design (Ben Okafor, Olu Adeyemi)");
    expect(v.consent!.lines.join(" ")).not.toMatch(/Sales|Ada/);

    // The owner makes David lead of Sales too (an ordinary team change, nothing about routines).
    await setTeamMember(owner, salesId, id(david), { isManager: true });
    const quote = await stalledTask(owner, "Sales quote for Acme", ada);
    expect(await runNow(v.id)).toEqual({ skip: "consent_changed" });
    expect(await followUpsAbout(quote)).toEqual([]);
    expect(await routineRow(v.id)).toEqual({ enabled: false, paused_reason: "consent_changed" });
    const told = await adminQuery<{ type: string; body: string }>(
      "SELECT type, body FROM notifications WHERE recipient_membership_id = $1 AND resource_id = $2", [id(david), v.id]);
    expect(told).toEqual([{ type: "brenda.routine_failed", body: ROUTINE_WORDS.notifications.coverChanged }]);
    const run = await adminQuery<{ status: string; reason: string }>("SELECT status, reason FROM routine_runs WHERE routine_id = $1", [v.id]);
    expect(run).toEqual([{ status: "skipped", reason: "consent_changed" }]);

    // Previewed and enabled again, the consent names Sales and Ada, and the run asks about her work.
    const again = await R.previewRoutine(david, v.id);
    expect(again.consent.lines[0]).toContain("Sales (Ada Nwosu)");
    await R.enableRoutine(david, v.id, { consentHash: again.consent.hash });
    ran(await runNow(v.id));
    expect(await followUpsAbout(quote)).toEqual([{ requester_membership_id: id(david), subject_membership_id: id(ada) }]);

    // Someone leaving what it covers never needs a new Enable: David no longer leads Sales, and it still runs.
    await setTeamMember(owner, salesId, id(david), { isManager: false });
    ran(await runNow(v.id));
    await R.pauseRoutine(david, v.id);
  });

  it("a named team: someone who joins Design after Enable is not chased; the routine pauses for a new Enable", async () => {
    const v = await enableNew(owner, { template: "chase_stalled", cadence: { kind: "daily" }, time: "16:00", teamIds: [a.teamId] });
    expect(v.consent!.lines[0]).toContain("Design (Ben Okafor, David Lead, Olu Adeyemi)");
    const kemi = await joinViaInvitation(mary, await createVerifiedUser("kemi@company-a.test", "Kemi Bello"), "employee", a.teamId, "EMP-020");
    const t = await stalledTask(owner, "Moodboard", kemi);
    expect(await runNow(v.id)).toEqual({ skip: "consent_changed" });
    expect(await followUpsAbout(t)).toEqual([]);
    expect(await routineRow(v.id)).toEqual({ enabled: false, paused_reason: "consent_changed" });
    // The data a run reads is the consent's too: even a run that got past the claim asks only the people it named.
    const preview = await R.previewRoutine(owner, v.id);
    expect(preview.consent.lines[0]).toContain("Kemi Bello");
  });

  it("someone joining between the preview and Enable: Enable is refused (409) and the preview must be seen again", async () => {
    const v = await R.createRoutine(owner, { template: "chase_stalled", cadence: { kind: "weekdays" }, time: "11:00", teamIds: [a.teamId] });
    const seen = await R.previewRoutine(owner, v.id);
    await joinViaInvitation(mary, await createVerifiedUser("femi@company-a.test", "Femi Ade"), "employee", a.teamId, "EMP-021");
    await expect(R.enableRoutine(owner, v.id, { consentHash: seen.consent.hash })).rejects.toMatchObject({ status: 409, code: "CONSENT_CHANGED" });
    const now = await R.previewRoutine(owner, v.id);
    expect(now.consent.lines[0]).toContain("Femi Ade");
    expect((await R.enableRoutine(owner, v.id, { consentHash: now.consent.hash })).enabled).toBe(true);
    await R.deleteRoutine(owner, v.id);
  });

  it("while David is quiet a chase's answers are not told one by one: one notification once all are in", async () => {
    const chase = await enableNew(david, { template: "chase_stalled", cadence: { kind: "daily" }, time: "16:00", teamIds: null });
    const now = new Date();
    await R.saveQuietHours(david, { enabled: true, start: hhmm(new Date(now.getTime() - 60 * 60_000)), end: hhmm(new Date(now.getTime() + 3 * 60 * 60_000)), days: [0, 1, 2, 3, 4, 5, 6] });
    expect((await withWorker((db) => R.quietStateFor(db, id(david)))).active).toBe(true);

    await stalledTask(david, "Icon set", ben);
    await stalledTask(david, "Landing hero", olu);
    const answersBefore = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.followup_answer'", [id(david)]))[0].n;
    const r = ran(await runNow(chase.id));
    expect(r.delivery).toBe("held");
    const ids = r.result.actions.filter((x) => x.done && x.followUpId).map((x) => x.followUpId!);
    expect(ids.length).toBeGreaterThanOrEqual(2);

    // The worker processes them (followup.process): each subject is asked or answered, then answered at the deadline.
    await processFollowUpIds(ids, { useModel: false });
    const [{ latest }] = await adminQuery<{ latest: string | null }>("SELECT max(deadline_at) AS latest FROM follow_ups WHERE id = ANY($1::uuid[])", [ids]);
    if (latest) await processFollowUpIds(ids, { useModel: false, now: new Date(new Date(latest).getTime() + 60_000) });
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'asking', 'answering')", [ids])).toEqual([]);

    const answers = await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.followup_answer'", [id(david)]);
    expect(answers[0].n - answersBefore).toBe(0);
    const summary = await adminQuery<{ type: string; resource_type: string; href: string; title: string }>(
      "SELECT type, resource_type, href, title FROM notifications WHERE recipient_membership_id = $1 AND resource_id = $2", [id(david), r.runId]);
    expect(summary).toEqual([{ type: "brenda.followup_batch", resource_type: "routine_run", href: `/app/${owner.org.slug}/home/routines/${r.runId}`, title: "Answers are in for “Chase stalled tasks”" }]);
    expect((await adminQuery<{ delivery: string }>("SELECT delivery FROM routine_runs WHERE id = $1", [r.runId]))[0].delivery).toBe("held");
    await R.saveQuietHours(david, { enabled: false });
    await R.pauseRoutine(david, chase.id);
  });

  it("a lead made staff: the chase stops at its next run, is paused and asks nobody", async () => {
    const chase = await enableNew(david, { template: "chase_stalled", cadence: { kind: "daily" }, time: "17:00", teamIds: null });
    const t = await stalledTask(owner, "Brand audit", ben);
    await changeRole(owner, id(david), "employee");
    const before = (await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups WHERE requester_membership_id = $1", [id(david)]))[0].n;
    expect(await runNow(chase.id)).toEqual({ skip: "no_rights" });
    expect((await adminQuery<{ n: number }>("SELECT count(*)::int AS n FROM follow_ups WHERE requester_membership_id = $1", [id(david)]))[0].n).toBe(before);
    expect(await adminQuery("SELECT 1 FROM follow_ups WHERE task_id = $1", [t])).toEqual([]);
    expect(await routineRow(chase.id)).toEqual({ enabled: false, paused_reason: "no_rights" });
    await changeRole(owner, id(david), "manager");
  });
});

describe("the workspace's plan", () => {
  it("with the assistant off, no routine is set up or turned on, and one already on does nothing at its time", async () => {
    const on = await enableNew(owner, { template: "chase_stalled", cadence: { kind: "weekdays" }, time: "10:00", teamIds: [salesId] });
    const draft = await R.createRoutine(owner, { template: "morning_brief", cadence: { kind: "daily" }, time: "09:00" });
    const draftHash = (await R.previewRoutine(owner, draft.id)).consent.hash;
    await adminQuery(`UPDATE organisations SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb) || '{"AI_ASSISTANT": false}'::jsonb WHERE id = $1`, [owner.org.id]);
    try {
      const plan = await withWorker((db) => resolveEntitlements(db, owner.org.id));
      expect(plan.features.AI_ASSISTANT).toBe(false);
      const off = { ...owner, plan };
      await expect(R.createRoutine(off, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" })).rejects.toMatchObject({ status: 402 });
      await expect(R.enableRoutine(off, draft.id, { consentHash: draftHash })).rejects.toMatchObject({ status: 402 });

      const t = await stalledTask(owner, "Renewal pack", ada);
      expect(await runNow(on.id)).toEqual({ skip: "plan" });
      expect(await followUpsAbout(t)).toEqual([]);
      expect(await adminQuery("SELECT status, reason FROM routine_runs WHERE routine_id = $1", [on.id])).toEqual([{ status: "skipped", reason: "plan" }]);
      // It stays on, and runs again once the assistant is back.
      expect(await routineRow(on.id)).toEqual({ enabled: true, paused_reason: null });
      // Pausing and deleting still work while it is off.
      expect((await R.pauseRoutine(off, on.id)).enabled).toBe(false);
      expect(await R.deleteRoutine(off, draft.id)).toEqual({ deleted: true });
    } finally {
      await adminQuery(`UPDATE organisations SET feature_overrides = feature_overrides - 'AI_ASSISTANT' WHERE id = $1`, [owner.org.id]);
    }
  });
});

describe("who reads the per-person columns (0047)", () => {
  it("nobody but the person reads their quiet hours, own time zone or when they first opened Boredroom today", async () => {
    await R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3, 4, 5], timezone: "Europe/London" });
    await R.markOpenerSeen(olu);
    expect(await appQueryAs(ben.user.profileId, "SELECT * FROM assistant_private WHERE membership_id = $1", [id(olu)])).toEqual([]);
    expect(await appQueryAs(ben.user.profileId, "SELECT timezone, quiet_start, opener_seen_at FROM assistant_profiles WHERE membership_id = $1 AND (timezone IS NOT NULL OR quiet_start IS NOT NULL OR opener_seen_at IS NOT NULL)", [id(olu)])).toEqual([]);
    expect(await appQueryAs(olu.user.profileId, "SELECT timezone, quiet_start::text AS s, quiet_end::text AS e, quiet_days, opener_seen_at IS NOT NULL AS seen FROM assistant_private WHERE membership_id = $1", [id(olu)]))
      .toEqual([{ timezone: "Europe/London", s: "22:00:00", e: "07:00:00", quiet_days: [1, 2, 3, 4, 5], seen: true }]);
    expect(await R.quietHoursFor(olu)).toMatchObject({ enabled: true, start: "22:00", end: "07:00", ownTimezone: "Europe/London" });
    expect((await R.openerSeen(olu)).seenToday).toBe(true);
    // The worker still reads them: routines run on the person's clock and wait for their quiet hours.
    expect((await withWorker((db) => R.quietStateFor(db, id(olu)))).ready).toBe(true);
    await R.saveQuietHours(olu, { enabled: false, timezone: null });
  });
});

describe("a run a stopped worker left behind", () => {
  it("is recorded as failed ('interrupted') when its job comes back, and by the purge's sweep otherwise", async () => {
    const v = await enableNew(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: "08:00" });
    const now = new Date();
    const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [v.id, now.toISOString()]);
    const c = await R.claimRun({ routineId: v.id, dueAt: r.next_run_at, now });
    if ("skip" in c) throw new Error(c.skip);
    // The worker dies here; 20 minutes on, the job is reset and runs again.
    await adminQuery("UPDATE routine_runs SET started_at = now() - interval '25 minutes' WHERE id = $1", [c.runId]);
    expect(await R.claimRun({ routineId: v.id, dueAt: r.next_run_at, now: new Date() })).toEqual({ skip: "stale" });
    expect(await adminQuery("SELECT status, reason FROM routine_runs WHERE id = $1", [c.runId])).toEqual([{ status: "failed", reason: "interrupted" }]);

    // One whose job never came back: the sweep.
    const due2 = new Date(Date.now() + 1000);
    await adminQuery("UPDATE routines SET next_run_at = $2 WHERE id = $1", [v.id, due2.toISOString()]);
    const c2 = await R.claimRun({ routineId: v.id, dueAt: due2, now: due2 });
    if ("skip" in c2) throw new Error(c2.skip);
    await adminQuery("UPDATE routine_runs SET started_at = now() - interval '2 hours' WHERE id = $1", [c2.runId]);
    expect((await R.sweepInterruptedRuns()).failed).toBeGreaterThanOrEqual(1);
    expect(await adminQuery("SELECT status, reason FROM routine_runs WHERE id = $1", [c2.runId])).toEqual([{ status: "failed", reason: "interrupted" }]);
    await R.deleteRoutine(olu, v.id);
  });
});

describe("a chase that has already asked about many stalls", () => {
  it("still finds a newer stall behind 101 older ones it asked about, and counts every stall not yet asked", async () => {
    const v = await enableNew(owner, { template: "chase_stalled", cadence: { kind: "daily" }, time: "12:00", teamIds: [salesId] });
    const old = await stalledTask(owner, "Old quote", ada, 9);
    // 101 more as old as it, each already asked about by this routine (its keys recorded).
    await adminQuery(`SET session_replication_role = replica;
      INSERT INTO tasks SELECT (jsonb_populate_record(t, jsonb_build_object('id', gen_random_uuid(), 'title', 'Old quote ' || g))).* FROM tasks t, generate_series(1, 101) g WHERE t.id = '${old}';
      SET session_replication_role = origin;`);
    const copies = await adminQuery<{ id: string; created_at: string }>("SELECT id, created_at FROM tasks WHERE title LIKE 'Old quote %'");
    expect(copies).toHaveLength(101);
    await adminQuery(
      `INSERT INTO routine_reported_items(routine_id, organisation_id, item_key) SELECT $1, $2, k FROM unnest($3::text[]) AS k`,
      [v.id, owner.org.id, copies.map((t) => `chase:${t.id}:${new Date(t.created_at).toISOString()}`)]);
    const newer = await stalledTask(owner, "Newer quote", ada, 6);

    const p = await R.previewRoutine(owner, v.id);
    // Not yet asked about by this routine: "Old quote" itself, "Newer quote", and Ada's two from the tests above.
    expect(p.output.lead).toBe("4 tasks have stalled. It would ask about all of them.");
    const r = ran(await runNow(v.id));
    const asked = r.result.actions.filter((x) => x.done).map((x) => x.taskId);
    expect(asked).toHaveLength(4);
    expect(asked).toEqual(expect.arrayContaining([old, newer]));
    expect(asked.some((t) => copies.some((c) => c.id === t))).toBe(false);
    await R.pauseRoutine(owner, v.id);
  });
});

describe("the built-in helper and routines with the same name (visual review, 8 October 2026)", () => {
  it("names a new one apart from one already there, and pauses the one that is on", async () => {
    const { chatBuiltin } = await import("@/server/services/copilot");
    const paused = await R.createRoutine(ben, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    const r = await chatBuiltin(ben, [{ role: "user", content: "Every Friday at 4pm send me what's still owed" }]);
    expect(r.reply).toContain("You already have **What's still owed (paused)**");
    const card = r.proposals.find((p) => p.kind === "confirm");
    expect(card).toMatchObject({ summary: "Set up “What's still owed 2”, every Friday at 16:00, and turn it on?" });

    // Two with the same name (made in Settings), one on: "pause" can only mean that one.
    const twin = await enableNew(ben, { template: "still_owed", name: "What's still owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    const p = await chatBuiltin(ben, [{ role: "user", content: "pause my what's still owed" }]);
    expect(p.reply).toContain("I can pause **What's still owed**");
    expect(p.proposals.find((x) => x.kind === "confirm")).toMatchObject({ summary: "Pause “What's still owed”?" });
    // Turning on: only the paused one fits.
    const on = await chatBuiltin(ben, [{ role: "user", content: "turn on my what's still owed" }]);
    expect(on.reply).toContain("I can turn on **What's still owed** again");
    // Both paused now: the choice lists each with its state and when it was set up.
    await R.pauseRoutine(ben, twin.id);
    const both = await chatBuiltin(ben, [{ role: "user", content: "delete my what's still owed" }]);
    expect(both.reply).toContain("Which one did you mean?");
    expect(both.reply).toMatch(/every Friday at 16:00, paused, set up \d{1,2} \w{3}/);
    expect(both.reply).toContain("Some have the same name");
    await R.deleteRoutine(ben, paused.id);
    await R.deleteRoutine(ben, twin.id);
  });
});
