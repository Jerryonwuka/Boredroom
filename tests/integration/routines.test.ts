/**
 * Routines and quiet hours (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). Everyone can
 * have their own assistant run a built-in routine on a schedule; new routines start paused, the person previews one and
 * enables it (their standing consent for exactly what the preview showed); a chase of other people needs lead rights
 * while the workspace switch is on; runs happen once per routine and time, without a flood after downtime; quiet hours
 * hold deliveries and bring them together when they end; the morning opener knows the first visit of the day; Confirm
 * cards say who receives what.
 *
 * Company A (workspace company-a, Africa/Lagos): Grace Owner, Mary HR, David Lead (leads Design: Olu and Ben), Olu
 * Adeyemi (her assistant is Max), Ben Okafor (kept Brenda), and Ada Nwosu (staff, on Sales). Local test database only
 * (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { resetTestDatabase, adminQuery, appQueryAs } from "../helpers/db";
import { buildCompany, createVerifiedUser, joinViaInvitation, type CompanyFixture } from "@/server/services/fixtures";
import { createTeam } from "@/server/services/orgs";
import { addComment, createTask, quickTodo, updateTask } from "@/server/services/tasks";
import { assistantProfiles, saveMyAssistant } from "@/server/services/assistant-profile";
import { createFollowUps } from "@/server/services/follow-ups";
import { planRequest, sendAssistantItem } from "@/server/services/assistant-items";
import { desktopState } from "@/server/services/desktop";
import { setBrendaSettings } from "@/server/services/brenda";
import { runBrendaTool, type Proposal } from "@/server/services/copilot";
import { runTemplate, type TemplateResult } from "@/server/services/routine-templates";
import { withWorker } from "@/server/db";
import { nextRunAt } from "@/server/lib/routine-time";
import { localDate, localParts, weekdayOf } from "@/server/lib/time";
import * as R from "@/server/services/routines";
import { routineBadge, type RoutineInput, type RoutineOutput, type RoutineView } from "@/lib/routines";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

const LAGOS = "Africa/Lagos";
let a: CompanyFixture;
let owner: OrgContext, mary: OrgContext, david: OrgContext, olu: OrgContext, ben: OrgContext, ada: OrgContext;
let salesId: string;
let owed: string;       // Olu's "What's still owed", every Friday at 16:00
let davidChase: string; // David's chase on Design
let adaChase: string;   // Ada's chase, set up while the switch was off
let someRun: string;    // a run of Olu's

const id = (c: OrgContext) => c.membership.id;
const org = () => a.ownerCtx.org.id;
const impersonated = (c: OrgContext): OrgContext => ({ ...c, user: { ...c.user, impersonation: { id: "x", adminEmail: "admin@boredroom.test" } } });
const confirmOf = (proposals: Proposal[]) => proposals.find((p): p is Extract<Proposal, { kind: "confirm" }> => p.kind === "confirm");
const hhmm = (d: Date) => { const p = localParts(d, LAGOS); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
const section = (o: RoutineOutput, sid: string) => o.sections.find((s) => s.id === sid);
const sourcesOf = (o: RoutineOutput, sid: string) => (section(o, sid)?.items ?? []).flatMap((i) => i.sources);
const count = async (table: string, where = "true", params: unknown[] = []) =>
  (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params))[0].n;
const notifications = (membershipId: string, type: string) => adminQuery<{ id: string; title: string; body: string | null; href: string | null; resource_id: string | null; deduplication_key: string }>(
  "SELECT id, title, body, href, resource_id, deduplication_key FROM notifications WHERE recipient_membership_id = $1 AND type = $2 ORDER BY created_at, id", [membershipId, type]);
const versionOf = async (taskId: string) => (await adminQuery<{ version: number }>("SELECT version FROM tasks WHERE id = $1", [taskId]))[0].version;

/** Saves, previews and enables a routine (the person's Enable press with the preview's hash). */
async function enableNew(ctx: OrgContext, input: RoutineInput): Promise<RoutineView> {
  const v = await R.createRoutine(ctx, input);
  const p = await R.previewRoutine(ctx, v.id);
  return R.enableRoutine(ctx, v.id, { consentHash: p.consent.hash });
}

/**
 * One run now, as the worker does it (B.3.2): due now, claimed, the template run as the person, finished. The handler
 * itself is the brain's (worker/handlers.ts); this is the same sequence.
 */
async function runNow(routineId: string, now = new Date()): Promise<{ skip: string } | { runId: string; result: TemplateResult; delivery: string }> {
  const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [routineId, now.toISOString()]);
  const c = await R.claimRun({ routineId, dueAt: r.next_run_at, now });
  if ("skip" in c) return { skip: c.skip };
  const result = await runTemplate(c.ctx, c.routine, { mode: "run", runId: c.runId, now, since: c.previousRunAt });
  const done = await R.completeRun(c.runId, result, { now });
  return { runId: c.runId, result, delivery: done.delivery };
}
function ran(r: Awaited<ReturnType<typeof runNow>>) {
  if ("skip" in r) throw new Error(`the run was skipped: ${r.skip}`);
  return r;
}

/** Moves tasks, their status changes and comments a week back (triggers off for the move). */
async function backdate(taskIds: string[], by = "7 days") {
  const list = taskIds.map((t) => `'${t}'`).join(", ");
  await adminQuery(`SET session_replication_role = replica;
    UPDATE tasks SET created_at = created_at - interval '${by}' WHERE id IN (${list});
    UPDATE task_status_history SET occurred_at = occurred_at - interval '${by}' WHERE task_id IN (${list});
    UPDATE task_comments SET created_at = created_at - interval '${by}' WHERE task_id IN (${list});
    SET session_replication_role = origin;`);
}
async function task(ctx: OrgContext, title: string, assignee: OrgContext) {
  return (await createTask(ctx, { projectId: a.projectId, title, expectedOutput: `${title}, done.`, assigneeMembershipId: id(assignee), reviewerMembershipId: id(david), category: "work", priority: "normal", estimateMinutes: null, dueAt: null, addToMyDay: false })).id;
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; mary = a.hrCtx; david = a.managerCtx; olu = a.employeeCtx; ben = a.employee2Ctx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
  salesId = (await createTeam(owner, "Sales")).id;
  ada = await joinViaInvitation(mary, await createVerifiedUser("ada@sales.company-a.test", "Ada Nwosu"), "employee", salesId, "EMP-010");
});

// ---- 1. Setting one up ------------------------------------------------------------------------------------------------------

