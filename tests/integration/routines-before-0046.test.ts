/**
 * Before migration 0046 (owner decision, 8 October 2026: phase 7a): the code ships before the database update (a deploy,
 * the running dev server), so routines and quiet hours are absent and say so, nothing that reads them throws, and what
 * needs no schema works (the opener, Confirm readbacks, "Decisions for you"). Then 0046 is applied twice by hand: no
 * error, the new switches default as specified, and the routines work. The test schema is built from every migration
 * before 0046.
 *
 * Local test database only (TEST_DATABASE_URL, embedded PostgreSQL on localhost). No model.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { assistantProfiles, saveMyAssistant } from "@/server/services/assistant-profile";
import { desktopState } from "@/server/services/desktop";
import { buildDailyReport } from "@/server/services/daily-report";
import { morningOpener } from "@/server/services/opener";
import { runBrendaTool } from "@/server/services/copilot";
import { withUser, withWorker } from "@/server/db";
import { forget0046, schema0046Ready } from "@/server/lib/schema-0046";
import { forget0047, schema0047Ready } from "@/server/lib/schema-0047";
import * as R from "@/server/services/routines";
import { NO_QUIET, ROUTINES_NOT_READY } from "@/lib/routines";
import { scheduleRoutineReleases, scheduleRoutines } from "../../worker/schedule";
import type { OrgContext } from "@/server/lib/api";

delete process.env.ANTHROPIC_API_KEY;

let a: CompanyFixture;
let owner: OrgContext, david: OrgContext, olu: OrgContext;
const id = (c: OrgContext) => c.membership.id;
const MIGRATION = join(process.cwd(), "db", "migrations", "0046_routines.sql");
const MIGRATION_0047 = join(process.cwd(), "db", "migrations", "0047_assistant_private.sql");
const SOME_ID = "11111111-1111-4111-8111-111111111111";

/** As resetTestDatabase, but stopping before 0046. */
async function schemaBefore0046() {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0046").sort()) {
      await c.query("BEGIN");
      await c.query(readFileSync(join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await c.query("COMMIT");
    }
  } finally { await c.end(); }
  await adminQuery("UPDATE plans SET max_users = NULL WHERE code = 'free'");
}

/** The migration's SQL as the runner applies it: one file, one transaction. */
async function apply0046(file = MIGRATION) {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(readFileSync(file, "utf8"));
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally { await c.end(); }
}

beforeAll(async () => {
  await schemaBefore0046();
  forget0046();
  expect(await adminQuery("SELECT to_regclass('public.routines') IS NULL AS missing")).toEqual([{ missing: true }]);
  a = await buildCompany("a", { names: { owner: "Grace Owner", hr: "Mary HR", manager: "David Lead", employee: "Olu Adeyemi", employee2: "Ben Okafor" } });
  owner = a.ownerCtx; david = a.managerCtx; olu = a.employeeCtx;
  await saveMyAssistant(olu, { name: "Max", colour: "blue", visor: "band", eyes: "round" });
});

