/**
 * Working time (owner decision, 8 October 2026: personal assistants, phase 4). A follow-up's freshness ("did they do
 * anything on it in the last working day?") and its reply deadline ("4 working hours") count only the organisation's
 * working hours: each working day's window from its start to its end, in its time zone, DST-safe through `localTimeOn`.
 * Time outside the windows does not count: asked Saturday 11:00 with 09:00 to 17:00 hours and 4 hours to reply, the
 * deadline is Monday 13:00; Monday 10:00 looks back one working day (8 hours) to Friday 10:00.
 *
 * Pure: no database, no clock of its own. The walk stops after 31 days; with no working days at all it falls back to
 * plain clock time.
 */
import { addDays, localDate, localTimeOn, weekdayOf } from "@/server/lib/time";

/** `start` and `end` are "HH:MM", local; `workingDays` 0 = Sunday … 6 = Saturday. */
export type WorkingSchedule = { timezone: string; workingDays: number[]; start: string; end: string };

const MAX_DAYS = 31;
const DEFAULT_DAY_SECONDS = 8 * 3600;

const hhmm = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "09:00";
};
const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** The organisation's schedule as the schedules table holds it ("09:00:00", smallint[]). */
export function fromSchedule(s: { timezone: string; working_days: number[]; start_local: string; end_local: string }): WorkingSchedule {
  const days = Array.isArray(s.working_days) ? s.working_days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  return { timezone: s.timezone, workingDays: [...new Set(days)], start: hhmm(s.start_local), end: hhmm(s.end_local) };
}

/** One working day's length in seconds (09:00 to 17:00 is 28,800); 8 hours when the schedule makes no sense. */
export function workingDaySeconds(s: WorkingSchedule): number {
  const d = (minutesOf(s.end) - minutesOf(s.start)) * 60;
  return d > 0 ? d : DEFAULT_DAY_SECONDS;
}

function windowOn(date: string, s: WorkingSchedule): [number, number] | null {
  if (!s.workingDays.includes(weekdayOf(date))) return null;
  const a = localTimeOn(date, s.start, s.timezone).getTime();
  const b = localTimeOn(date, s.end, s.timezone).getTime();
  return b > a ? [a, b] : null;
}

/** The instant `seconds` of working time before `now`, walking back over working windows only. */
export function workingTimeBefore(now: Date, s: WorkingSchedule, seconds: number): Date {
  const total = Math.max(0, seconds) * 1000;
  if (!s.workingDays.length || total === 0) return new Date(now.getTime() - total);
  let remaining = total;
  let date = localDate(now, s.timezone);
  for (let i = 0; i <= MAX_DAYS; i++, date = addDays(date, -1)) {
    const w = windowOn(date, s);
    if (!w) continue;
    const end = Math.min(w[1], now.getTime());
    if (end <= w[0]) continue;
    const available = end - w[0];
    if (available >= remaining) return new Date(end - remaining);
    remaining -= available;
  }
  return new Date(now.getTime() - total);
}

/** The instant `seconds` of working time after `from`, walking forward over working windows only. */
export function addWorkingTime(from: Date, s: WorkingSchedule, seconds: number): Date {
  const total = Math.max(0, seconds) * 1000;
  if (!s.workingDays.length || total === 0) return new Date(from.getTime() + total);
  let remaining = total;
  let date = localDate(from, s.timezone);
  for (let i = 0; i <= MAX_DAYS; i++, date = addDays(date, 1)) {
    const w = windowOn(date, s);
    if (!w) continue;
    const start = Math.max(w[0], from.getTime());
    if (w[1] <= start) continue;
    const available = w[1] - start;
    if (available >= remaining) return new Date(start + remaining);
    remaining -= available;
  }
  return new Date(from.getTime() + total);
}