describe("a routine, from setup to on", () => {
  it("starts paused, with no next run, and is audited with its template only", async () => {
    const v = await R.createRoutine(olu, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    expect(v).toMatchObject({
      template: "still_owed", name: "What's still owed", enabled: false, pausedReason: "new", nextRunAt: null, quietWhenEmpty: true,
      timezone: LAGOS, scheduleWords: "Every Friday at 16:00", consent: null, teams: [], params: {}, cadence: { kind: "weekly", days: [5] }, time: "16:00",
    });
    expect(await adminQuery("SELECT next_run_at, enabled, paused_reason FROM routines WHERE id = $1", [v.id])).toEqual([{ next_run_at: null, enabled: false, paused_reason: "new" }]);
    expect(await adminQuery("SELECT action, metadata FROM audit_events WHERE subject_id = $1", [v.id])).toEqual([{ action: "routine.created", metadata: { template: "still_owed" } }]);
    expect(await adminQuery("SELECT summary, detail->>'personalSummary' AS mine FROM brenda_actions WHERE membership_id = $1 AND tool = 'routine'", [id(olu)]))
      .toEqual([{ summary: "Set up a routine", mine: "Set up “What's still owed”" }]);
    owed = v.id;
    expect(routineBadge(v)).toEqual({ label: "Paused", tone: "neutral" });
  });

  it("a preview shows what it would send and what Enable consents to, and writes nothing", async () => {
    const before = await Promise.all(["routine_runs", "routine_reported_items", "notifications", "audit_events", "brenda_actions", "follow_ups"].map((t) => count(t)));
    const p = await R.previewRoutine(olu, owed);
    expect(p.output).toMatchObject({ v: 1, title: "What's still owed" });
    expect(p.consent.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.consent.hash).toBe(R.consentHash({ template: "still_owed", params: {} }));
    expect(p.consent.lines).toEqual([
      // Phase 7b (owner decision, 8 October 2026): the roundup also lists loose ends and overdue commitments. The lines are
      // not in the consent hash, so routines already on stay on.
      "Send you what's still owed: follow-ups, messages between assistants, overdue or blocked tasks, assignments nobody picked up, your loose ends and overdue commitments.",
      "Stay quiet when there's nothing.",
      "Nothing goes to anyone else.",
    ]);
    // A draft previews the same way, unsaved.
    const draft = await R.previewRoutine(olu, { template: "morning_brief", cadence: { kind: "weekdays" }, time: "09:00" });
    expect(draft.output.title).toBe("Morning brief");
    const after = await Promise.all(["routine_runs", "routine_reported_items", "notifications", "audit_events", "brenda_actions", "follow_ups"].map((t) => count(t)));
    expect(after).toEqual(before);
  });

  it("Enable with the preview's hash turns it on for next Friday 16:00 in Lagos; a wrong hash is refused", async () => {
    await expect(R.enableRoutine(olu, owed, { consentHash: "0".repeat(64) })).rejects.toMatchObject({ status: 409, code: "CONSENT_CHANGED", message: "The routine changed since its preview. Preview it again." });
    const p = await R.previewRoutine(olu, owed);
    const expected = nextRunAt({ kind: "weekly", days: [5] }, "16:00", LAGOS, new Date()).toISOString();
    const v = await R.enableRoutine(olu, owed, { consentHash: p.consent.hash });
    expect(v).toMatchObject({ enabled: true, pausedReason: null, nextRunAt: expected, consent: { lines: p.consent.lines } });
    expect(weekdayOf(localDate(v.nextRunAt!, LAGOS))).toBe(5);
    expect(localParts(new Date(v.nextRunAt!), LAGOS)).toMatchObject({ hour: 16, minute: 0 });
    expect(routineBadge(v)).toEqual({ label: "On", tone: "success" });
    expect(await adminQuery("SELECT consent->>'hash' AS hash, failures FROM routines WHERE id = $1", [owed])).toEqual([{ hash: p.consent.hash, failures: 0 }]);
  });

  it("changing the time keeps it on and moves the next run", async () => {
    const v = await R.updateRoutine(olu, owed, { time: "17:30" });
    expect(v).toMatchObject({ enabled: true, time: "17:30", scheduleWords: "Every Friday at 17:30" });
    expect(localParts(new Date(v.nextRunAt!), LAGOS)).toMatchObject({ hour: 17, minute: 30 });
    expect(weekdayOf(localDate(v.nextRunAt!, LAGOS))).toBe(5);
    expect((await R.updateRoutine(olu, owed, { name: "Friday roundup" })).name).toBe("Friday roundup");
    expect((await R.listRoutines(olu)).routines.map((r) => r.name)).toEqual(["Friday roundup"]);
  });

  it("someone signed in as Olu can't change her routines", async () => {
    await expect(R.updateRoutine(impersonated(olu), owed, { time: "09:00" })).rejects.toMatchObject({ status: 403 });
    await expect(R.createRoutine(impersonated(olu), { template: "morning_brief", cadence: { kind: "daily" }, time: "09:00" })).rejects.toMatchObject({ status: 403 });
    await expect(R.pauseRoutine(impersonated(olu), owed)).rejects.toMatchObject({ status: 403 });
    await expect(R.deleteRoutine(impersonated(olu), owed)).rejects.toMatchObject({ status: 403 });
    await expect(R.saveQuietHours(impersonated(olu), { enabled: false })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses what is not a routine", async () => {
    await expect(R.createRoutine(olu, { template: "still_owed", cadence: { kind: "weekly", days: [] }, time: "16:00" })).rejects.toMatchObject({ status: 422 });
    await expect(R.createRoutine(olu, { template: "still_owed", cadence: { kind: "daily" }, time: "4pm" })).rejects.toMatchObject({ status: 422, fieldErrors: { time: ["Use a 24-hour time such as 16:00."] } });
    await expect(R.createRoutine(olu, { template: "chase_everyone" as never, cadence: { kind: "daily" }, time: "16:00" })).rejects.toMatchObject({ status: 422 });
    await expect(R.getRoutine(olu, "not-an-id")).rejects.toMatchObject({ status: 404 });
  });

  it("David's chase on Design: the consent names the people; changing its teams turns it off until he enables it again", async () => {
    const c = await R.createRoutine(david, { template: "chase_stalled", cadence: { kind: "weekly", days: [5] }, time: "16:00", teamIds: [a.teamId] });
    expect(c).toMatchObject({ name: "Chase stalled tasks", params: { teamIds: [a.teamId] }, teams: [{ id: a.teamId, name: "Design" }], pausedReason: "new" });
    const p = await R.previewRoutine(david, c.id);
    expect(p.consent.lines).toEqual([
      "Each time, ask the assistants of people on Design (Ben Okafor, Olu Adeyemi) about their tasks with no progress for 2 working days: at most 10 a run, within your daily follow-up limit.",
      "Their assistant answers from their work, or asks them once. Nothing on their tasks changes.",
      "Send you who was asked.",
    ]);
    await R.enableRoutine(david, c.id, { consentHash: p.consent.hash });
    // The same teams named again changes nothing; "the teams I lead" is a different consent.
    expect((await R.updateRoutine(david, c.id, { teamIds: [a.teamId] })).enabled).toBe(true);
    const changed = await R.updateRoutine(david, c.id, { teamIds: null });
    expect(changed).toMatchObject({ enabled: false, pausedReason: "consent_changed", consent: null, nextRunAt: null, params: { teamIds: null }, teams: [{ id: a.teamId, name: "Design" }] });
    expect(routineBadge(changed)).toEqual({ label: "Needs you", tone: "warning" });
    await expect(R.enableRoutine(david, c.id, { consentHash: p.consent.hash })).rejects.toMatchObject({ status: 409, code: "CONSENT_CHANGED" });
    davidChase = c.id;
  });

  it("pause keeps the consent; delete stops it and keeps its runs readable", async () => {
    const brief = await enableNew(olu, { template: "morning_brief", cadence: { kind: "weekdays" }, time: "09:00", quietWhenEmpty: false });
    const paused = await R.pauseRoutine(olu, brief.id);
    expect(paused).toMatchObject({ enabled: false, pausedReason: "person", nextRunAt: null, consent: { lines: brief.consent!.lines } });
    const again = await R.enableRoutine(olu, brief.id, { consentHash: (await R.previewRoutine(olu, brief.id)).consent.hash });
    expect(again.enabled).toBe(true);
    const run = ran(await runNow(brief.id));
    someRun = run.runId;
    expect((await R.listRuns(olu, { routineId: brief.id })).runs.map((r) => r.id)).toEqual([run.runId]);

    expect(await R.deleteRoutine(olu, brief.id)).toEqual({ deleted: true });
    expect(await R.deleteRoutine(olu, brief.id)).toEqual({ deleted: true });
    expect((await R.listRoutines(olu)).routines.map((r) => r.id)).not.toContain(brief.id);
    await expect(R.getRoutine(olu, brief.id)).rejects.toMatchObject({ status: 404 });
    await expect(R.updateRoutine(olu, brief.id, { time: "10:00" })).rejects.toMatchObject({ status: 404 });
    expect(await adminQuery("SELECT enabled, next_run_at, deleted_at IS NOT NULL AS deleted FROM routines WHERE id = $1", [brief.id])).toEqual([{ enabled: false, next_run_at: null, deleted: true }]);
    const history = await R.listRuns(olu, { routineId: brief.id });
    expect(history).toMatchObject({ ready: true, runs: [{ id: run.runId, routineName: "Morning brief", template: "morning_brief", output: null, href: `/app/company-a/home/routines/${run.runId}` }], nextBefore: null });
    const one = await R.getRun(olu, run.runId);
    expect(one.output).toEqual(run.result.output);
    expect((await R.listRuns(olu)).runs.map((r) => r.id)).toContain(run.runId);
  });

  it("keeps at most 20 a person", async () => {
    for (let i = 0; i < 20; i++) await R.createRoutine(mary, { template: "morning_brief", cadence: { kind: "daily" }, time: "08:00", name: `Brief ${i + 1}` });
    await expect(R.createRoutine(mary, { template: "morning_brief", cadence: { kind: "daily" }, time: "08:00" })).rejects.toMatchObject({ status: 409, code: "ROUTINE_LIMIT" });
    const list = await R.listRoutines(mary);
    expect(list).toMatchObject({ ready: true, limits: { perPerson: 20 } });
    await R.deleteRoutine(mary, list.routines[0].id);
    expect((await R.createRoutine(mary, { template: "still_owed", cadence: { kind: "daily" }, time: "08:00" })).name).toBe("What's still owed");
  });
});

// ---- 2. Only the person -------------------------------------------------------------------------------------------------------

describe("row-level security", () => {
  it("Ben can't read or change Olu's routines or runs", async () => {
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM routines WHERE id = $1", [owed])).toEqual([]);
    expect(await appQueryAs(ben.user.profileId, "UPDATE routines SET name = 'Mine now' WHERE id = $1 RETURNING id", [owed])).toEqual([]);
    expect(await appQueryAs(ben.user.profileId, "SELECT id FROM routine_runs WHERE membership_id = $1", [id(olu)])).toEqual([]);
    expect(await appQueryAs(olu.user.profileId, "SELECT id FROM routines WHERE id = $1", [owed])).toHaveLength(1);
    expect(await appQueryAs(olu.user.profileId, "SELECT id FROM routine_runs WHERE id = $1", [someRun])).toHaveLength(1);
    await expect(R.getRoutine(ben, owed)).rejects.toMatchObject({ status: 404, message: "That routine isn't one of yours." });
    await expect(R.updateRoutine(ben, owed, { name: "Mine now" })).rejects.toMatchObject({ status: 404 });
    await expect(R.previewRoutine(ben, owed)).rejects.toMatchObject({ status: 404 });
    await expect(R.getRun(ben, someRun)).rejects.toMatchObject({ status: 404 });
    await expect(R.listRuns(ben, { routineId: owed })).rejects.toMatchObject({ status: 404 });
    expect((await adminQuery<{ name: string }>("SELECT name FROM routines WHERE id = $1", [owed]))[0].name).toBe("Friday roundup");
  });

  it("nobody writes runs or reported items as a person, and nobody deletes a routine", async () => {
    await expect(appQueryAs(olu.user.profileId, "INSERT INTO routine_runs(organisation_id, routine_id, membership_id, due_at) VALUES ($1, $2, $3, now())", [org(), owed, id(olu)])).rejects.toThrow(/row-level security/);
    await expect(appQueryAs(olu.user.profileId, "INSERT INTO routine_reported_items(routine_id, organisation_id, item_key) VALUES ($1, $2, 'x')", [owed, org()])).rejects.toThrow(/row-level security/);
    expect(await appQueryAs(olu.user.profileId, "UPDATE routine_runs SET status = 'done' WHERE membership_id = $1 RETURNING id", [id(olu)])).toEqual([]);
    expect(await appQueryAs(olu.user.profileId, "SELECT * FROM routine_reported_items")).toEqual([]);
    await expect(appQueryAs(olu.user.profileId, "DELETE FROM routines WHERE id = $1", [owed])).rejects.toThrow(/permission denied/);
    await expect(appQueryAs(olu.user.profileId, "DELETE FROM routine_runs WHERE id = $1", [someRun])).rejects.toThrow(/permission denied/);
  });

  it("whose routine it is and what it is never change; on needs a consent", async () => {
    await expect(appQueryAs(olu.user.profileId, "UPDATE routines SET template = 'morning_brief' WHERE id = $1", [owed])).rejects.toThrow(/ROUTINE_FIXED/);
    await expect(adminQuery("UPDATE routines SET membership_id = $2 WHERE id = $1", [owed, id(ben)])).rejects.toThrow(/ROUTINE_FIXED/);
    await expect(adminQuery("UPDATE routines SET consent = NULL WHERE id = $1", [owed])).rejects.toThrow(/routines_enabled_check/);
    await expect(adminQuery("UPDATE routines SET next_run_at = NULL WHERE id = $1", [owed])).rejects.toThrow(/routines_enabled_check/);
    const [deleted] = await adminQuery<{ id: string }>("SELECT id FROM routines WHERE deleted_at IS NOT NULL AND membership_id = $1 LIMIT 1", [id(olu)]);
    await expect(adminQuery("UPDATE routines SET deleted_at = NULL WHERE id = $1", [deleted.id])).rejects.toThrow(/ROUTINE_FIXED/);
  });
});

// ---- 3. Who may chase other people ---------------------------------------------------------------------------------------------

describe("lead rights", () => {
  const chase = (teamIds: string[] | null): RoutineInput => ({ template: "chase_stalled", cadence: { kind: "daily" }, time: "10:00", teamIds });

  it("switch on (the default): Ada can't; David only for Design; the owner for any team", async () => {
    expect(await R.routineSettingsFor(ben)).toEqual({ ready: true, chaseLeadsOnly: true });
    await expect(R.createRoutine(ada, chase([a.teamId]))).rejects.toMatchObject({ status: 403, message: "Only team leads, the owner and HR can schedule routines that chase other people." });
    await expect(R.previewRoutine(ada, chase([a.teamId]))).rejects.toMatchObject({ status: 403 });
    await expect(R.createRoutine(david, chase([salesId]))).rejects.toMatchObject({ status: 403 });
    await expect(R.createRoutine(david, chase([a.teamId, salesId]))).rejects.toMatchObject({ status: 403 });
    expect((await R.createRoutine(owner, chase([salesId]))).teams).toEqual([{ id: salesId, name: "Sales" }]);
    await expect(R.createRoutine(owner, chase(null))).rejects.toMatchObject({ status: 422, message: "Name a team to chase." });
    await expect(R.createRoutine(owner, chase([crypto.randomUUID()]))).rejects.toMatchObject({ status: 422, message: "One of those teams is no longer there. Pick the teams again." });
    // Routines about yourself never need rights.
    expect((await R.createRoutine(ada, { template: "afternoon_check", cadence: { kind: "weekdays" }, time: "15:00" })).enabled).toBe(false);
    expect(await R.chaseTeamsFor(ada)).toEqual({ allowed: false, leadsOnly: true, teams: [] });
    expect(await R.chaseTeamsFor(david)).toEqual({ allowed: true, leadsOnly: true, teams: [{ id: a.teamId, name: "Design", lead: true }] });
    expect((await R.chaseTeamsFor(owner)).teams.map((t) => [t.name, t.lead])).toEqual([["Design", false], ["Sales", false]]);
  });

  it("switch off: Ada may chase a named team; only the owner and HR change the switch", async () => {
    await expect(R.saveRoutineSettings(ada, { chaseLeadsOnly: false })).rejects.toMatchObject({ status: 403 });
    await expect(R.saveRoutineSettings(david, { chaseLeadsOnly: false })).rejects.toMatchObject({ status: 403 });
    await expect(R.saveRoutineSettings(impersonated(owner), { chaseLeadsOnly: false })).rejects.toMatchObject({ status: 403 });
    expect(await R.saveRoutineSettings(owner, { chaseLeadsOnly: false })).toEqual({ ready: true, chaseLeadsOnly: false });
    expect(await adminQuery("SELECT summary FROM brenda_actions WHERE tool = 'settings' AND membership_id = $1", [id(owner)])).toContainEqual({ summary: "Routines that chase other people: anyone" });
    expect(await R.chaseTeamsFor(ada)).toMatchObject({ allowed: true, leadsOnly: false });
    const v = await enableNew(ada, chase([a.teamId]));
    expect(v).toMatchObject({ enabled: true, teams: [{ id: a.teamId, name: "Design" }] });
    await expect(R.createRoutine(ada, chase(null))).rejects.toMatchObject({ status: 422, message: "Name a team to chase." });
    adaChase = v.id;
  });

  it("turned on again, Ada's chase pauses at its next run and she is told", async () => {
    expect(await R.saveRoutineSettings(mary, { chaseLeadsOnly: true })).toEqual({ ready: true, chaseLeadsOnly: true });
    // Nothing changes until it runs.
    expect((await R.getRoutine(ada, adaChase)).enabled).toBe(true);
    expect(await runNow(adaChase)).toEqual({ skip: "no_rights" });
    expect(await adminQuery("SELECT enabled, paused_reason, next_run_at FROM routines WHERE id = $1", [adaChase])).toEqual([{ enabled: false, paused_reason: "no_rights", next_run_at: null }]);
    expect(await adminQuery("SELECT status, reason, delivery, finished_at IS NOT NULL AS finished FROM routine_runs WHERE routine_id = $1", [adaChase]))
      .toEqual([{ status: "skipped", reason: "no_rights", delivery: "none", finished: true }]);
    expect(await notifications(id(ada), "brenda.routine_failed")).toEqual([expect.objectContaining({
      title: "“Chase stalled tasks” is paused", body: "Only team leads can chase other people now.", href: "/app/company-a/settings?section=assistant#routines", resource_id: adaChase,
    })]);
    expect(routineBadge(await R.getRoutine(ada, adaChase))).toEqual({ label: "Needs you", tone: "warning" });
    // No follow-up was made.
    expect(await count("follow_ups", "requester_membership_id = $1", [id(ada)])).toBe(0);
  });
});

// ---- 4. The scheduler's hooks ------------------------------------------------------------------------------------------------

describe("runs", () => {
  it("one run per routine and time, however often it is claimed", async () => {
    const due = new Date(Date.now() - 30_000).toISOString();
    await adminQuery("UPDATE routines SET next_run_at = $2 WHERE id = $1", [owed, due]);
    const listed = (await R.dueRoutines({ now: new Date() })).find((r) => r.id === owed);
    expect(listed).toEqual({ id: owed, dueAt: due, next_run_at: due });
    const first = await R.claimRun({ routineId: owed, dueAt: listed!.dueAt });
    if ("skip" in first) throw new Error(first.skip);
    expect(first.ctx.user.sessionId).toBe("routine");
    expect(first.ctx.membership.id).toBe(id(olu));
    expect(first.routine).toMatchObject({ id: owed, template: "still_owed", name: "Friday roundup", time: "17:30", enabled: true });
    expect(first.previousRunAt).toBeNull();
    expect(await R.claimRun({ routineId: owed, dueAt: listed!.dueAt })).toEqual({ skip: "stale" });
    expect(await count("routine_runs", "routine_id = $1 AND due_at = $2", [owed, due])).toBe(1);
    const [r] = await adminQuery<{ next_run_at: string; last_run_at: string | null }>("SELECT next_run_at, last_run_at FROM routines WHERE id = $1", [owed]);
    expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(r.last_run_at).not.toBeNull();
    expect((await R.dueRoutines({ now: new Date() })).map((x) => x.id)).not.toContain(owed);

    const result = await runTemplate(first.ctx, first.routine, { mode: "run", runId: first.runId, since: first.previousRunAt });
    const done = await R.completeRun(first.runId, result);
    expect(["delivered", "silent"]).toContain(done.delivery);
    // Finishing it again changes nothing.
    expect(await R.completeRun(first.runId, result)).toEqual(done);
    expect(await adminQuery("SELECT status, used_model, finished_at IS NOT NULL AS finished FROM routine_runs WHERE id = $1", [first.runId]))
      .toEqual([{ status: result.empty ? "empty" : "done", used_model: false, finished: true }]);
  });

  it("a job for a time the routine no longer has is stale", async () => {
    expect(await R.claimRun({ routineId: owed, dueAt: new Date(Date.now() - 86_400_000).toISOString() })).toEqual({ skip: "stale" });
    expect(await R.claimRun({ routineId: "not-a-routine", dueAt: new Date().toISOString() })).toEqual({ skip: "stale" });
    expect(await R.claimRun({ routineId: owed, dueAt: "yesterday" })).toEqual({ skip: "stale" });
  });

  it("three days down: one 'missed' row and the next run in the future, no flood", async () => {
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await adminQuery("UPDATE routines SET next_run_at = $2 WHERE id = $1", [owed, due]);
    expect((await R.dueRoutines({ now: new Date() })).filter((x) => x.id === owed)).toHaveLength(1);
    expect(await R.claimRun({ routineId: owed, dueAt: due })).toEqual({ skip: "missed" });
    expect(await adminQuery("SELECT status, reason, delivery FROM routine_runs WHERE routine_id = $1 AND due_at = $2", [owed, due])).toEqual([{ status: "skipped", reason: "missed", delivery: "none" }]);
    const [r] = await adminQuery<{ next_run_at: string; enabled: boolean }>("SELECT next_run_at, enabled FROM routines WHERE id = $1", [owed]);
    expect(r.enabled).toBe(true);
    expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect((await R.dueRoutines({ now: new Date() })).map((x) => x.id)).not.toContain(owed);
    expect(await count("routine_runs", "routine_id = $1 AND reason = 'missed'", [owed])).toBe(1);
  });

  it("three failures in a row pause it; the person is told, and the error's words are never kept", async () => {
    const check = await enableNew(olu, { template: "afternoon_check", cadence: { kind: "daily" }, time: "15:00" });
    for (let i = 0; i < 3; i++) {
      const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [check.id, new Date(Date.now() - 1000 * (i + 1)).toISOString()]);
      const c = await R.claimRun({ routineId: check.id, dueAt: r.next_run_at });
      if ("skip" in c) throw new Error(c.skip);
      await R.failRun(c.runId, "error", "boom: secret project name");
      if (i < 2) expect((await R.getRoutine(olu, check.id)).enabled).toBe(true);
    }
    expect(await adminQuery("SELECT enabled, paused_reason, failures, last_status FROM routines WHERE id = $1", [check.id])).toEqual([{ enabled: false, paused_reason: "failing", failures: 3, last_status: "failed" }]);
    expect(await adminQuery("SELECT DISTINCT status, reason, delivery FROM routine_runs WHERE routine_id = $1", [check.id])).toEqual([{ status: "failed", reason: "error", delivery: "none" }]);
    expect(await count("routine_runs", "routine_id = $1 AND (output::text LIKE '%boom%' OR summary LIKE '%boom%' OR reason LIKE '%boom%')", [check.id])).toBe(0);
    expect((await notifications(id(olu), "brenda.routine_failed")).map((n) => [n.title, n.body])).toEqual([
      ["“Afternoon check” couldn't run", "Something went wrong. It will try again at its next time."],
      ["“Afternoon check” is paused", "It failed 3 times in a row."],
    ]);
    expect((await R.getRoutine(olu, check.id)).pausedReason).toBe("failing");
  });
});

// ---- 5. The templates, end to end -------------------------------------------------------------------------------------------------

describe("templates", () => {
  let request: string;        // Ben's request to Olu
  let followUp: string;       // David's open follow-up to Ben
  let sentRequest: string;    // David's request to Ben
  let check: string;          // Olu's afternoon check

  it("morning brief: Olu's overdue task and Ben's request, each with its source", async () => {
    await adminQuery("UPDATE tasks SET due_at = now() - interval '1 day' WHERE id = $1", [a.taskIds.homepage]);
    const plan = await planRequest(ben, { to: "Olu Adeyemi", request: { kind: "add_todo", title: "Pricing review" } });
    if (!plan.ok) throw new Error(plan.error);
    request = (await sendAssistantItem(ben, { kind: "request", recipientMembershipId: id(olu), payload: plan.payload })).id;
    const p = await R.previewRoutine(olu, { template: "morning_brief", cadence: { kind: "weekdays" }, time: "09:00" });
    expect(p.output.empty).toBe(false);
    expect(sourcesOf(p.output, "overdue")).toContainEqual({ kind: "task", id: a.taskIds.homepage });
    expect(section(p.output, "requests")?.items).toContainEqual(expect.objectContaining({ text: expect.stringMatching(/^Ben asks you to accept: /), sources: [{ kind: "assistant_item", id: request }] }));
    expect(p.output.lead).toMatch(/^\d+ things? (is|are) waiting on you\.$/);
  });

  it("what's still owed: David's open follow-up, his request, overdue and blocked tasks, an assignment nobody picked up", async () => {
    await updateTask(ben, a.taskIds.second, { expectedVersion: await versionOf(a.taskIds.second), status: "in_progress" });
    await updateTask(ben, a.taskIds.second, { expectedVersion: await versionOf(a.taskIds.second), status: "blocked", reason: "Waiting on Olu for the copy" });
    followUp = (await createFollowUps(david, { subjectMembershipIds: [id(ben)], taskId: a.taskIds.second, question: "Where are you on the pricing copy?" })).created[0].id;
    const plan = await planRequest(david, { to: "Ben Okafor", request: { kind: "add_todo", title: "Check the pricing table" } });
    if (!plan.ok) throw new Error(plan.error);
    sentRequest = (await sendAssistantItem(david, { kind: "request", recipientMembershipId: id(ben), payload: plan.payload })).id;
    await adminQuery("UPDATE tasks SET created_at = now() - interval '2 days' WHERE id = $1", [a.taskIds.meeting]);

    const v = await enableNew(david, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    const run = ran(await runNow(v.id));
    const o = run.result.output;
    expect(o).toMatchObject({ title: "What's still owed", empty: false });
    expect(sourcesOf(o, "follow_ups")).toContainEqual({ kind: "follow_up", id: followUp });
    expect(sourcesOf(o, "sent")).toContainEqual({ kind: "assistant_item", id: sentRequest });
    expect(sourcesOf(o, "tasks")).toEqual(expect.arrayContaining([{ kind: "task", id: a.taskIds.homepage }, { kind: "task", id: a.taskIds.second }]));
    expect(sourcesOf(o, "not_picked_up")).toContainEqual({ kind: "task", id: a.taskIds.meeting });
    expect(run.delivery).toBe("delivered");
    const [n] = await notifications(id(david), "brenda.routine");
    expect(n).toMatchObject({ title: `What's still owed: ${o.lead}`, href: `/app/company-a/home/routines/${run.runId}`, resource_id: run.runId, deduplication_key: `routine.run:${run.runId}` });
    expect(n.body?.length ?? 0).toBeLessThanOrEqual(300);
    const view = await R.getRun(david, run.runId);
    expect(view).toMatchObject({ status: "done", delivery: "delivered", summary: o.lead, routineName: "What's still owed", output: o });
    expect(await adminQuery("SELECT last_status, failures FROM routines WHERE id = $1", [v.id])).toEqual([{ last_status: "done", failures: 0 }]);
  });

  it("what's still owed with nothing to say stays quiet", async () => {
    const v = await enableNew(ada, { template: "still_owed", cadence: { kind: "daily" }, time: "16:00" });
    const run = ran(await runNow(v.id));
    expect(run.result.empty).toBe(true);
    expect(run.delivery).toBe("silent");
    expect(await adminQuery("SELECT status, delivery FROM routine_runs WHERE id = $1", [run.runId])).toEqual([{ status: "empty", delivery: "silent" }]);
    expect(await notifications(id(ada), "brenda.routine")).toEqual([]);
  });

  it("afternoon check: a blocked task naming Olu and a request, each reported once; a new status change is reported again", async () => {
    check = (await enableNew(olu, { template: "afternoon_check", cadence: { kind: "daily" }, time: "15:00" })).id;
    const one = ran(await runNow(check));
    expect(sourcesOf(one.result.output, "blocked_on_you")).toEqual(expect.arrayContaining([{ kind: "task", id: a.taskIds.second }, { kind: "assistant_item", id: request }]));
    expect(one.delivery).toBe("delivered");
    const keys = (await adminQuery<{ item_key: string }>("SELECT item_key FROM routine_reported_items WHERE routine_id = $1", [check])).map((k) => k.item_key);
    expect(keys).toContain(`request:${request}`);
    expect(keys.some((k) => k.startsWith(`blocked:${a.taskIds.second}:`))).toBe(true);
    expect(await R.reportedKeys(check, [`request:${request}`, "request:nothing"])).toEqual([`request:${request}`]);

    const two = ran(await runNow(check, new Date(Date.now() + 1000)));
    expect(two.result.empty).toBe(true);
    expect(two.delivery).toBe("silent");

    await updateTask(ben, a.taskIds.second, { expectedVersion: await versionOf(a.taskIds.second), status: "in_progress" });
    await updateTask(ben, a.taskIds.second, { expectedVersion: await versionOf(a.taskIds.second), status: "blocked", reason: "Still waiting on Olu" });
    const three = ran(await runNow(check, new Date(Date.now() + 2000)));
    expect(sourcesOf(three.result.output, "blocked_on_you")).toEqual([{ kind: "task", id: a.taskIds.second }]);
    expect(three.result.output.sections.flatMap((s) => s.items).some((i) => i.sources.some((s) => s.id === request))).toBe(false);
  });

  it("chase stalled: David's assistant asks about Ben's stalled task; a task with a comment yesterday and Olu's own to-do are left alone; the preview writes nothing", async () => {
    const stalled = await task(david, "Brand guidelines", ben);
    const commented = await task(david, "Icon set", olu);
    const own = (await quickTodo(olu, { title: "Tidy my notes" })).id;
    await backdate([stalled, commented, own]);
    await addComment(olu, commented, "Halfway there");
    await adminQuery("UPDATE task_comments SET created_at = now() - interval '1 day' WHERE task_id = $1", [commented]);

    const before = await Promise.all(["follow_ups", "routine_reported_items", "audit_events", "routine_runs", "notifications"].map((t) => count(t)));
    const p = await R.previewRoutine(david, davidChase);
    expect(p.output.actions).toContainEqual(expect.objectContaining({ kind: "follow_up", done: false, taskId: stalled, text: "Would ask Ben's Brenda about “Brand guidelines”" }));
    expect(p.output.actions.map((x) => x.taskId)).not.toContain(commented);
    expect(p.output.actions.map((x) => x.taskId)).not.toContain(own);
    expect(await Promise.all(["follow_ups", "routine_reported_items", "audit_events", "routine_runs", "notifications"].map((t) => count(t)))).toEqual(before);

    await R.enableRoutine(david, davidChase, { consentHash: p.consent.hash });
    const run = ran(await runNow(davidChase));
    expect(await adminQuery("SELECT requester_membership_id, subject_membership_id FROM follow_ups WHERE task_id = $1", [stalled])).toEqual([{ requester_membership_id: id(david), subject_membership_id: id(ben) }]);
    expect(await count("follow_ups", "task_id = ANY($1::uuid[])", [[commented, own]])).toBe(0);
    const asked = run.result.actions.find((x) => x.taskId === stalled);
    expect(asked).toMatchObject({ done: true, followUpId: expect.any(String), subjectMembershipId: id(ben) });
    expect(sourcesOf(run.result.output, "asked")).toEqual(expect.arrayContaining([{ kind: "task", id: stalled }, { kind: "follow_up", id: asked!.followUpId }]));
    expect(run.delivery).toBe("delivered");
    expect((await adminQuery<{ item_key: string }>("SELECT item_key FROM routine_reported_items WHERE routine_id = $1", [davidChase])).map((k) => k.item_key))
      .toEqual([expect.stringMatching(new RegExp(`^chase:${stalled}:`))]);
    // The same stall is never chased twice.
    const again = ran(await runNow(davidChase, new Date(Date.now() + 1000)));
    expect(again.result.actions.map((x) => x.taskId)).not.toContain(stalled);
  });

  it("past the daily follow-up allowance, the chase says why under Not asked and asks nobody", async () => {
    const [seed] = await adminQuery<{ id: string }>("INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, question, local_date, size) VALUES ($1, $2, 'group', 'Seed', CURRENT_DATE, 30) RETURNING id", [org(), id(david)]);
    await adminQuery("INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, task_id, question, status) SELECT $1, $2, $3, $4, NULL, 'Seed', 'cancelled' FROM generate_series(1, 30)", [org(), seed.id, id(david), id(olu)]);
    const pressKit = await task(david, "Press kit", ben);
    await backdate([pressKit]);
    const before = await count("follow_ups");
    const run = ran(await runNow(davidChase, new Date(Date.now() + 2000)));
    expect(await count("follow_ups")).toBe(before);
    const record = run.result.actions.find((x) => x.taskId === pressKit);
    expect(record).toMatchObject({ done: false, reason: expect.stringMatching(/left today/) });
    expect((section(run.result.output, "not_asked")?.items ?? []).some((i) => i.sources.some((s) => s.id === pressKit))).toBe(true);
    // Not recorded as reported: it is asked again once the allowance allows.
    expect(await count("routine_reported_items", "routine_id = $1 AND item_key LIKE $2", [davidChase, `chase:${pressKit}:%`])).toBe(0);
  });
});

// ---- 6. Quiet hours ---------------------------------------------------------------------------------------------------------------

describe("quiet hours", () => {
  let brief: string;
  let roundup: string;
  const quietNow = () => R.saveQuietHours(olu, { enabled: true, start: hhmm(new Date(Date.now() - 3_600_000)), end: hhmm(new Date(Date.now() + 3_600_000)), days: [0, 1, 2, 3, 4, 5, 6] });

  it("saves the person's hours and zone; an unknown zone is refused", async () => {
    expect(await R.quietHoursFor(olu)).toMatchObject({ ready: true, enabled: false, start: null, end: null, ownTimezone: null, timezone: LAGOS, state: { ready: true, active: false } });
    await expect(R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00", timezone: "Mars/Olympus" })).rejects.toMatchObject({ status: 400, message: "Pick a time zone from the list." });
    await expect(R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "22:00" })).rejects.toMatchObject({ status: 422 });
    await expect(R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00", days: [] })).rejects.toMatchObject({ status: 422, message: "Pick at least one day." });
    const night = await R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00", timezone: "Europe/London" });
    expect(night).toMatchObject({ ready: true, enabled: true, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6], ownTimezone: "Europe/London", timezone: "Europe/London" });
    // Her routines run on her own clock now: the roundup's next run is Friday 17:30 in London.
    const v = await R.getRoutine(olu, owed);
    expect(v.timezone).toBe("Europe/London");
    expect(localParts(new Date(v.nextRunAt!), "Europe/London")).toMatchObject({ hour: 17, minute: 30 });
    expect((await R.saveQuietHours(olu, { enabled: false, timezone: null })).timezone).toBe(LAGOS);
    expect(localParts(new Date((await R.getRoutine(olu, owed)).nextRunAt!), LAGOS)).toMatchObject({ hour: 17, minute: 30 });
  });

  it("while Olu is quiet a run is held, and stays held while she still is; other notices still reach the bell", async () => {
    brief = (await enableNew(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: "07:00", quietWhenEmpty: false })).id;
    roundup = (await enableNew(olu, { template: "still_owed", cadence: { kind: "daily" }, time: "16:00", quietWhenEmpty: false })).id;
    const q = await quietNow();
    expect(q.state).toMatchObject({ ready: true, active: true, until: expect.any(String) });
    expect(await withWorker((db) => R.quietStateFor(db, id(olu)))).toEqual(q.state);
    expect((await assistantProfiles(olu)).quiet).toMatchObject({ ready: true, active: true });
    expect((await desktopState(olu)).quiet).toMatchObject({ ready: true, active: true, until: q.state.until });

    const one = ran(await runNow(brief));
    expect(one.delivery).toBe("held");
    expect(await adminQuery("SELECT delivery, held_until, delivered_at FROM routine_runs WHERE id = $1", [one.runId])).toEqual([{ delivery: "held", held_until: q.state.until, delivered_at: null }]);
    expect((await notifications(id(olu), "brenda.routine")).filter((n) => n.resource_id === one.runId)).toEqual([]);
    expect(await R.releaseHeldRuns(id(olu))).toEqual({ released: 0, bundled: false, heldUntil: q.state.until });
    expect(await count("routine_runs", "id = $1 AND delivery = 'held'", [one.runId])).toBe(1);

    // A notice that is not a delivery is written now, quiet or not (the notch does not pop it while she is quiet).
    const failing = await enableNew(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: "06:00", name: "Early brief" });
    const [r] = await adminQuery<{ next_run_at: string }>("UPDATE routines SET next_run_at = $2 WHERE id = $1 RETURNING next_run_at", [failing.id, new Date().toISOString()]);
    const c = await R.claimRun({ routineId: failing.id, dueAt: r.next_run_at });
    if ("skip" in c) throw new Error(c.skip);
    await R.failRun(c.runId, "error");
    expect((await notifications(id(olu), "brenda.routine_failed")).map((n) => n.title)).toContain("“Early brief” couldn't run");
  });

  it("two held runs arrive as one bundle when quiet hours end", async () => {
    const two = ran(await runNow(roundup));
    expect(two.delivery).toBe("held");
    const held = await adminQuery<{ id: string }>("SELECT id FROM routine_runs WHERE membership_id = $1 AND delivery = 'held' ORDER BY started_at", [id(olu)]);
    expect(held).toHaveLength(2);
    expect((await R.saveQuietHours(olu, { enabled: false })).state.active).toBe(false);
    expect(await count("routine_runs", "membership_id = $1 AND delivery = 'held' AND held_until <= now()", [id(olu)])).toBe(2);
    expect(await withWorker((db) => R.quietStateFor(db, id(olu)))).toEqual({ ready: true, active: false, until: null, nextStart: null });
    expect(await R.heldReleasesDue(new Date(Date.now() + 1000))).toContainEqual({ membershipId: id(olu) });

    expect(await R.releaseHeldRuns(id(olu))).toEqual({ released: 2, bundled: true, heldUntil: null });
    const bundles = await notifications(id(olu), "brenda.routine_bundle");
    expect(bundles).toEqual([expect.objectContaining({ title: "2 routines ran during quiet hours", body: "Morning brief, What's still owed", href: "/app/company-a/home/routines" })]);
    expect(await adminQuery("SELECT DISTINCT delivery, bundled, held_until FROM routine_runs WHERE id = ANY($1::uuid[])", [held.map((h) => h.id)])).toEqual([{ delivery: "delivered", bundled: true, held_until: null }]);
    expect(await R.releaseHeldRuns(id(olu))).toEqual({ released: 0, bundled: false, heldUntil: null });

    // The notch's routine card has their lines, each brought by the bundle.
    const s = await desktopState(olu);
    expect(s.routineRuns.ready).toBe(true);
    const cards = s.routineRuns.recent.filter((x) => held.some((h) => h.id === x.id));
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toMatchObject({ notificationId: bundles[0].id, href: `/app/company-a/home/routines/${card.id}` });
      expect(card.lines.length).toBeGreaterThan(0);
      expect(card.lines.length).toBeLessThanOrEqual(5);
    }
  });

  it("one held run arrives as its own notification", async () => {
    await quietNow();
    const one = ran(await runNow(brief, new Date(Date.now() + 1000)));
    expect(one.delivery).toBe("held");
    await R.saveQuietHours(olu, { enabled: false });
    expect(await R.releaseHeldRuns(id(olu))).toEqual({ released: 1, bundled: false, heldUntil: null });
    expect((await notifications(id(olu), "brenda.routine")).filter((n) => n.resource_id === one.runId)).toEqual([
      expect.objectContaining({ deduplication_key: `routine.run:${one.runId}`, href: `/app/company-a/home/routines/${one.runId}` }),
    ]);
    expect(await count("notifications", "recipient_membership_id = $1 AND type = 'brenda.routine_bundle'", [id(olu)])).toBe(1);
  });

  it("the purge keeps 30 days of reported items", async () => {
    await adminQuery("UPDATE routine_reported_items SET reported_at = now() - interval '31 days' WHERE item_key LIKE 'request:%'");
    const before = await count("routine_reported_items");
    const pruned = await R.pruneRoutineReportedItems();
    expect(pruned.deleted).toBeGreaterThan(0);
    expect(await count("routine_reported_items")).toBe(before - pruned.deleted);
    expect(await count("routine_reported_items", "reported_at < now() - interval '30 days'")).toBe(0);
  });
});

