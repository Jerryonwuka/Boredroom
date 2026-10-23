/**
 * Worker night mode (owner request, 23 October 2026: realtime plan, phase 0, item 4; a bridge until phase 1 makes the
 * worker an alarm clock). Neon stops billing only after 5 minutes without a query, and the worker queried it every 2
 * seconds (and ran ~40 transactions every 15) all night. Outside every active organisation's widest working window
 * (start − 90 minutes to end + 60 minutes on its working days; the whole day on other days) the worker runs one
 * claim-and-maintenance pass, then sleeps until the earliest of:
 * - the next pending job's `next_run_at`;
 * - the next unsent reminder's `remind_at`;
 * - the next routine run, and the end of a quiet-hours hold (added to the plan's list, 23 October 2026, so a routine
 *   or a held delivery outside the window is never up to an hour late);
 * - the next follow-up deadline and the next mention Confirm running out (fix review, 23 October 2026: the sweeps those
 *   start are queued by maintenance when something is due, so they were up to an hour late at night);
 * - the next window start;
 * - WORKER_NIGHT_MAX_SLEEP_MIN (60 minutes).
 * Only times still ahead count (fix review, 23 October 2026): one row left past due no longer hides every later time
 * of its kind. Something that came due in the last OVERDUE_WINDOW_MIN minutes and is still waiting after the pass (a
 * job another worker held, a reminder the tick missed) brings the next pass OVERDUE_RETRY_MS later instead of after
 * the cap; anything older is left to the hourly passes, so a row that never clears can't keep Neon awake all night.
 * Night passes skip brenda.tick's nudges (reminders still go when due; each night pass queues a tick of its own, see
 * worker/control-center.ts), the LiveKit room listing and connector.sweep.
 * Someone signed in and active in the last 10 minutes (auth_sessions.last_seen_at, which every page and the notch
 * touch at most every 5 minutes) keeps the day cadence with those skips: the database is awake for them anyway.
 * What the bridge does not do (fix review, 23 October 2026, so nobody reads more into it): activity is checked only at
 * a pass, so someone who starts using Boredroom during a night sleep is noticed at the next pass, up to the cap later;
 * and nothing wakes a sleeping worker when the web app queues a job (a call recap, a ring's timeout, a connector post,
 * a mention's reply), so such a job also waits for the next pass. The call sweep's time-based closes (alone for 15
 * minutes, the 4-hour cap) run at the passes too. Phase 1's wake-ups from the app remove these waits. Pure functions
 * for the windows and the wake time, so they are tested with a fake clock.
 */
import type { Db } from "../src/server/db";
import { addDays, isValidTimeZone, localDate, localTimeOn, weekdayOf } from "../src/server/lib/time";
import { schema0039Ready } from "../src/server/lib/schema-0039";
import { schema0041Ready } from "../src/server/lib/schema-0041";

export type WorkerSettings = { pollMs: number; maintenanceMs: number; nightMaxSleepMs: number };

/** Margins around a working day: the window opens 90 minutes before the start and closes 60 minutes after the end. */
export const WINDOW_LEAD_MIN = 90;
export const WINDOW_TAIL_MIN = 60;
/** "Active": a session seen within this many minutes keeps the day cadence outside the window. */
export const ACTIVE_WITHIN_MIN = 10;
/** By day the schedules are read again at most every 5 minutes; by night at every pass. */
export const SCHEDULE_TTL_MS = 5 * 60_000;
/** The shortest night sleep, so a time just passed never makes the loop spin. */
export const NIGHT_MIN_SLEEP_MS = 1_000;
/** Something past due for at most this long and still waiting after a pass is retried soon (loadNextDue's `overdue`). */
export const OVERDUE_WINDOW_MIN = 10;
/** How soon that retry comes. */
export const OVERDUE_RETRY_MS = 30_000;