describe("before 0046 routines and quiet hours are absent and say so", () => {
  it("every change answers 503 NOT_READY", async () => {
    const notReady = { status: 503, code: "NOT_READY", message: ROUTINES_NOT_READY };
    await expect(R.createRoutine(olu, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" })).rejects.toMatchObject(notReady);
    await expect(R.updateRoutine(olu, SOME_ID, { time: "09:00" })).rejects.toMatchObject(notReady);
    await expect(R.pauseRoutine(olu, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(R.deleteRoutine(olu, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(R.enableRoutine(olu, SOME_ID, { consentHash: "a".repeat(64) })).rejects.toMatchObject(notReady);
    await expect(R.previewRoutine(olu, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(R.previewRoutine(olu, { template: "morning_brief", cadence: { kind: "daily" }, time: "09:00" })).rejects.toMatchObject(notReady);
    await expect(R.getRoutine(olu, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(R.getRun(olu, SOME_ID)).rejects.toMatchObject(notReady);
    await expect(R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00" })).rejects.toMatchObject(notReady);
    await expect(R.saveRoutineSettings(owner, { chaseLeadsOnly: false })).rejects.toMatchObject(notReady);
    await expect(R.markOpenerSeen(olu)).rejects.toMatchObject(notReady);
  });

  it("the reads say ready: false and never throw", async () => {
    expect(await R.listRoutines(olu)).toEqual({ ready: false, routines: [], limits: { perPerson: 20 }, chase: { allowed: false, leadsOnly: true, teams: [] } });
    expect(await R.listRuns(olu)).toEqual({ ready: false, runs: [], nextBefore: null });
    expect(await R.listRuns(olu, { routineId: SOME_ID })).toEqual({ ready: false, runs: [], nextBefore: null });
    expect(await R.quietHoursFor(olu)).toEqual({ ready: false, enabled: false, start: null, end: null, days: [], ownTimezone: null, timezone: "Africa/Lagos", state: NO_QUIET });
    expect(await R.routineSettingsFor(owner)).toEqual({ ready: false, chaseLeadsOnly: true });
    expect(await R.chaseTeamsFor(david)).toEqual({ allowed: false, leadsOnly: true, teams: [] });
    expect(await withWorker((db) => R.quietStateFor(db, id(olu)))).toEqual(NO_QUIET);
    expect(await withUser(olu.user.profileId, (db) => R.quietStateFor(db, id(olu)))).toEqual(NO_QUIET);
    expect(await R.openerSeen(olu)).toEqual({ ready: false, seenToday: null, seenAt: null, timeZone: "Africa/Lagos" });
    const profiles = await assistantProfiles(olu);
    expect(profiles.personal.name).toBe("Max");
    expect(profiles.quiet).toBeUndefined();
  });

  it("her routine tools say they need the update", async () => {
    expect((await runBrendaTool(olu, "list_routines", {}, "chat", { act: "read" })).out).toEqual({ error: ROUTINES_NOT_READY });
    const create = await runBrendaTool(olu, "create_routine", { template: "still_owed", cadence: "weekly", days: ["friday"], time: "16:00" }, "chat", { act: "read" });
    expect(create.out).toEqual({ error: ROUTINES_NOT_READY });
    expect(create.proposals).toEqual([]);
  });

  it("the opener works; the daily report has Decisions and no Changed since", async () => {
    const o = await morningOpener(olu, { since: null, firstVisit: null });
    expect(o).toMatchObject({ v: 1, firstVisit: null, counts: expect.any(Array), actions: expect.any(Array) });
    expect(o.actions.length).toBeGreaterThanOrEqual(3);
    const report = await buildDailyReport(david, { useAssistant: false });
    expect(report.decisions).toEqual(expect.objectContaining({ reviews: expect.anything() }));
    expect(report.changes).toBeNull();
    expect(report.snapshot).toBeNull();
  });

  it("the notch: never quiet, no routine runs, the opener there", async () => {
    const s = await desktopState(olu);
    expect(s.quiet).toEqual(NO_QUIET);
    expect(s.routineRuns).toEqual({ ready: false, recent: [] });
    expect(s.opener).toMatchObject({ v: 1 });
    expect(s.assistant.personal.name).toBe("Max");
  });

  it("the worker's routine schedules and hooks return at once", async () => {
    expect(await scheduleRoutines(new Date())).toEqual({ queued: 0 });
    expect(await scheduleRoutineReleases(new Date())).toEqual({ queued: 0 });
    expect(await R.dueRoutines()).toEqual([]);
    expect(await R.heldReleasesDue()).toEqual([]);
    expect(await R.claimRun({ routineId: SOME_ID, dueAt: new Date().toISOString() })).toEqual({ skip: "not_ready" });
    expect(await R.releaseHeldRuns(id(olu))).toEqual({ released: 0, bundled: false, heldUntil: null });
    expect(await R.reportedKeys(SOME_ID, ["request:x"])).toEqual([]);
    expect(await R.pruneRoutineReportedItems()).toEqual({ deleted: 0 });
    await expect(R.failRun(SOME_ID, "error")).resolves.toBeUndefined();
    expect(await adminQuery("SELECT count(*)::int AS n FROM jobs WHERE type LIKE 'routine.%'")).toEqual([{ n: 0 }]);
  });
});

describe("applying 0046", () => {
  it("runs twice without an error, and the defaults are as specified", async () => {
    // A workspace that already has Brenda settings: the new switch is on for it.
    await adminQuery("INSERT INTO brenda_settings(organisation_id) VALUES ($1) ON CONFLICT (organisation_id) DO NOTHING", [owner.org.id]);
    await apply0046();
    await apply0046();
    forget0046();
    expect(await withUser(olu.user.profileId, (db) => schema0046Ready(db))).toBe(true);
    const col = (table: string, column: string) => adminQuery("SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [table, column]);
    expect(await col("brenda_settings", "routines_chase_leads_only")).toEqual([{ column_default: "true", is_nullable: "NO" }]);
    expect(await col("assistant_profiles", "quiet_days")).toEqual([{ column_default: "'{}'::smallint[]", is_nullable: "NO" }]);
    expect(await col("assistant_profiles", "timezone")).toEqual([{ column_default: null, is_nullable: "YES" }]);
    expect(await col("routines", "enabled")).toEqual([{ column_default: "false", is_nullable: "NO" }]);
    expect(await col("routine_runs", "delivery")).toEqual([{ column_default: "'pending'::text", is_nullable: "NO" }]);
    expect(await col("brenda_report_log", "snapshot")).toEqual([{ column_default: null, is_nullable: "YES" }]);
    // Existing rows took the defaults: nobody is quiet, every workspace has "leads only" on.
    expect(await adminQuery("SELECT DISTINCT timezone, quiet_start, quiet_days, opener_seen_at FROM assistant_profiles")).toEqual([{ timezone: null, quiet_start: null, quiet_days: [], opener_seen_at: null }]);
    expect(await adminQuery("SELECT DISTINCT routines_chase_leads_only AS v FROM brenda_settings")).toEqual([{ v: true }]);
    // One of each object, not two.
    expect(await adminQuery(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('assistant_profiles_quiet_check', 'assistant_profiles_timezone_check', 'brenda_report_log_snapshot_check',
      'routines_enabled_check', 'routines_days_check', 'routine_runs_held_check', 'routine_reported_items_key_check')`)).toEqual([{ n: 7 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('routines_updated', 'routines_guard') AND NOT tgisinternal")).toEqual([{ n: 2 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('routines', 'routine_runs', 'routine_reported_items')")).toEqual([{ n: 4 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('routines_due_idx', 'routines_member_idx', 'routine_runs_routine_idx', 'routine_runs_member_idx', 'routine_runs_held_idx', 'routine_reported_items_age_idx')")).toEqual([{ n: 6 }]);
    await expect(adminQuery("UPDATE assistant_profiles SET quiet_start = '22:00' WHERE membership_id = $1", [id(olu)])).rejects.toThrow(/assistant_profiles_quiet_check/);
    await expect(adminQuery("UPDATE assistant_profiles SET timezone = 'Lagos; DROP' WHERE membership_id = $1", [id(olu)])).rejects.toThrow(/assistant_profiles_timezone_check/);

    // And now the routines work.
    expect(await R.routineSettingsFor(owner)).toEqual({ ready: true, chaseLeadsOnly: true });
    const v = await R.createRoutine(olu, { template: "still_owed", cadence: { kind: "weekly", days: [5] }, time: "16:00" });
    expect(v).toMatchObject({ enabled: false, pausedReason: "new" });
    const p = await R.previewRoutine(olu, v.id);
    expect((await R.enableRoutine(olu, v.id, { consentHash: p.consent.hash })).enabled).toBe(true);
    expect(await R.openerSeen(olu)).toEqual({ ready: true, seenToday: false, seenAt: null, timeZone: "Africa/Lagos" });
    expect((await desktopState(olu)).quiet).toEqual({ ready: true, active: false, until: null, nextStart: null });
    expect((await desktopState(olu)).routineRuns).toEqual({ ready: true, recent: [] });
    expect((await buildDailyReport(david, { useAssistant: false })).changes).not.toBeNull();
  });
});

describe("before 0047, then applying it (review, 8 October 2026: the person's own columns move to assistant_private)", () => {
  it("before it, quiet hours, the time zone and the opener mark live on assistant_profiles and work", async () => {
    forget0047();
    expect(await withUser(olu.user.profileId, (db) => schema0047Ready(db))).toBe(false);
    await R.saveQuietHours(olu, { enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3, 4, 5], timezone: "Europe/London" });
    await R.markOpenerSeen(olu);
    expect(await adminQuery("SELECT timezone, quiet_start::text AS s, opener_seen_at IS NOT NULL AS seen FROM assistant_profiles WHERE membership_id = $1", [id(olu)]))
      .toEqual([{ timezone: "Europe/London", s: "22:00:00", seen: true }]);
    expect(await R.quietHoursFor(olu)).toMatchObject({ ready: true, enabled: true, start: "22:00", end: "07:00", ownTimezone: "Europe/London" });
    expect((await assistantProfiles(olu)).quiet?.ready).toBe(true);
  });

  it("applied twice, it moves them (copied, then cleared on assistant_profiles), and the code reads its own table", async () => {
    await apply0046(MIGRATION_0047);
    await apply0046(MIGRATION_0047);
    forget0047();
    expect(await withUser(olu.user.profileId, (db) => schema0047Ready(db))).toBe(true);
    expect(await adminQuery("SELECT timezone, quiet_start::text AS s, quiet_end::text AS e, quiet_days, opener_seen_at IS NOT NULL AS seen FROM assistant_private WHERE membership_id = $1", [id(olu)]))
      .toEqual([{ timezone: "Europe/London", s: "22:00:00", e: "07:00:00", quiet_days: [1, 2, 3, 4, 5], seen: true }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM assistant_profiles WHERE timezone IS NOT NULL OR quiet_start IS NOT NULL OR opener_seen_at IS NOT NULL OR cardinality(quiet_days) > 0"))
      .toEqual([{ n: 0 }]);
    expect(await adminQuery("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'assistant_private'")).toEqual([{ n: 1 }]);
    expect(await R.quietHoursFor(olu)).toMatchObject({ ready: true, enabled: true, start: "22:00", end: "07:00", ownTimezone: "Europe/London" });
    expect((await R.openerSeen(olu)).seenToday).toBe(true);
    // Saved again: only the new table changes.
    await R.saveQuietHours(olu, { enabled: false, timezone: null });
    expect(await adminQuery("SELECT timezone, quiet_start FROM assistant_private WHERE membership_id = $1", [id(olu)])).toEqual([{ timezone: null, quiet_start: null }]);
    expect(await adminQuery("SELECT timezone, quiet_start FROM assistant_profiles WHERE membership_id = $1", [id(olu)])).toEqual([{ timezone: null, quiet_start: null }]);
  });
});