// ---- 7. The morning opener's first visit ------------------------------------------------------------------------------------------

describe("the morning opener", () => {
  it("first visit of the day, then seen; never marked by someone signed in as her", async () => {
    expect(await R.openerSeen(olu)).toEqual({ ready: true, seenToday: false, seenAt: null, timeZone: "Africa/Lagos" });
    await expect(R.markOpenerSeen(impersonated(olu))).rejects.toMatchObject({ status: 403 });
    expect((await R.openerSeen(olu)).seenToday).toBe(false);
    const m = await R.markOpenerSeen(olu);
    expect(await R.openerSeen(olu)).toEqual({ ready: true, seenToday: true, seenAt: m.seenAt, timeZone: "Africa/Lagos" });
    await adminQuery("UPDATE assistant_private SET opener_seen_at = now() - interval '1 day' WHERE membership_id = $1", [id(olu)]);
    expect((await R.openerSeen(olu)).seenToday).toBe(false);
    // Someone with no profile row yet gets one.
    expect((await R.markOpenerSeen(mary)).seenAt).toEqual(expect.any(String));
  });

  it("the notch carries the opener's counts, without the lists behind them", async () => {
    const s = await desktopState(olu);
    expect(s.opener).toMatchObject({ v: 1, counts: expect.any(Array), actions: expect.any(Array) });
    expect(s.opener && "detail" in s.opener).toBe(false);
    expect(s.opener?.counts.find((c) => c.key === "overdue")?.value).toBeGreaterThanOrEqual(1);
    expect(s.opener?.actions.length).toBeGreaterThanOrEqual(3);
  });
});

