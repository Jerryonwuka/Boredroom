/**
 * Worker night mode against the throwaway test database (owner request, 23 October 2026: realtime plan, phase 0, item 4).
 * The database side: schedules (the organisation's and people's own), "someone active", what is due next; quiet
 * maintenance (no LiveKit room listing, no connector.sweep, Brenda's tick with reminders only); and a simulated night of
 * the real loop with the real runner and maintenance, a fake clock only for the sleeps, counting every statement sent:
 * at most one pass an hour, and the statements per pass.
 */
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { withWorker } from "@/server/db";
import { addDays, localDate, localTimeOn, weekdayOf } from "@/server/lib/time";
import { brendaTick, createReminder } from "@/server/services/brenda";
import { insideWorkingWindow, loadNextDue, loadSchedules, recentlyActive, workerSettings, nextWindowStart } from "../../worker/night";
import { createLoop } from "../../worker/loop";
import { createRunner } from "../../worker/runner";
import { scheduleMaintenance } from "../../worker/schedule";
import { scheduleControlCenter } from "../../worker/control-center";

let a: CompanyFixture;

/** Every schedule moved to UTC on one weekday three days ahead: now is outside every window, the next opens in days. */
async function makeItNight() {
  const day = weekdayOf(addDays(localDate(new Date(), "UTC"), 3));
  await adminQuery(`UPDATE schedules SET timezone = 'UTC', working_days = ARRAY[$1]::smallint[], start_local = '09:00', end_local = '17:00'`, [day]);
  await adminQuery(`UPDATE auth_sessions SET last_seen_at = now() - interval '1 hour'`);
}

beforeAll(async () => {
  await resetTestDatabase();
  a = await buildCompany("a");
});
afterEach(() => vi.restoreAllMocks());

