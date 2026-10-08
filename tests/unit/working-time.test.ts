import { describe, expect, it } from "vitest";
import { addWorkingTime, fromSchedule, workingDaySeconds, workingTimeBefore, type WorkingSchedule } from "@/server/lib/working-time";
import { localTimeOn } from "@/server/lib/time";

// Working time (owner decision, 8 October 2026: personal assistants, phase 4): a follow-up's freshness and its reply
// deadline count only the organisation's working hours, in its time zone, across clock changes.

const lagos: WorkingSchedule = { timezone: "Africa/Lagos", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
const at = (date: string, time: string, tz = "Africa/Lagos") => localTimeOn(date, time, tz);
const FOUR_HOURS = 4 * 3600;

describe("the schedule", () => {
  it("reads the schedules table's shape", () => {
    expect(fromSchedule({ timezone: "Africa/Lagos", working_days: [1, 2, 3, 4, 5], start_local: "09:00:00", end_local: "17:30:00" }))
      .toEqual({ timezone: "Africa/Lagos", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:30" });
    expect(fromSchedule({ timezone: "UTC", working_days: [1, 1, 9, -1, 3], start_local: "8:00", end_local: "16:00" }).workingDays).toEqual([1, 3]);
  });

  it("measures a working day", () => {
    expect(workingDaySeconds(lagos)).toBe(28_800);
    expect(workingDaySeconds({ ...lagos, start: "08:30", end: "17:00" })).toBe(30_600);
    expect(workingDaySeconds({ ...lagos, start: "17:00", end: "09:00" })).toBe(28_800); // nonsense: a plain 8 hours
  });
});

describe("a reply deadline (walking forward)", () => {
  it("counts only working hours", () => {
    expect(addWorkingTime(at("2026-10-06", "16:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-07", "12:00")); // Tuesday 16:00 → Wednesday 12:00
    expect(addWorkingTime(at("2026-10-09", "16:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-12", "12:00")); // Friday 16:00 → Monday 12:00
    expect(addWorkingTime(at("2026-10-10", "11:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-12", "13:00")); // Saturday 11:00 → Monday 13:00
    expect(addWorkingTime(at("2026-10-06", "10:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-06", "14:00")); // inside the day
    expect(addWorkingTime(at("2026-10-06", "07:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-06", "13:00")); // before the start
    expect(addWorkingTime(at("2026-10-06", "18:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-07", "13:00")); // after the end
    expect(addWorkingTime(at("2026-10-06", "13:00"), lagos, FOUR_HOURS)).toEqual(at("2026-10-06", "17:00")); // exactly to the end
  });

  it("is safe across a clock change (Europe/London)", () => {
    const london: WorkingSchedule = { timezone: "Europe/London", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
    // Friday 23 October 2026 16:00 BST, four working hours: Monday 26 October 12:00 GMT (the clocks went back on Sunday).
    expect(addWorkingTime(at("2026-10-23", "16:00", "Europe/London"), london, FOUR_HOURS).toISOString()).toBe("2026-10-26T12:00:00.000Z");
    // A Sunday window from 00:00 to 04:00 on the night the clocks go forward holds three real hours, not four.
    const night: WorkingSchedule = { timezone: "Europe/London", workingDays: [0], start: "00:00", end: "04:00" };
    expect(addWorkingTime(new Date("2026-03-28T23:00:00Z"), night, 3 * 3600).toISOString()).toBe("2026-03-29T03:00:00.000Z");
    expect(addWorkingTime(new Date("2026-03-28T23:00:00Z"), night, 4 * 3600).toISOString()).toBe("2026-04-05T00:00:00.000Z");
  });

  it("falls back to clock time with no working days, or past a month", () => {
    const none: WorkingSchedule = { ...lagos, workingDays: [] };
    const from = at("2026-10-10", "11:00");
    expect(addWorkingTime(from, none, FOUR_HOURS).getTime()).toBe(from.getTime() + FOUR_HOURS * 1000);
    expect(workingTimeBefore(from, none, FOUR_HOURS).getTime()).toBe(from.getTime() - FOUR_HOURS * 1000);
    const forever = 60 * 8 * 3600; // sixty working days: more than the walk looks at
    expect(addWorkingTime(from, lagos, forever).getTime()).toBe(from.getTime() + forever * 1000);
    expect(addWorkingTime(from, lagos, 0)).toEqual(from);
  });
});

describe("freshness (walking back)", () => {
  it("looks back one working day over working hours only", () => {
    const day = workingDaySeconds(lagos);
    expect(workingTimeBefore(at("2026-10-12", "10:00"), lagos, day)).toEqual(at("2026-10-09", "10:00")); // Monday 10:00 → Friday 10:00
    expect(workingTimeBefore(at("2026-10-07", "15:00"), lagos, day)).toEqual(at("2026-10-06", "15:00")); // Wednesday 15:00 → Tuesday 15:00
    expect(workingTimeBefore(at("2026-10-11", "12:00"), lagos, day)).toEqual(at("2026-10-09", "09:00")); // Sunday → the whole of Friday
    expect(workingTimeBefore(at("2026-10-07", "19:00"), lagos, day)).toEqual(at("2026-10-07", "09:00")); // the evening → this morning
    expect(workingTimeBefore(at("2026-10-07", "08:00"), lagos, day)).toEqual(at("2026-10-06", "09:00")); // before work → yesterday morning
  });
});
