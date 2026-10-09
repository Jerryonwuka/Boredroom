/**
 * The stalled re-plan's suggested date (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed",
 * second part). When the lead's chase routine finds a task stalled a second time, the follow-up's answer comes with a new
 * due date suggested to the lead, as a Confirm: nothing on the task changes until they confirm it (replans.ts).
 *
 * The suggestion: from now, or from the current due date when that is still ahead, at least two working days more (or the
 * task's estimate in working days, rounded up, when that is longer), counted in the organisation's working hours only,
 * then the end of that working day. Pure (tests/unit/replan-suggest.test.ts).
 */
import { addWorkingTime, workingDaySeconds, type WorkingSchedule } from "@/server/lib/working-time";
import { localDate, localTimeOn } from "@/server/lib/time";

/** At least this many working days are suggested. */
export const REPLAN_MIN_WORKING_DAYS = 2;

/**
 * base = max(now, previousDueAt); days = max(2, ceil(estimateMinutes / a working day's minutes)); the instant `days`
 * working days after base, snapped to the schedule's end time on that local day ("Thu 10:00" plus two working days of
 * 09:00 to 17:00 is "Mon 17:00").
 */
export function suggestReplanDue(o: { now: Date; previousDueAt: string | null; estimateMinutes: number | null; schedule: WorkingSchedule }): Date {
  const prev = o.previousDueAt ? Date.parse(o.previousDueAt) : NaN;
  const base = new Date(Number.isFinite(prev) ? Math.max(o.now.getTime(), prev) : o.now.getTime());
  const daySeconds = workingDaySeconds(o.schedule);
  const est = typeof o.estimateMinutes === "number" && Number.isFinite(o.estimateMinutes) && o.estimateMinutes > 0 ? o.estimateMinutes : 0;
  const days = Math.max(REPLAN_MIN_WORKING_DAYS, Math.ceil((est * 60) / daySeconds));
  const at = addWorkingTime(base, o.schedule, days * daySeconds);
  const end = localTimeOn(localDate(at, o.schedule.timezone), o.schedule.end, o.schedule.timezone);
  // The end of that day, never earlier than the working time counted (a schedule whose end reads before its start).
  return end.getTime() >= at.getTime() ? end : at;
}
