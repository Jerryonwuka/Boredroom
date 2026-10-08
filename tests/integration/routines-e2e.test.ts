/**
 * Routines end to end through the worker (owner decision, 8 October 2026: phase 7a; integration, 8 October 2026). The
 * other suites call the services' hooks one by one; this one goes the way a routine really runs: the person sets it up
 * (paused), previews it (nothing sent), enables it with the preview's hash, the worker's scheduler (worker/schedule.ts)
 * queues it at its time in the person's own time zone, the `routine.run` handler (worker/handlers.ts) claims, runs and
 * delivers it (or holds it for quiet hours, then `routine.release` brings the held runs together), and the run is in
 * the person's history. Also through the worker: the Friday roundup with nothing owed stays silent; the afternoon check
 * reports each thing once; a chase is refused without lead rights while the workspace switch is on, allowed when it is
 * off, hands its follow-ups to `followup.process`, and pauses when the switch is turned back on.
 *
 * Company A (Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Olu and Ben), Olu Adeyemi (Max, her own time
 * zone Europe/London), Ben Okafor, and Ada Nwosu (staff, on Sales). Local test database only (TEST_DATABASE_URL,
 * embedded PostgreSQL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam } from "@/server/services/orgs";
import { createTask, updateTask } from "@/server/services/tasks";
import { saveMyAssistant } from "@/server/services/assistant-profile";
import { localParts } from "@/server/lib/time";
import * as R from "@/server/services/routines";
import type { RoutineInput, RoutineView } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const LONDON = "Europe/London";
const JOB = { jobId: "routines-e2e", attempt: 1 };
let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext, ada: OrgContext, newcomer: OrgContext;

const id = (c: OrgContext) => c.membership.id;
const count = async (table: string, where = "true", params: unknown[] = []) =>
  (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n;
const hhmm = (d: Date, tz: string) => { const p = localParts(d, tz); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
const notes = (membershipId: string, type: string) => adminQuery<{ id: string; title: string; body: string | null; href: string | null; resource_id: string | null }>(
  "SELECT id, title, body, href, resource_id FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at, id", [membershipId, type]);
const jobsFor = (type: string, like: string) => adminQuery<{ payload: Record<string, unknown>; dedup_key: string; next_run_at: string }>(
  "SELECT payload, dedup_key, next_run_at FROM jobs WHERE type = $1 AND dedup_key LIKE $2 ORDER BY created_at", [type, like]);

async function worker() {
  const schedule = await import("../../worker/schedule");
  const { handlers } = await import("../../worker/handlers");
  return { schedule, handlers };
}

/** The person's Enable press: the preview's hash. */
async function previewAndEnable(ctx: OrgContext, routineId: string): Promise<RoutineView> {
  const p = await R.previewRoutine(ctx, routineId);
  return R.enableRoutine(ctx, routineId, { consentHash: p.consent.hash });
}

/**
 * The worker at the routine's time: the scheduler (asked at 30 seconds before its next run) queues one `routine.run`
 * job for it, and the handler runs that job. Returns the run row it made.
 */
async function workerRuns(routineId: string) {
  const { schedule, handlers } = await worker();
  const [r] = await adminQuery<{ next_run_at: string }>("SELECT next_run_at FROM routines WHERE id = $1", [routineId]);
  expect(r.next_run_at).not.toBeNull();
  const at = new Date(r.next_run_at);
  const queued = await schedule.scheduleRoutines(new Date(at.getTime() - 30_000));
  expect(queued.queued).toBeGreaterThanOrEqual(1);
  // Asked again before it ran: still one job (deduplicated by routine and time).
  await schedule.scheduleRoutines(new Date(at.getTime() - 15_000));
  const jobs = await jobsFor("routine.run", `routine.run:${routineId}:%`);
  const job = jobs.find((j) => j.dedup_key === `routine.run:${routineId}:${at.toISOString()}`);
  expect(job, "the scheduler queued the routine at its time").toBeDefined();
  expect(jobs.filter((j) => j.dedup_key === job!.dedup_key)).toHaveLength(1);
  expect(new Date(job!.next_run_at).getTime()).toBe(at.getTime());
  await handlers["routine.run"](job!.payload, JOB);
  const [run] = await adminQuery<{ id: string; status: string; delivery: string; held_until: string | null; bundled: boolean; summary: string | null; used_model: boolean }>(
    "SELECT id, status, delivery, held_until, bundled, summary, used_model FROM routine_runs WHERE routine_id = $1 AND due_at = $2", [routineId, at.toISOString()]);
  expect(run, "the handler recorded the run").toBeDefined();
  return { ...run, dueAt: at };
}