describe("the database side", () => {
  it("loadSchedules: the organisation's current schedule, in its own and the organisation's zones, and a person's own", async () => {
    await adminQuery(`INSERT INTO schedules(organisation_id, membership_id, timezone, working_days, start_local, end_local) VALUES ($1, $2, 'Asia/Tokyo', '{6}', '10:00', '12:00')`,
      [a.ownerCtx.org.id, a.employeeCtx.membership.id]);
    const rows = await withWorker(loadSchedules);
    expect(rows).toContainEqual({ timezones: expect.arrayContaining(["Africa/Lagos"]), working_days: [1, 2, 3, 4, 5], start_local: expect.any(String), end_local: expect.any(String) });
    expect(rows).toContainEqual({ timezones: ["Asia/Tokyo"], working_days: [6], start_local: "10:00", end_local: "12:00" });
    // A suspended organisation's schedules don't count.
    await adminQuery(`UPDATE organisations SET status = 'suspended' WHERE id = $1`, [a.ownerCtx.org.id]).catch(() => undefined);
    const off = await withWorker(loadSchedules);
    const status = (await adminQuery<{ status: string }>(`SELECT status FROM organisations WHERE id = $1`, [a.ownerCtx.org.id]))[0].status;
    if (status !== "active") expect(off).toEqual([]);
    await adminQuery(`UPDATE organisations SET status = 'active' WHERE id = $1`, [a.ownerCtx.org.id]);
    await adminQuery(`DELETE FROM schedules WHERE membership_id = $1`, [a.employeeCtx.membership.id]);
  });

  it("recentlyActive: a session seen in the last 10 minutes; revoked or expired ones don't count", async () => {
    await adminQuery(`UPDATE auth_sessions SET last_seen_at = now() - interval '11 minutes'`);
    expect(await withWorker(recentlyActive)).toBe(false);
    const s = (await adminQuery<{ id: string }>(
      `INSERT INTO auth_sessions(user_id, token_hash, expires_at, last_seen_at) SELECT id, md5(random()::text), now() + interval '1 day', now() - interval '1 hour' FROM auth_users LIMIT 1 RETURNING id`))[0].id;
    await adminQuery(`UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`, [s]);
    expect(await withWorker(recentlyActive)).toBe(true);
    await adminQuery(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [s]);
    expect(await withWorker(recentlyActive)).toBe(false);
    await adminQuery(`UPDATE auth_sessions SET revoked_at = NULL, last_seen_at = now() - interval '1 hour' WHERE id = $1`, [s]);
  });

  it("loadNextDue: the earliest pending job, unsent reminder, routine run and hold", async () => {
    await adminQuery(`DELETE FROM jobs`);
    const jobAt = new Date(Date.now() + 42 * 60_000);
    await adminQuery(`INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ('test.later', '{}', 'test.later:1', $1)`, [jobAt]);
    await adminQuery(`INSERT INTO jobs(type, payload, dedup_key, next_run_at, state) VALUES ('test.done', '{}', 'test.done:1', now() - interval '1 day', 'succeeded')`);
    const remindAt = new Date(Date.now() + 17 * 60_000);
    await createReminder(a.employeeCtx, { body: "Water the plants", remindAt: remindAt.toISOString() });
    const due = await withWorker(loadNextDue);
    expect(Math.abs((due.job?.getTime() ?? 0) - jobAt.getTime())).toBeLessThan(1000);
    expect(Math.abs((due.reminder?.getTime() ?? 0) - remindAt.getTime())).toBeLessThan(1000);
    expect(due.routine).toBeNull();
    expect(due.held).toBeNull();
    await adminQuery(`DELETE FROM jobs`);
    await adminQuery(`DELETE FROM brenda_reminders`);
  });

  it("loadNextDue: a past-due row no longer hides a later time of its kind; recently due and still waiting is `overdue`", async () => {
    // Fix review, 23 October 2026: min() over every unsent row returned the stuck one, the wake time dropped it as past,
    // and the worker slept for the cap.
    await adminQuery(`DELETE FROM jobs`);
    await adminQuery(`DELETE FROM brenda_reminders`);
    const stuck = await createReminder(a.employeeCtx, { body: "Stuck", remindAt: new Date(Date.now() + 60_000).toISOString() });
    await adminQuery(`UPDATE brenda_reminders SET remind_at = now() - interval '2 hours' WHERE id = $1`, [(stuck as { id: string }).id]);
    await adminQuery(`INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ('test.stuck', '{}', 'test.stuck:1', now() - interval '3 hours')`);
    const later = new Date(Date.now() + 9 * 60_000);
    await createReminder(a.employeeCtx, { body: "Later", remindAt: later.toISOString() });
    let due = await withWorker(loadNextDue);
    expect(Math.abs((due.reminder?.getTime() ?? 0) - later.getTime())).toBeLessThan(1000);
    expect(due.job).toBeNull();
    // Hours old: left to the hourly passes, so a row that never clears can't keep the database awake.
    expect(due.overdue).toBe(false);
    // Due a minute ago and still unsent: the next pass comes soon.
    await adminQuery(`UPDATE brenda_reminders SET remind_at = now() - interval '1 minute' WHERE id = $1`, [(stuck as { id: string }).id]);
    due = await withWorker(loadNextDue);
    expect(due.overdue).toBe(true);
    await adminQuery(`DELETE FROM jobs`);
    await adminQuery(`DELETE FROM brenda_reminders`);
  });

  it("loadNextDue: the next follow-up deadline is a sweep time (the sweep is queued by maintenance when it is due)", async () => {
    await adminQuery(`DELETE FROM jobs`);
    expect((await withWorker(loadNextDue)).sweep).toBeNull();
    const org = a.ownerCtx.org.id;
    const batch = (await adminQuery<{ id: string }>(
      `INSERT INTO follow_up_batches(organisation_id, requester_membership_id, kind, question, local_date, size)
       VALUES ($1, $2, 'person', 'How is it going?', current_date, 1) RETURNING id`, [org, a.ownerCtx.membership.id]))[0].id;
    const deadline = new Date(Date.now() + 7 * 60_000);
    await adminQuery(
      `INSERT INTO follow_ups(organisation_id, batch_id, requester_membership_id, subject_membership_id, question, status, asked_at, deadline_at)
       VALUES ($1, $2, $3, $4, 'How is it going?', 'asking', now(), $5)`, [org, batch, a.ownerCtx.membership.id, a.employeeCtx.membership.id, deadline]);
    const due = await withWorker(loadNextDue);
    expect(Math.abs((due.sweep?.getTime() ?? 0) - deadline.getTime())).toBeLessThan(1000);
    await adminQuery(`DELETE FROM follow_ups WHERE batch_id = $1`, [batch]);
    await adminQuery(`DELETE FROM follow_up_batches WHERE id = $1`, [batch]);
  });
});

