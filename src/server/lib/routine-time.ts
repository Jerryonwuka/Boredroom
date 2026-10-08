/**
 * When a routine runs and when the person is quiet (owner decision, 8 October 2026: phase 7a, routines and quiet
 * hours). Pure: no database and no clock of its own, so every rule is unit-tested (tests/unit/routine-time.test.ts).
 *
 * Times are the person's wall-clock time in their own zone (their own when they set one and the runtime knows it, else
 * the organisation's), read through `localTimeOn`, so they hold on the days the clocks change: a time the clocks skip
 * (02:30 on a spring-forward night) runs at the instant `localTimeOn` gives for it (03:30 new time), and a time that
 * happens twice when they go back runs once, at the first (the next run is computed from after it, so the second never
 * matches).
 *
 * Days: 0 = Sunday … 6 = Saturday (`weekdayOf`). A monthly day past the month's end runs on its last day (the 31st runs
 * on 30 April and on 28 or 29 February) and never twice in a month; day 0 is always the last day. Quiet days are the
 * days a quiet window STARTS on: 22:00 to 07:00 set for Friday is quiet from Friday 22:00 to Saturday 07:00.
 */
import { addDays, isValidTimeZone, localDate, localTimeOn, weekdayOf } from "@/server/lib/time";
import type { Cadence, QuietHours, QuietState } from "@/lib/routines";

/** How far ahead `nextRunAt` looks: more than a year, so a monthly or weekly cadence always finds its day. */
const MAX_DAYS = 400;
/** How far ahead `quietState` looks for the next quiet window. */
const QUIET_LOOKAHEAD_DAYS = 8;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;

/** The person's zone: their own when it is set and the runtime knows it, else the organisation's. */
export function personTimeZone(own: string | null | undefined, orgTz: string): string {
  if (typeof own === "string" && ZONE.test(own) && isValidTimeZone(own)) return own;
  return orgTz;
}

/** The last day of the month a local date ("2026-02-10") is in: 28, 29, 30 or 31. */
export function lastDayOfMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Whether a cadence runs on a local date. */
export function matchesDay(c: Cadence, date: string): boolean {
  const wd = weekdayOf(date);
  switch (c.kind) {
    case "daily": return true;
    case "weekdays": return wd >= 1 && wd <= 5;
    case "weekly": return c.days.includes(wd);
    case "monthly": {
      const dom = Number(date.slice(8, 10));
      const last = lastDayOfMonth(date);
      return c.day === 0 ? dom === last : dom === Math.min(c.day, last);
    }
  }
}

/**
 * The first run strictly after `after`: walking local dates from the day before `after`'s (in the zone) for at most 400
 * days, the first matching date whose time ("HH:MM", local) falls after it. Throws only when no date matches, which a
 * valid cadence never does (a weekly one with no days, a time that is not one).
 */
export function nextRunAt(c: Cadence, time: string, timeZone: string, after: Date): Date {
  if (!TIME.test(time)) throw new Error(`nextRunAt: not a time: ${time}`);
  const t0 = after.getTime();
  let date = addDays(localDate(after, timeZone), -1);
  for (let i = 0; i <= MAX_DAYS; i++, date = addDays(date, 1)) {
    if (!matchesDay(c, date)) continue;
    const at = localTimeOn(date, time, timeZone);
    if (at.getTime() > t0) return at;
  }
  throw new Error(`nextRunAt: no run in ${MAX_DAYS} days for ${JSON.stringify(c)}`);
}

type Window = { start: string; end: string; days: number[] };

/** The quiet window that starts on a local date, when that date is one of the chosen days. */
function windowOn(q: Window, tz: string, date: string): { start: Date; end: Date } | null {
  if (!q.days.includes(weekdayOf(date))) return null;
  const start = localTimeOn(date, q.start, tz);
  const end = localTimeOn(q.end > q.start ? date : addDays(date, 1), q.end, tz);
  return end.getTime() > start.getTime() ? { start, end } : null;
}

/** The quiet window `at` falls in (from the day before or the day itself), or null. */
export function quietWindowAt(q: Window, tz: string, at: Date): { start: Date; end: Date } | null {
  if (!TIME.test(q.start) || !TIME.test(q.end) || q.start === q.end) return null;
  const d = localDate(at, tz);
  for (const date of [addDays(d, -1), d]) {
    const w = windowOn(q, tz, date);
    if (w && w.start.getTime() <= at.getTime() && at.getTime() < w.end.getTime()) return w;
  }
  return null;
}

/** The start of the first quiet window that begins after `at`, within 8 days, or null. */
function nextQuietStart(q: Window, tz: string, at: Date): Date | null {
  let date = localDate(at, tz);
  for (let i = 0; i <= QUIET_LOOKAHEAD_DAYS; i++, date = addDays(date, 1)) {
    const w = windowOn(q, tz, date);
    if (w && w.start.getTime() > at.getTime()) return w.start;
  }
  return null;
}

/**
 * Whether the person is quiet at `now`: `until` is the current window's end, `nextStart` the next window's start
 * (within 8 days). Quiet hours off, none set, or before migration 0046 (`ready` false): never quiet.
 */
export function quietState(q: QuietHours | null | undefined, tz: string, now: Date, ready = true): QuietState {
  if (!ready) return { ready: false, active: false, until: null, nextStart: null };
  if (!q || !q.enabled || !q.start || !q.end || !TIME.test(q.start) || !TIME.test(q.end) || q.start === q.end || !q.days.length) {
    return { ready: true, active: false, until: null, nextStart: null };
  }
  const win = { start: q.start, end: q.end, days: q.days };
  const current = quietWindowAt(win, tz, now);
  const next = nextQuietStart(win, tz, now);
  return { ready: true, active: !!current, until: current ? current.end.toISOString() : null, nextStart: next ? next.toISOString() : null };
}