/**
 * Brings a routine's next run to a few minutes from now (as if its time had come round), for another run. Each call
 * takes a later minute than the one before, so two runs of one routine never share a due time (the run and the job are
 * once per routine and due time).
 */
let bumps = 0;
async function dueSoon(routineId: string) {
  const at = new Date(Math.ceil((Date.now() + 120_000) / 60_000) * 60_000 + ++bumps * 60_000);
  await adminQuery("UPDATE routines SET next_run_at = $2 WHERE id = $1", [routineId, at.toISOString()]);
}

/** A task of Ben's on Design with no progress for a week. */
let stalled: string;
async function stalledTask(title: string) {
  const t = (await createTask(david, { projectId: a.projectId, title, expectedOutput: `${title}, done.`, assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, captureRequirement: "none", addToMyDay: false })).id;
  await adminQuery(`SET session_replication_role = replica;
    UPDATE tasks SET created_at = created_at - interval '7 days' WHERE id = '${t}';
    UPDATE task_status_history SET occurred_at = occurred_at - interval '7 days' WHERE task_id = '${t}';
    SET session_replication_role = origin;`);
  return t;
}

/** A daily time of day a couple of minutes from now in the zone, so the routine's next run is in the next few minutes. */
const soon = (tz: string) => hhmm(new Date(Date.now() + 120_000), tz);

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  const salesId = (await createTeam(owner, "Sales")).id;
  ada = await joinViaInvitation(a.hrCtx, await createVerifiedUser("ada@sales.company-a.test", "Ada Nwosu"), "employee", salesId, "EMP-010");
  newcomer = await joinViaInvitation(a.hrCtx, await createVerifiedUser("kemi@sales.company-a.test", "Kemi Bello"), "employee", salesId, "EMP-011");
  // Olu keeps her own time zone, not the workspace's.
  await R.saveQuietHours(olu, { enabled: false, timezone: LONDON });
});