// ---- 8. Confirm readback (brain's cards; checked here end to end) -----------------------------------------------------------------

describe("Confirm cards say who receives what", () => {
  it("a team channel with its count, each assistant asked, each reader of a report note", async () => {
    const m = await runBrendaTool(olu, "send_message", { to: "#Design", body: "The draft is up" }, "chat", { act: "read" });
    expect(confirmOf(m.proposals)?.readback?.to[0]).toBe("#Design, a team channel of 3 people");
    // The owner asks (David has used today's follow-ups above).
    const f = await runBrendaTool(owner, "follow_up", { people: ["Olu Adeyemi", "Ben Okafor"], question: "Where are you this week?" }, "chat", { act: "read", start: false });
    const to = confirmOf(f.proposals)?.readback?.to ?? [];
    expect(to).toHaveLength(2);
    expect(to.join("\n")).toMatch(/Ben's Brenda/);
    expect(to.join("\n")).toMatch(/Olu's Max/);
    // The report goes out at 23:59 here, so today's notes are still open (as the report-notes tests do).
    await setBrendaSettings(owner, { dailyReportTime: "23:59", dailyReportEnabled: true });
    const n = await runBrendaTool(olu, "add_report_note", { body: "Shipping on Friday" }, "chat", { act: "read" });
    const readers = confirmOf(n.proposals)?.readback?.to ?? [];
    expect(readers.join("\n")).toMatch(/David Lead/);
    expect(readers.join("\n")).toMatch(/Grace Owner/);
    // Nothing ran.
    expect(await count("messages", "body = 'The draft is up'")).toBe(0);
  });
});

// ---- 9. Someone who left -------------------------------------------------------------------------------------------------------------

describe("a member who is gone", () => {
  it("their routine stops at its next run", async () => {
    const v = await enableNew(ben, { template: "morning_brief", cadence: { kind: "daily" }, time: "08:00" });
    await adminQuery("UPDATE memberships SET status = 'revoked', revoked_at = now() WHERE id = $1", [id(ben)]);
    try {
      expect(await runNow(v.id)).toEqual({ skip: "member_gone" });
      expect(await adminQuery("SELECT enabled, paused_reason, next_run_at FROM routines WHERE id = $1", [v.id])).toEqual([{ enabled: false, paused_reason: "member_gone", next_run_at: null }]);
      expect(await adminQuery("SELECT status, reason FROM routine_runs WHERE routine_id = $1", [v.id])).toEqual([{ status: "skipped", reason: "member_gone" }]);
    } finally {
      await adminQuery("UPDATE memberships SET status = 'active', revoked_at = NULL WHERE id = $1", [id(ben)]);
    }
  });

  it("the consent hash covers what a routine does to others, nothing else", () => {
    const h = (o: object) => createHash("sha256").update(JSON.stringify(o)).digest("hex");
    expect(R.consentHash({ template: "chase_stalled", params: { teamIds: [a.teamId] } })).toBe(h({ v: 1, template: "chase_stalled", params: { teamIds: [a.teamId] }, caps: { chasePerRun: 10 } }));
    expect(R.consentHash({ template: "morning_brief", params: { teamIds: [a.teamId] } })).toBe(h({ v: 1, template: "morning_brief", params: { teamIds: null }, caps: { chasePerRun: 10 } }));
  });
});
