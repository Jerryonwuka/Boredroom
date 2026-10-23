/**
 * Worker night mode (owner request, 23 October 2026: realtime plan, phase 0, item 4), with a fake clock and no database:
 * the settings, the widest working window (start − 90 min to end + 60 min on working days), the night wake time, and
 * the loop over a simulated night (at most one pass an hour with nothing due, a pass at each due time, the day cadence
 * back at the window start, the day cadence kept while someone is active, quiet maintenance outside the window).
 */
import { describe, expect, it } from "vitest";
import { insideWorkingWindow, nextWindowStart, nightWake, workerSettings, workingWindows, type NextDue, type ScheduleRow } from "../../worker/night";
import { createLoop, type LoopDeps } from "../../worker/loop";

const LONDON: ScheduleRow = { timezones: ["Europe/London"], working_days: [1, 2, 3, 4, 5], start_local: "09:00", end_local: "17:00" };
const at = (iso: string) => new Date(iso);
const NONE: NextDue = { job: null, reminder: null, routine: null, held: null };

describe("settings", () => {
  it("defaults: 2 s claims, 15 s maintenance, 60-minute night sleeps", () => {
    expect(workerSettings({})).toEqual({ pollMs: 2000, maintenanceMs: 15_000, nightMaxSleepMs: 3_600_000 });
  });
  it("reads the three variables, clamps nonsense, keeps decimals for the night cap", () => {
    expect(workerSettings({ WORKER_POLL_INTERVAL_MS: "500", WORKER_MAINTENANCE_MS: "30000", WORKER_NIGHT_MAX_SLEEP_MIN: "0.5" }))
      .toEqual({ pollMs: 500, maintenanceMs: 30_000, nightMaxSleepMs: 30_000 });
    expect(workerSettings({ WORKER_POLL_INTERVAL_MS: "abc", WORKER_MAINTENANCE_MS: "1", WORKER_NIGHT_MAX_SLEEP_MIN: "99999" }))
      .toEqual({ pollMs: 2000, maintenanceMs: 1000, nightMaxSleepMs: 720 * 60_000 });
  });
});

describe("the widest working window", () => {
  // Friday 23 October 2026, London on BST (UTC+1): the window is 07:30–18:00 local = 06:30–17:00 UTC.
  it("opens 90 minutes before the start and closes 60 minutes after the end, on working days", () => {
    expect(insideWorkingWindow([LONDON], at("2026-10-23T06:29:00Z"))).toBe(false);
    expect(insideWorkingWindow([LONDON], at("2026-10-23T06:30:00Z"))).toBe(true);
    expect(insideWorkingWindow([LONDON], at("2026-10-23T16:59:00Z"))).toBe(true);
    expect(insideWorkingWindow([LONDON], at("2026-10-23T17:00:00Z"))).toBe(false);
    expect(insideWorkingWindow([LONDON], at("2026-10-23T02:00:00Z"))).toBe(false);
  });

  it("the whole day is outside on a day off", () => {
    // Saturday 24 October 2026, midday.
    expect(insideWorkingWindow([LONDON], at("2026-10-24T11:00:00Z"))).toBe(false);
    // Friday night → Monday 26 October (the clocks went back on Sunday 25th: GMT, so 07:30 local = 07:30 UTC).
    expect(nextWindowStart([LONDON], at("2026-10-23T20:00:00Z"))).toEqual(at("2026-10-26T07:30:00Z"));
  });

  it("is the widest across organisations and people: any one window keeps the day cadence", () => {
    const lagos: ScheduleRow = { timezones: ["Africa/Lagos"], working_days: [1, 2, 3, 4, 5], start_local: "08:00", end_local: "16:00" };
    const lateOwn: ScheduleRow = { timezones: ["Europe/London"], working_days: [5], start_local: "12:00", end_local: "22:00" };
    // 17:30 UTC on Friday: London's window has closed (17:00 UTC), Lagos's too (16:00 local + 60 min = 16:00 UTC); a
    // person's own Friday schedule runs to 22:00 BST + 60 min = 22:00 UTC.
    expect(insideWorkingWindow([LONDON, lagos], at("2026-10-23T17:30:00Z"))).toBe(false);
    expect(insideWorkingWindow([LONDON, lagos, lateOwn], at("2026-10-23T17:30:00Z"))).toBe(true);
    // Lagos (UTC+1, no summer time) opens at 06:30 UTC.
    expect(nextWindowStart([lagos], at("2026-10-23T02:00:00Z"))).toEqual(at("2026-10-23T05:30:00Z"));
  });

  it("an organisation's schedule counts in each of its time zones; Sunday may be 0 or 7; a bad zone falls back to UTC", () => {
    const both: ScheduleRow = { timezones: ["Europe/London", "Asia/Tokyo"], working_days: [7], start_local: "09:00", end_local: "10:00" };
    const w = workingWindows([both], at("2026-10-25T12:00:00Z"));
    expect(w.some((x) => x.start.toISOString() === "2026-10-25T07:30:00.000Z")).toBe(true); // London, Sunday (GMT again)
    expect(w.some((x) => x.start.toISOString() === "2026-10-24T22:30:00.000Z")).toBe(true); // Tokyo, Sunday
    expect(workingWindows([{ ...LONDON, timezones: ["Not/AZone"] }], at("2026-10-23T12:00:00Z")).length).toBeGreaterThan(0);
  });

  it("no active organisation: never inside, no next start", () => {
    expect(insideWorkingWindow([], at("2026-10-23T12:00:00Z"))).toBe(false);
    expect(nextWindowStart([], at("2026-10-23T12:00:00Z"))).toBeNull();
  });
});