describe("a routine from setup to its history, through the worker", () => {
  let owed: string;
  let firstRun: string;

  it("is set up paused, previews without sending anything, and is not scheduled until it is enabled", async () => {
    // Something Olu still owes: a task of hers past its due date.
    const t = await createTask(david, { projectId: a.projectId, title: "Client deck", expectedOutput: "The deck, done.", assigneeMembershipId: id(olu), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, captureRequirement: "none", addToMyDay: false });
    await adminQuery("UPDATE tasks SET due_at = now() - interval '2 days' WHERE id = $1", [t.id]);

    const v = await R.createRoutine(olu, { template: "still_owed", cadence: { kind: "daily" }, time: soon(LONDON), quietWhenEmpty: false });
    owed = v.id;
    expect(v).toMatchObject({ enabled: false, pausedReason: "new", nextRunAt: null, timezone: LONDON });
    const { schedule } = await worker();
    await schedule.scheduleRoutines(new Date(Date.now() + 10 * 60_000));
    expect(await jobsFor("routine.run", `routine.run:${owed}:%`)).toEqual([]);

    const before = await Promise.all(["routine_runs", "notifications", "follow_ups", "jobs"].map((x) => count(x)));
    const p = await R.previewRoutine(olu, owed);
    expect(p.output.empty).toBe(false);
    expect(p.output.sections.find((s) => s.id === "tasks")?.items.some((i) => i.sources.some((s) => s.kind === "task" && s.id === t.id))).toBe(true);
    expect(p.consent.lines).toContain("Nothing goes to anyone else.");
    expect(await Promise.all(["routine_runs", "notifications", "follow_ups", "jobs"].map((x) => count(x)))).toEqual(before);

    const on = await R.enableRoutine(olu, owed, { consentHash: p.consent.hash });
    expect(on).toMatchObject({ enabled: true, pausedReason: null, consent: { lines: p.consent.lines } });
    // Its time is in Olu's own zone (London), a few minutes from now.
    const next = new Date(on.nextRunAt!);
    expect(hhmm(next, LONDON)).toBe(on.time);
    expect(next.getTime() - Date.now()).toBeGreaterThan(0);
    expect(next.getTime() - Date.now()).toBeLessThan(4 * 60_000);
  });

  it("the scheduler queues it at its time and the handler runs and delivers it, then it is in her history", async () => {
    const run = await workerRuns(owed);
    firstRun = run.id;
    expect(run).toMatchObject({ status: "done", delivery: "delivered", used_model: false });
    expect(run.summary).toMatch(/still owed/);
    const [n] = (await notes(id(olu), "brenda.routine")).filter((x) => x.resource_id === run.id);
    expect(n).toMatchObject({ href: `/app/company-a/home/routines/${run.id}` });
    expect(n.title).toMatch(/^What's still owed: /);

    // The next run is tomorrow at the same time in London.
    const v = await R.getRoutine(olu, owed);
    expect(new Date(v.nextRunAt!).getTime() - run.dueAt.getTime()).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(hhmm(new Date(v.nextRunAt!), LONDON)).toBe(v.time);
    expect(v.lastStatus).toBe("done");

    // Her history: the run, light in the list, whole when opened; nobody else's.
    const list = await R.listRuns(olu, { routineId: owed });
    expect(list.runs.map((r) => r.id)).toEqual([run.id]);
    expect(list.runs[0]).toMatchObject({ routineName: "What's still owed", status: "done", delivery: "delivered", output: null });
    const full = await R.getRun(olu, run.id);
    expect(full.output?.sections.length).toBeGreaterThan(0);
    await expect(R.getRun(ben, run.id)).rejects.toMatchObject({ status: 404 });
  });

  it("while she is quiet two runs are held, and arrive as one bundle through the release job when quiet hours end", async () => {
    const brief = (await R.createRoutine(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: soon(LONDON), quietWhenEmpty: false })).id;
    await previewAndEnable(olu, brief);
    await dueSoon(owed);
    // Quiet from an hour ago to an hour from now, in her zone.
    const q = await R.saveQuietHours(olu, { enabled: true, start: hhmm(new Date(Date.now() - 3_600_000), LONDON), end: hhmm(new Date(Date.now() + 3_600_000), LONDON), days: [0, 1, 2, 3, 4, 5, 6] });
    expect(q.state.active).toBe(true);

    const held = [await workerRuns(owed), await workerRuns(brief)];
    for (const h of held) expect(h).toMatchObject({ delivery: "held", held_until: q.state.until });
    expect((await notes(id(olu), "brenda.routine")).filter((n) => held.some((h) => h.id === n.resource_id))).toEqual([]);

    // Still quiet: the sweep queues nothing for her.
    const { schedule, handlers } = await worker();
    await schedule.scheduleRoutineReleases(new Date());
    expect(await jobsFor("routine.release", `routine.release:${id(olu)}:%`)).toEqual([]);

    // Quiet hours turned off: the next sweep queues one release, which delivers both as one notification.
    await R.saveQuietHours(olu, { enabled: false });
    const sweepAt = new Date(Date.now() + 1000);
    expect((await schedule.scheduleRoutineReleases(sweepAt)).queued).toBe(1);
    const [release] = await jobsFor("routine.release", `routine.release:${id(olu)}:%`);
    expect(release.payload).toEqual({ membershipId: id(olu) });
    await handlers["routine.release"](release.payload, JOB);
    expect(await notes(id(olu), "brenda.routine_bundle")).toEqual([expect.objectContaining({
      title: "2 routines ran during quiet hours", body: "What's still owed, Morning brief", href: "/app/company-a/home/routines",
    })]);
    expect(await adminQuery("SELECT DISTINCT delivery, bundled FROM routine_runs WHERE id = ANY($1::uuid[])", [held.map((h) => h.id)]))
      .toEqual([{ delivery: "delivered", bundled: true }]);
    // Her history across routines, newest first, with the first run still there.
    const all = await R.listRuns(olu, {});
    expect(all.runs.map((r) => r.id)).toEqual(expect.arrayContaining([...held.map((h) => h.id), firstRun]));
  });
});