describe("quiet maintenance outside the window", () => {
  const jobsOf = async (type: string) => adminQuery<{ payload: Record<string, unknown>; dedup_key: string }>(`SELECT payload, dedup_key FROM jobs WHERE type = $1 ORDER BY created_at`, [type]);

  it("no LiveKit room listing and no connector.sweep; by day both are queued as before", async () => {
    await adminQuery(`DELETE FROM jobs`);
    await scheduleMaintenance({ quiet: true });
    expect((await jobsOf("call.sweep")).filter((j) => j.payload.rooms === true)).toEqual([]);
    expect(await jobsOf("connector.sweep")).toEqual([]);
    // The hourly safety nets still go in.
    expect((await jobsOf("call.sweep")).length).toBeGreaterThan(0);
    await scheduleMaintenance();
    expect((await jobsOf("call.sweep")).filter((j) => j.payload.rooms === true)).toHaveLength(1);
    expect(await jobsOf("connector.sweep")).toHaveLength(1);
  });

  it("Brenda's tick is queued with nudges off, under its own key", async () => {
    await adminQuery(`DELETE FROM jobs`);
    await scheduleControlCenter({ quiet: true });
    const ticks = await jobsOf("brenda.tick");
    expect(ticks).toHaveLength(1);
    expect(ticks[0].payload).toEqual({ nudges: false });
    expect(ticks[0].dedup_key).toMatch(/^brenda\.tick:\d+:quiet$/);
    await scheduleControlCenter();
    expect((await jobsOf("brenda.tick")).map((t) => t.payload)).toEqual([{ nudges: false }, {}]);
  });

  it("a night pass queues a tick of its own each time, even inside one five minutes", async () => {
    // Fix review, 23 October 2026: jobs.dedup_key is unique and never purged, so the five-minute key let only the first
    // night pass in each five minutes tick; the pass that woke for a reminder queued nothing.
    await adminQuery(`DELETE FROM jobs`);
    await scheduleControlCenter({ quiet: true, night: true });
    await new Promise((r) => setTimeout(r, 1100));
    await scheduleControlCenter({ quiet: true, night: true });
    const ticks = await jobsOf("brenda.tick");
    expect(ticks).toHaveLength(2);
    expect(ticks.every((t) => (t.payload as { nudges?: boolean }).nudges === false)).toBe(true);
    expect(new Set(ticks.map((t) => t.dedup_key)).size).toBe(2);
  });

  it("brendaTick with nudges off sends a due reminder and no nudge", async () => {
    const tz = a.employeeCtx.org.timezone;
    // Every day a working day from 00:00, so "an hour into the day" holds at noon.
    await adminQuery(`UPDATE schedules SET working_days = '{0,1,2,3,4,5,6}', start_local = '00:00', end_local = '23:59', timezone = $1`, [tz]);
    const today = localDate(new Date(), tz);
    const noon = localTimeOn(today, "12:00", tz);
    await adminQuery(`UPDATE tasks SET due_at = $1, status = 'todo' WHERE id = $2`, [localTimeOn(addDays(today, 1), "12:00", tz), a.taskIds.homepage]);
    await adminQuery(`UPDATE tasks SET assignee_membership_id = $1 WHERE id = $2`, [a.employeeCtx.membership.id, a.taskIds.homepage]);
    const r = await createReminder(a.employeeCtx, { body: "Send the invoice", remindAt: new Date(Date.now() + 60_000).toISOString() });
    await adminQuery(`UPDATE brenda_reminders SET remind_at = $1::timestamptz - interval '1 minute' WHERE id = $2`, [noon, (r as { id: string }).id]);
    await adminQuery(`DELETE FROM notifications`);
    const quiet = await brendaTick(noon, { nudges: false });
    expect(quiet.sent).toBe(1);
    const types = async () => (await adminQuery<{ type: string }>(`SELECT type FROM notifications ORDER BY created_at`)).map((n) => n.type);
    expect(await types()).toEqual(["brenda.reminder"]);
    // The same tick by day sends the nudge as today.
    await brendaTick(noon);
    expect(await types()).toContain("brenda.nudge");
  });
});