function num(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (v === undefined || v.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * WORKER_POLL_INTERVAL_MS (2000): the job claim's cadence by day. WORKER_MAINTENANCE_MS (15000, before 23 October 2026
 * hard-coded in worker/index.ts): the maintenance block's. WORKER_NIGHT_MAX_SLEEP_MIN (60): the longest night sleep;
 * decimals allowed (the measurement script uses a fraction of a minute).
 */
export function workerSettings(env: Record<string, string | undefined> = process.env): WorkerSettings {
  return {
    pollMs: Math.round(num(env.WORKER_POLL_INTERVAL_MS, 2000, 100, 60_000)),
    maintenanceMs: Math.round(num(env.WORKER_MAINTENANCE_MS, 15_000, 1_000, 3_600_000)),
    nightMaxSleepMs: Math.round(num(env.WORKER_NIGHT_MAX_SLEEP_MIN, 60, 0.05, 720) * 60_000),
  };
}

/** One schedule: an organisation's (in its schedule's and the organisation's time zones) or a person's own. */
export type ScheduleRow = { timezones: string[]; working_days: number[]; start_local: string; end_local: string };
export type Window = { start: Date; end: Date };

const isWorkingDay = (days: number[], date: string) => {
  const d = weekdayOf(date); // 0 = Sunday … 6 = Saturday
  return days.includes(d) || (d === 0 && days.includes(7));
};

/** Every working window of these schedules that touches [now − 2 days, now + 9 days], in no particular order. */
export function workingWindows(rows: ScheduleRow[], now: Date): Window[] {
  const out: Window[] = [];
  for (const row of rows) {
    const zones = Array.from(new Set(row.timezones.filter((z) => z && isValidTimeZone(z))));
    if (!zones.length) zones.push("UTC");
    for (const tz of zones) {
      const today = localDate(now, tz);
      for (let i = -2; i <= 9; i++) {
        const date = addDays(today, i);
        if (!isWorkingDay(row.working_days, date)) continue;
        const start = new Date(localTimeOn(date, row.start_local, tz).getTime() - WINDOW_LEAD_MIN * 60_000);
        const end = new Date(localTimeOn(date, row.end_local, tz).getTime() + WINDOW_TAIL_MIN * 60_000);
        if (end > start) out.push({ start, end });
      }
    }
  }
  return out;
}

export function insideWorkingWindow(rows: ScheduleRow[], now: Date): boolean {
  const t = now.getTime();
  return workingWindows(rows, now).some((w) => w.start.getTime() <= t && t < w.end.getTime());
}

/** The next window start after `now`, or null when no schedule has a working day in the next nine days. */
export function nextWindowStart(rows: ScheduleRow[], now: Date): Date | null {
  const t = now.getTime();
  let best: number | null = null;
  for (const w of workingWindows(rows, now)) {
    const s = w.start.getTime();
    if (s > t && (best === null || s < best)) best = s;
  }
  return best === null ? null : new Date(best);
}

/**
 * What is due next, as the database has it: each kind's earliest time still ahead of the database's clock (sweep: the
 * next follow-up deadline or mention Confirm running out), and whether anything came due in the last
 * OVERDUE_WINDOW_MIN minutes and is still waiting.
 */
export type NextDue = { job: Date | null; reminder: Date | null; routine: Date | null; held: Date | null; sweep?: Date | null; overdue?: boolean };
export type Wake = { at: Date; reason: "job" | "reminder" | "routine" | "held" | "sweep" | "window" | "max" | "backlog" | "overdue" };

/**
 * When a night pass sleeps until: the earliest due time, the next window start, or the longest sleep. The due times are
 * the ones the database still has ahead; one the worker's clock already has behind it (a small clock difference
 * between the worker and the database) wakes the next pass after the shortest sleep rather than being dropped for the
 * cap (fix review, 23 October 2026). `overdue`: something recently due is still waiting, so the next pass comes within
 * OVERDUE_RETRY_MS. `backlog`: the pass stopped at its job cap, so it goes on almost at once.
 */
export function nightWake(nowMs: number, o: { due: NextDue | null; windowStart: Date | null; maxSleepMs: number; backlog?: boolean }): Wake {
  if (o.backlog) return { at: new Date(nowMs + NIGHT_MIN_SLEEP_MS), reason: "backlog" };
  const floor = nowMs + NIGHT_MIN_SLEEP_MS;
  let best: Wake = { at: new Date(nowMs + o.maxSleepMs), reason: "max" };
  const consider = (d: Date | null | undefined, reason: Wake["reason"]) => {
    if (!d || Number.isNaN(d.getTime())) return;
    if (d.getTime() < best.at.getTime()) best = { at: d, reason };
  };
  if (o.due) {
    consider(o.due.job, "job");
    consider(o.due.reminder, "reminder");
    consider(o.due.routine, "routine");
    consider(o.due.held, "held");
    consider(o.due.sweep, "sweep");
    if (o.due.overdue) consider(new Date(nowMs + OVERDUE_RETRY_MS), "overdue");
  }
  // A window start already behind us is not a wake: the window is open, and the next maintenance sees it.
  if (o.windowStart && o.windowStart.getTime() > nowMs) consider(o.windowStart, "window");
  return best.at.getTime() < floor ? { at: new Date(floor), reason: best.reason } : best;
}

// ---- The database side (worker context) ---------------------------------------------------------------------------------

/** Active organisations' current schedules, and each active member's own. One query. */
export async function loadSchedules(db: Db): Promise<ScheduleRow[]> {
  const rows = await db.query<{ tz1: string | null; tz2: string | null; working_days: number[] | null; start_local: string; end_local: string }>(
    `SELECT s.timezone AS tz1, o.timezone AS tz2, COALESCE(s.working_days, '{1,2,3,4,5}'::smallint[])::int[] AS working_days,
            to_char(COALESCE(s.start_local, '09:00'::time), 'HH24:MI') AS start_local, to_char(COALESCE(s.end_local, '17:00'::time), 'HH24:MI') AS end_local
       FROM organisations o
       LEFT JOIN LATERAL (SELECT timezone, working_days, start_local, end_local FROM schedules
                           WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
      WHERE o.status = 'active'
     UNION ALL
     SELECT s.timezone, NULL, s.working_days::int[], to_char(s.start_local, 'HH24:MI'), to_char(s.end_local, 'HH24:MI')
       FROM memberships m JOIN organisations o ON o.id = m.organisation_id AND o.status = 'active'
       JOIN LATERAL (SELECT timezone, working_days, start_local, end_local FROM schedules
                      WHERE membership_id = m.id ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
      WHERE m.status = 'active'`);
  return rows.map((r) => ({
    timezones: [r.tz1, r.tz2].filter((z): z is string => !!z),
    working_days: (r.working_days ?? [1, 2, 3, 4, 5]).map(Number),
    start_local: r.start_local, end_local: r.end_local,
  }));
}

/** Someone signed in used a page or the notch in the last ACTIVE_WITHIN_MIN minutes. */
export async function recentlyActive(db: Db): Promise<boolean> {
  const r = await db.one<{ active: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()
                       AND last_seen_at > now() - make_interval(mins => $1)) AS active`, [ACTIVE_WITHIN_MIN]);
  return r.active;
}

/**
 * The earliest pending job, unsent reminder, routine run, quiet-hours hold and sweep deadline still ahead, and whether
 * anything came due in the last OVERDUE_WINDOW_MIN minutes and is still waiting. Each `min` takes only times after
 * now() (fix review, 23 October 2026: a past-due row used to hide every later time of its kind, so the worker slept for
 * the cap). One query; the follow-up deadline and the mention Confirm only once migrations 0039 and 0041 are there.
 */
export async function loadNextDue(db: Db): Promise<NextDue> {
  const followUps = await schema0039Ready(db).catch(() => false);
  const mentions = await schema0041Ready(db).catch(() => false);
  const sweeps = [
    followUps ? `(SELECT min(deadline_at) FROM follow_ups WHERE status = 'asking' AND deadline_at > now())` : null,
    mentions ? `(SELECT min(confirm_until) FROM assistant_mentions WHERE status = 'waiting_confirm' AND confirm_until > now())` : null,
  ].filter(Boolean);
  const r = await db.one<{ job: string | null; reminder: string | null; routine: string | null; held: string | null; sweep: string | null; overdue: boolean }>(
    `SELECT (SELECT min(next_run_at) FROM jobs WHERE state = 'pending' AND next_run_at > now()) AS job,
            (SELECT min(remind_at) FROM brenda_reminders WHERE sent_at IS NULL AND cancelled_at IS NULL AND remind_at > now()) AS reminder,
            (SELECT min(next_run_at) FROM routines WHERE enabled AND deleted_at IS NULL AND next_run_at > now()) AS routine,
            (SELECT min(held_until) FROM routine_runs WHERE delivery = 'held' AND held_until > now()) AS held,
            ${sweeps.length ? `LEAST(${sweeps.join(", ")})` : "NULL::timestamptz"} AS sweep,
            (EXISTS (SELECT 1 FROM jobs WHERE state = 'pending' AND next_run_at <= now() AND next_run_at > now() - make_interval(mins => $1))
             OR EXISTS (SELECT 1 FROM brenda_reminders WHERE sent_at IS NULL AND cancelled_at IS NULL
                          AND remind_at <= now() AND remind_at > now() - make_interval(mins => $1))) AS overdue`, [OVERDUE_WINDOW_MIN]);
  const d = (v: string | null) => (v ? new Date(v) : null);
  return { job: d(r.job), reminder: d(r.reminder), routine: d(r.routine), held: d(r.held), sweep: d(r.sweep), overdue: !!r.overdue };
}