describe("the night wake time", () => {
  const now = at("2026-10-23T23:00:00Z").getTime();
  const hour = 3_600_000;
  it("the longest sleep when nothing is due", () => {
    expect(nightWake(now, { due: NONE, windowStart: null, maxSleepMs: hour })).toEqual({ at: new Date(now + hour), reason: "max" });
  });
  it("the earliest of a job, a reminder, a routine, a hold and the window start", () => {
    const due: NextDue = { job: new Date(now + 40 * 60_000), reminder: new Date(now + 25 * 60_000), routine: new Date(now + 50 * 60_000), held: null };
    expect(nightWake(now, { due, windowStart: new Date(now + 30 * 60_000), maxSleepMs: hour })).toEqual({ at: new Date(now + 25 * 60_000), reason: "reminder" });
    expect(nightWake(now, { due: { ...NONE, held: new Date(now + 5 * 60_000) }, windowStart: null, maxSleepMs: hour }).reason).toBe("held");
    expect(nightWake(now, { due: NONE, windowStart: new Date(now + 10 * 60_000), maxSleepMs: hour })).toEqual({ at: new Date(now + 10 * 60_000), reason: "window" });
  });
  it("a due time the database still has ahead but the worker's clock has passed: the shortest sleep, not the cap", () => {
    // Fix review, 23 October 2026: loadNextDue returns only times after the database's now(), so a time behind the
    // worker's clock is a clock difference, not the pass's own work.
    expect(nightWake(now, { due: { ...NONE, job: new Date(now - 500) }, windowStart: null, maxSleepMs: hour })).toEqual({ at: new Date(now + 1000), reason: "job" });
  });
  it("something recently due still waiting: the next pass in 30 seconds, unless something else comes sooner", () => {
    expect(nightWake(now, { due: { ...NONE, overdue: true }, windowStart: null, maxSleepMs: hour })).toEqual({ at: new Date(now + 30_000), reason: "overdue" });
    expect(nightWake(now, { due: { ...NONE, overdue: true, reminder: new Date(now + 10_000) }, windowStart: null, maxSleepMs: hour }).reason).toBe("reminder");
  });
  it("a follow-up deadline or a mention Confirm running out wakes the pass that queues its sweep", () => {
    expect(nightWake(now, { due: { ...NONE, sweep: new Date(now + 4 * 60_000) }, windowStart: null, maxSleepMs: hour })).toEqual({ at: new Date(now + 4 * 60_000), reason: "sweep" });
  });
  it("a pass that stopped at its job cap goes on almost at once", () => {
    expect(nightWake(now, { due: null, windowStart: null, maxSleepMs: hour, backlog: true })).toEqual({ at: new Date(now + 1000), reason: "backlog" });
  });
  it("never sleeps under a second", () => {
    expect(nightWake(now, { due: { ...NONE, job: new Date(now + 10) }, windowStart: null, maxSleepMs: hour }).at.getTime()).toBe(now + 1000);
  });
});

/** A simulated worker: a fake clock that each sleep moves on, and counters for every database step. */
function simulate(o: { start: string; rows?: ScheduleRow[]; due?: (now: number) => NextDue; active?: (now: number) => boolean; jobsAt?: number[] }) {
  let clock = at(o.start).getTime();
  const passes: { at: number; quiet: boolean; night: boolean }[] = [];
  const counts = { claims: 0, schedules: 0, active: 0, nextDue: 0, statements: 0 };
  const pendingJobs = [...(o.jobsAt ?? [])];
  const deps: LoopDeps = {
    settings: workerSettings({}),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    stopping: () => false,
    runOne: async () => {
      counts.claims++; counts.statements++;
      const i = pendingJobs.findIndex((t) => t <= clock);
      if (i < 0) return false;
      pendingJobs.splice(i, 1);
      return true;
    },
    maintenance: async ({ quiet, night }) => { passes.push({ at: clock, quiet, night: !!night }); counts.statements += 40; },
    loadSchedules: async () => { counts.schedules++; counts.statements++; return o.rows ?? [LONDON]; },
    recentlyActive: async () => { counts.active++; counts.statements++; return o.active?.(clock) ?? false; },
    nextDue: async () => {
      counts.nextDue++; counts.statements++;
      const fromJobs = pendingJobs.filter((t) => t > clock).sort((a, b) => a - b)[0];
      const d = o.due?.(clock) ?? NONE;
      return { ...d, job: fromJobs ? new Date(fromJobs) : d.job };
    },
    log: () => undefined,
    error: (_l, err) => { throw err; },
  };
  const loop = createLoop(deps);
  return {
    loop, passes, counts, now: () => clock,
    async until(iso: string) { const end = at(iso).getTime(); while (clock < end) await loop.tick(); },
  };
}