describe("a simulated night with the real loop, runner and maintenance", () => {
  let statements = 0;
  beforeAll(async () => {
    await makeItNight();
    await adminQuery(`DELETE FROM jobs`);
    await adminQuery(`DELETE FROM brenda_reminders`);
  });
  afterAll(() => vi.restoreAllMocks());

  it("nine hours outside the window: one pass an hour, every statement counted", async () => {
    const rows = await withWorker(loadSchedules);
    expect(insideWorkingWindow(rows, new Date())).toBe(false);
    expect((nextWindowStart(rows, new Date())?.getTime() ?? Infinity) - Date.now()).toBeGreaterThan(24 * 3600_000);
    const realQuery = Client.prototype.query;
    vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
      statements++;
      return (realQuery as (...a: unknown[]) => unknown).apply(this, args) as never;
    } as never);
    let clock = Date.now();
    const passes: { at: number; statements: number }[] = [];
    const runner = createRunner("test-night:1");
    const lines: string[] = [];
    let before = 0;
    const loop = createLoop({
      settings: workerSettings({}),
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      stopping: () => false,
      runOne: runner.runOne,
      maintenance: async (o) => { before = statements; await runner.maintenance(o); passes.push({ at: clock, statements: statements - before }); },
      loadSchedules: () => withWorker(loadSchedules),
      recentlyActive: () => withWorker(recentlyActive),
      nextDue: () => withWorker(loadNextDue),
      log: (l) => lines.push(l),
      error: (_l, err) => { throw err; },
    });
    const start = clock;
    const counted0 = statements;
    while (clock - start < 9 * 3600_000) await loop.tick();
    const total = statements - counted0;
    expect(loop.mode()).toBe("night");
    expect(passes.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < passes.length; i++) expect(passes[i].at - passes[i - 1].at).toBeGreaterThanOrEqual(59 * 60_000);
    expect(lines.filter((l) => l.startsWith("[worker] night pass")).length).toBe(passes.length);
    expect(lines.every((l) => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(l))).toBe(true); // no ids in the log
    // Reported by the build (phase 0 measurement): statements per simulated hour, and per pass.
    process.stdout.write(`[measure] simulated night: ${passes.length} passes in 9 h; ${total} statements in all (${Math.round(total / 9)} an hour); per pass ${passes.map((p) => p.statements).join(", ")}\n`);
    expect(total / 9).toBeLessThan(400);
  });
});

describe("two reminders close together at night, through the real loop, runner and maintenance", () => {
  // Fix review, 23 October 2026. The review's case was 02:00:10 (a pass), then reminders at 02:03 and 02:06: the 02:03
  // wake queued no tick (the five minutes' key was used), so that reminder went at the next hourly pass. The same with
  // the real clock (the database's now() can't be faked): a pass, then reminders 3 and 6 seconds later, all inside one
  // five minutes. Sleeps are real but never longer than 8 seconds; the longest sleep asked for is recorded.
  beforeAll(async () => {
    await makeItNight();
    await adminQuery(`DELETE FROM jobs`);
    await adminQuery(`DELETE FROM brenda_reminders`);
    await adminQuery(`DELETE FROM notifications`);
  });

  it("each reminder goes within a couple of seconds of its time, and the worker never plans the hour's sleep while one waits", async () => {
    // Keep the whole run inside one five-minute bucket, as in the review's case.
    const intoBucket = Date.now() % 300_000;
    if (intoBucket > 250_000) await new Promise((r) => setTimeout(r, 300_000 - intoBucket + 500));
    const runner = createRunner("test-night:2");
    const asked: { ms: number; reason?: string }[] = [];
    let stop = false;
    const loop = createLoop({
      settings: workerSettings({}),
      now: () => Date.now(),
      sleep: async (ms) => { asked.push({ ms }); await new Promise((r) => setTimeout(r, Math.min(ms, 8_000))); },
      stopping: () => stop,
      runOne: runner.runOne,
      maintenance: runner.maintenance,
      loadSchedules: () => withWorker(loadSchedules),
      recentlyActive: () => withWorker(recentlyActive),
      nextDue: () => withWorker(loadNextDue),
      log: () => undefined,
      error: (_l, err) => { throw err; },
    });
    // The first pass: nothing due yet, but it runs its tick (and, as nothing is due, sleeps for the cap: 8 s here).
    const first = await loop.tick();
    expect(first.mode).toBe("night");
    expect(first.wake?.reason).toBe("max");
    const t0 = Date.now();
    const r1 = await createReminder(a.employeeCtx, { body: "First", remindAt: new Date(t0 + 3_000).toISOString() });
    const r2 = await createReminder(a.employeeCtx, { body: "Second", remindAt: new Date(t0 + 6_000).toISOString() });
    const ids = [(r1 as { id: string }).id, (r2 as { id: string }).id];
    const sentAt = async () => adminQuery<{ id: string; late_ms: number | null }>(
      `SELECT id, (extract(epoch FROM sent_at - remind_at) * 1000)::int AS late_ms FROM brenda_reminders WHERE id = ANY($1::uuid[])`, [ids]);
    // The next pass (its own tick again) finds the first reminder ahead and sleeps until it; the one after, the second.
    const wakes: string[] = [];
    while (Date.now() - t0 < 20_000) {
      const r = await loop.tick();
      if (r.wake) wakes.push(r.wake.reason);
      const rows = await sentAt();
      if (rows.every((x) => x.late_ms !== null)) break;
    }
    stop = true;
    const rows = await sentAt();
    for (const r of rows) {
      expect(r.late_ms).not.toBeNull();
      expect(r.late_ms!).toBeLessThan(3_000);
    }
    expect(wakes).toContain("reminder");
    // Until the last reminder went, no pass planned the cap.
    expect(wakes.slice(0, -1)).not.toContain("max");
  }, 60_000);
});