describe("the templates' rules, through the worker", () => {
  it("the Friday roundup with nothing owed stays silent", async () => {
    const v = await R.createRoutine(newcomer, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    await previewAndEnable(newcomer, v.id);
    await dueSoon(v.id);
    const run = await workerRuns(v.id);
    expect(run).toMatchObject({ status: "empty", delivery: "silent" });
    expect(await notes(id(newcomer), "brenda.routine")).toEqual([]);
    // Back on Fridays at 16:00 in the workspace's zone.
    const next = await R.getRoutine(newcomer, v.id);
    expect(localParts(new Date(next.nextRunAt!), "Africa/Lagos")).toMatchObject({ hour: 16, minute: 0 });
    expect(new Date(next.nextRunAt!).getUTCDay()).toBe(5);
  });

  it("the afternoon check reports a thing once: the second run stays silent; a new change is reported again", async () => {
    const blocked = (await createTask(david, { projectId: a.projectId, title: "Pricing page", expectedOutput: "Pricing, done.", assigneeMembershipId: id(ben), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, captureRequirement: "none", addToMyDay: false })).id;
    const version = async () => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [blocked]))[0].version;
    await updateTask(ben, blocked, { expectedVersion: await version(), status: "in_progress" });
    await updateTask(ben, blocked, { expectedVersion: await version(), status: "blocked", reason: "Waiting on Olu for the copy" });

    const v = await R.createRoutine(olu, { template: "afternoon_check", cadence: { kind: "weekdays" }, time: "15:00" });
    await previewAndEnable(olu, v.id);
    await dueSoon(v.id);
    const first = await workerRuns(v.id);
    expect(first).toMatchObject({ status: "done", delivery: "delivered" });
    expect((await R.getRun(olu, first.id)).output?.sections.find((s) => s.id === "blocked_on_you")?.items.some((i) => i.sources.some((s) => s.id === blocked))).toBe(true);

    await dueSoon(v.id);
    const second = await workerRuns(v.id);
    expect(second).toMatchObject({ status: "empty", delivery: "silent" });

    // Unblocked and blocked again: a new status change, so it is news again.
    await updateTask(ben, blocked, { expectedVersion: await version(), status: "in_progress" });
    await updateTask(ben, blocked, { expectedVersion: await version(), status: "blocked", reason: "Olu still has the copy" });
    await dueSoon(v.id);
    const third = await workerRuns(v.id);
    expect(third).toMatchObject({ status: "done", delivery: "delivered" });
  });

  it("a chase needs lead rights while the switch is on; with it off it runs within the follow-up rules; it pauses when the switch is on again", async () => {
    const chase: RoutineInput = { template: "chase_stalled", cadence: { kind: "daily" }, time: "10:00", teamIds: [a.teamId] };
    await expect(R.createRoutine(ada, chase)).rejects.toMatchObject({ status: 403 });

    await R.saveRoutineSettings(owner, { chaseLeadsOnly: false });
    // A chase reads as the person, within their own access: Ada works on the Design project, so she sees its tasks.
    await adminQuery("INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'contributor')", [owner.org.id, a.projectId, id(ada)]);
    const v = await R.createRoutine(ada, chase);
    await previewAndEnable(ada, v.id);
    stalled = await stalledTask("Brand guidelines");

    await dueSoon(v.id);
    const run = await workerRuns(v.id);
    expect(run).toMatchObject({ status: "done", delivery: "delivered" });
    // The routine is allowed; who she may follow up with is still the follow-up rules' call, per person, at each run.
    expect(await count("follow_ups", "requester_membership_id = $1", [id(ada)])).toBe(0);
    const out = (await R.getRun(ada, run.id)).output!;
    expect(out.actions).toEqual([expect.objectContaining({ kind: "follow_up", done: false, taskId: stalled, reason: expect.stringMatching(/You can follow up only on people/) })]);
    expect(out.sections.find((s) => s.id === "not_asked")?.items).toHaveLength(1);

    // The switch on again: the next run is refused, the routine pauses and Ada is told.
    await R.saveRoutineSettings(owner, { chaseLeadsOnly: true });
    await dueSoon(v.id);
    const refused = await workerRuns(v.id);
    expect(refused).toMatchObject({ status: "skipped", delivery: "none" });
    expect(await R.getRoutine(ada, v.id)).toMatchObject({ enabled: false, pausedReason: "no_rights" });
    expect((await notes(id(ada), "brenda.routine_failed")).map((n) => n.body)).toContain("Only team leads can chase other people now.");
  });

  it("David's chase on Design asks Ben's assistant, hands the follow-up to the worker, chases a stall once, and keeps to the daily allowance", async () => {
    const v = await R.createRoutine(david, { template: "chase_stalled", cadence: { kind: "weekdays" }, time: "16:00", teamIds: null });
    await previewAndEnable(david, v.id);
    await dueSoon(v.id);
    const run = await workerRuns(v.id);
    expect(run).toMatchObject({ status: "done", delivery: "delivered" });
    const asked = await adminQuery<{ id: string; requester_membership_id: string; subject_membership_id: string }>(
      "SELECT id, requester_membership_id, subject_membership_id FROM follow_ups WHERE task_id = $1", [stalled]);
    expect(asked).toEqual([expect.objectContaining({ requester_membership_id: id(david), subject_membership_id: id(ben) })]);
    // The follow-ups it asked go to followup.process, as the workspace's collection does.
    const [proc] = await jobsFor("followup.process", `followup.process:routine:${run.id}:%`);
    expect(proc.payload).toEqual({ ids: [asked[0].id] });
    // The same stall is not chased again.
    await dueSoon(v.id);
    const again = await workerRuns(v.id);
    expect(again).toMatchObject({ status: "empty", delivery: "silent" });
    expect(await count("follow_ups", "task_id = $1", [stalled])).toBe(1);

    // David has used his whole day's allowance: a new stall is listed under Not asked, and nobody is asked.
    const [seed] = await adminQuery<{ id: string }>("INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, question, local_date, size) VALUES ($1, $2, 'group', 'Seed', CURRENT_DATE, 30) RETURNING id", [owner.org.id, id(david)]);
    await adminQuery("INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question, status) SELECT $1, $2, $3, $4, NULL, 'Seed', 'cancelled' FROM generate_series(1, 30)", [owner.org.id, seed.id, id(david), id(olu)]);
    const pressKit = await stalledTask("Press kit");
    const before = await count("follow_ups");
    await dueSoon(v.id);
    const capped = await workerRuns(v.id);
    expect(capped).toMatchObject({ status: "done", delivery: "delivered" });
    expect(await count("follow_ups")).toBe(before);
    const out = (await R.getRun(david, capped.id)).output!;
    expect(out.actions.find((x) => x.taskId === pressKit)).toMatchObject({ done: false, reason: expect.stringMatching(/left today/) });
    expect(await jobsFor("followup.process", `followup.process:routine:${capped.id}:%`)).toEqual([]);
  });
});