describe("a simulated night", () => {
  it("Thursday 17:00 to Friday 06:30 UTC with nothing due: at most one pass an hour, then the day cadence at the window start", async () => {
    const sim = simulate({ start: "2026-10-22T17:00:00Z" });
    await sim.until("2026-10-23T06:29:00Z");
    // 13.5 hours outside the window: a pass at 17:00 and then one an hour.
    const night = sim.passes.filter((p) => p.at >= at("2026-10-22T17:00:00Z").getTime());
    expect(night.length).toBeLessThanOrEqual(14);
    expect(night.every((p) => p.quiet)).toBe(true);
    // Every pass but the first (still day mode when it began) is a night pass, whose Brenda tick has a key of its own.
    expect(night.slice(1).every((p) => p.night)).toBe(true);
    for (let i = 1; i < night.length; i++) expect(night[i].at - night[i - 1].at).toBeGreaterThanOrEqual(59 * 60_000);
    // Per hour: one pass, each one claim attempt, one schedule read, one activity check, one look at what is due.
    expect(sim.counts.claims).toBe(night.length);
    expect(sim.counts.statements).toBeLessThanOrEqual(night.length * 44);
    // At the window start (Friday 06:30 UTC; the last night sleep ends exactly there) the day cadence returns.
    await sim.until("2026-10-23T06:31:00Z");
    expect(sim.loop.mode()).toBe("day");
    const day = sim.passes.filter((p) => p.at >= at("2026-10-23T06:30:00Z").getTime());
    expect(day[0].at).toBe(at("2026-10-23T06:30:00Z").getTime());
    expect(day.every((p) => !p.quiet)).toBe(true);
    // By day the claim runs every 2 seconds again: ~30 claims a minute.
    expect(sim.counts.claims - night.length).toBeGreaterThan(25);
  });

  it("wakes at a due job, a due reminder and a due routine, not an hour later", async () => {
    const t0 = at("2026-10-22T23:00:00Z").getTime();
    const reminder = t0 + 23 * 60_000, routine = t0 + 95 * 60_000;
    const sim = simulate({
      start: "2026-10-22T23:00:00Z", jobsAt: [t0 + 7 * 60_000],
      due: (now) => ({ ...NONE, reminder: now < reminder ? new Date(reminder) : null, routine: now < routine ? new Date(routine) : null }),
    });
    await sim.until("2026-10-23T02:00:00Z");
    const times = sim.passes.map((p) => (p.at - t0) / 60_000);
    expect(times.slice(0, 5)).toEqual([0, 7, 23, 83, 95]);
  });

  it("someone active at night keeps the day cadence (quiet maintenance), and night mode follows when they leave", async () => {
    const leaves = at("2026-10-23T23:30:00Z").getTime();
    const sim = simulate({ start: "2026-10-23T23:00:00Z", active: (now) => now < leaves });
    await sim.until("2026-10-23T23:10:00Z");
    expect(sim.loop.mode()).toBe("quiet");
    const early = sim.passes.length;
    expect(early).toBeGreaterThanOrEqual(37); // every 15–16 s (the 2-second claim loop's granularity, as today)
    expect(sim.passes.every((p) => p.quiet)).toBe(true);
    expect(sim.passes.some((p) => p.night)).toBe(false); // someone active: the five-minute tick, not one per pass
    await sim.until("2026-10-24T02:00:00Z");
    expect(sim.loop.mode()).toBe("night");
    const after = sim.passes.filter((p) => p.at > leaves + 60_000);
    expect(after.length).toBeLessThanOrEqual(3);
  });

  it("a backlog at night is drained pass after pass, not an hour apart", async () => {
    const t0 = at("2026-10-23T23:00:00Z").getTime();
    const sim = simulate({ start: "2026-10-23T23:00:00Z", jobsAt: Array.from({ length: 1200 }, () => t0) });
    const a = await sim.loop.tick(), b = await sim.loop.tick(), c = await sim.loop.tick();
    expect([a.ran, b.ran, c.ran]).toEqual([500, 500, 200]);
    expect([a.wake?.reason, b.wake?.reason, c.wake?.reason]).toEqual(["backlog", "backlog", "max"]);
    expect([a.sleptMs, b.sleptMs]).toEqual([1000, 1000]);
  });

  it("by day nothing changes: maintenance every 15 s, a claim every 2 s when idle", async () => {
    const sim = simulate({ start: "2026-10-23T10:00:00Z" });
    await sim.until("2026-10-23T10:01:00Z");
    expect(sim.passes.length).toBe(4);
    expect(sim.counts.claims).toBe(30);
    expect(sim.passes.every((p) => !p.quiet && !p.night)).toBe(true);
    // Schedules are read again at most every 5 minutes by day.
    expect(sim.counts.schedules).toBe(1);
  });
});
