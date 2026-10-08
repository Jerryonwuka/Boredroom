/**
 * When a routine runs and when the person is quiet (owner decision, 8 October 2026: phase 7a). Pure functions: every
 * cadence, the end of short months, the days the clocks change (a skipped time runs at the instant localTimeOn gives,
 * a repeated time runs once), an `after` exactly on a run time, overnight quiet windows and the person's zone.
 * Africa/Lagos is UTC+1 all year; Thursday 8 October 2026 is the running example's day.
 */
import { describe, expect, it } from "vitest";
import { lastDayOfMonth, matchesDay, nextRunAt, personTimeZone, quietState, quietWindowAt } from "@/server/lib/routine-time";
import type { QuietHours } from "@/lib/routines";

const LAGOS = "Africa/Lagos";
const at = (iso: string) => new Date(iso);
const next = (...a: Parameters<typeof nextRunAt>) => nextRunAt(...a).toISOString();

describe("nextRunAt", () => {
  it("daily: later today, else tomorrow", () => {
    expect(next({ kind: "daily" }, "09:00", LAGOS, at("2026-10-08T07:00:00Z"))).toBe("2026-10-08T08:00:00.000Z");
    expect(next({ kind: "daily" }, "09:00", LAGOS, at("2026-10-08T08:30:00Z"))).toBe("2026-10-09T08:00:00.000Z");
  });

  it("an `after` exactly on a run time gives the next one", () => {
    expect(next({ kind: "daily" }, "09:00", LAGOS, at("2026-10-08T08:00:00Z"))).toBe("2026-10-09T08:00:00.000Z");
    expect(next({ kind: "weekly", days: [5] }, "16:00", LAGOS, at("2026-10-09T15:00:00Z"))).toBe("2026-10-16T15:00:00.000Z");
  });

  it("weekdays skip Saturday and Sunday", () => {
    // Friday 9 October, 10:00 Lagos: the next weekday 09:00 is Monday 12 October.
    expect(next({ kind: "weekdays" }, "09:00", LAGOS, at("2026-10-09T09:00:00Z"))).toBe("2026-10-12T08:00:00.000Z");
    expect(next({ kind: "weekdays" }, "09:00", LAGOS, at("2026-10-10T12:00:00Z"))).toBe("2026-10-12T08:00:00.000Z");
  });

  it("weekly on chosen days", () => {
    // Every Friday at 16:00, from Thursday: tomorrow.
    expect(next({ kind: "weekly", days: [5] }, "16:00", LAGOS, at("2026-10-08T12:00:00Z"))).toBe("2026-10-09T15:00:00.000Z");
    // Monday and Thursday at 08:30, from Thursday 09:00 (08:30 has gone): Monday.
    expect(next({ kind: "weekly", days: [1, 4] }, "08:30", LAGOS, at("2026-10-08T08:00:00Z"))).toBe("2026-10-12T07:30:00.000Z");
    // …and from Monday 09:00: Thursday.
    expect(next({ kind: "weekly", days: [1, 4] }, "08:30", LAGOS, at("2026-10-12T08:00:00Z"))).toBe("2026-10-15T07:30:00.000Z");
  });

  it("monthly: a day past the month's end runs on its last day, never twice", () => {
    expect(next({ kind: "monthly", day: 31 }, "09:00", LAGOS, at("2026-04-01T00:00:00Z"))).toBe("2026-04-30T08:00:00.000Z");
    expect(next({ kind: "monthly", day: 31 }, "09:00", LAGOS, at("2026-04-30T08:00:00Z"))).toBe("2026-05-31T08:00:00.000Z");
    expect(next({ kind: "monthly", day: 31 }, "09:00", LAGOS, at("2027-02-01T00:00:00Z"))).toBe("2027-02-28T08:00:00.000Z");
    expect(next({ kind: "monthly", day: 31 }, "09:00", LAGOS, at("2028-02-01T00:00:00Z"))).toBe("2028-02-29T08:00:00.000Z");
    // The 29th in February 2027 is the 28th, and March runs on the 29th (once).
    expect(next({ kind: "monthly", day: 29 }, "09:00", LAGOS, at("2027-02-01T00:00:00Z"))).toBe("2027-02-28T08:00:00.000Z");
    expect(next({ kind: "monthly", day: 29 }, "09:00", LAGOS, at("2027-02-28T08:00:00Z"))).toBe("2027-03-29T08:00:00.000Z");
    expect(next({ kind: "monthly", day: 1 }, "09:00", LAGOS, at("2026-10-08T00:00:00Z"))).toBe("2026-11-01T08:00:00.000Z");
  });

  it("monthly day 0 is the last day of every month", () => {
    expect(next({ kind: "monthly", day: 0 }, "17:00", LAGOS, at("2026-10-08T00:00:00Z"))).toBe("2026-10-31T16:00:00.000Z");
    expect(next({ kind: "monthly", day: 0 }, "17:00", LAGOS, at("2026-10-31T16:00:00Z"))).toBe("2026-11-30T16:00:00.000Z");
    expect(next({ kind: "monthly", day: 0 }, "17:00", LAGOS, at("2028-02-01T00:00:00Z"))).toBe("2028-02-29T16:00:00.000Z");
  });

  it("Europe/London: a time the clocks skip runs at the instant localTimeOn gives (02:30 BST)", () => {
    // 29 March 2026: 01:00 GMT becomes 02:00 BST, so 01:30 never happens; it runs at 01:30Z = 02:30 BST.
    expect(next({ kind: "daily" }, "01:30", "Europe/London", at("2026-03-28T12:00:00Z"))).toBe("2026-03-29T01:30:00.000Z");
    // And the day after, at 01:30 BST again.
    expect(next({ kind: "daily" }, "01:30", "Europe/London", at("2026-03-29T01:30:00Z"))).toBe("2026-03-30T00:30:00.000Z");
  });

  it("Europe/London: a time that happens twice runs once, at the first", () => {
    // 25 October 2026: 02:00 BST becomes 01:00 GMT, so 01:30 happens at 00:30Z (BST) and again at 01:30Z (GMT).
    expect(next({ kind: "daily" }, "01:30", "Europe/London", at("2026-10-24T12:00:00Z"))).toBe("2026-10-25T00:30:00.000Z");
    expect(next({ kind: "daily" }, "01:30", "Europe/London", at("2026-10-25T00:30:00Z"))).toBe("2026-10-26T01:30:00.000Z");
    expect(next({ kind: "daily" }, "01:30", "Europe/London", at("2026-10-25T00:45:00Z"))).toBe("2026-10-26T01:30:00.000Z");
  });

  it("America/New_York: across both changes", () => {
    // 8 March 2026: 02:00 EST becomes 03:00 EDT; 02:30 runs at 07:30Z (03:30 EDT).
    expect(next({ kind: "daily" }, "02:30", "America/New_York", at("2026-03-07T12:00:00Z"))).toBe("2026-03-08T07:30:00.000Z");
    // Weekdays at 09:00: Friday 30 October in EDT, Monday 2 November in EST.
    expect(next({ kind: "weekdays" }, "09:00", "America/New_York", at("2026-10-30T12:00:00Z"))).toBe("2026-10-30T13:00:00.000Z");
    expect(next({ kind: "weekdays" }, "09:00", "America/New_York", at("2026-10-30T14:00:00Z"))).toBe("2026-11-02T14:00:00.000Z");
  });

  it("refuses what is not a time or a cadence that never runs", () => {
    expect(() => nextRunAt({ kind: "daily" }, "25:00", LAGOS, at("2026-10-08T00:00:00Z"))).toThrow();
    expect(() => nextRunAt({ kind: "weekly", days: [] }, "09:00", LAGOS, at("2026-10-08T00:00:00Z"))).toThrow();
  });
});

describe("matchesDay and lastDayOfMonth", () => {
  it("knows the days", () => {
    expect(matchesDay({ kind: "weekdays" }, "2026-10-10")).toBe(false); // Saturday
    expect(matchesDay({ kind: "weekdays" }, "2026-10-12")).toBe(true); // Monday
    expect(matchesDay({ kind: "weekly", days: [0] }, "2026-10-11")).toBe(true); // Sunday
    expect(matchesDay({ kind: "monthly", day: 31 }, "2026-04-30")).toBe(true);
    expect(matchesDay({ kind: "monthly", day: 30 }, "2026-02-28")).toBe(true);
    expect(matchesDay({ kind: "monthly", day: 0 }, "2026-10-30")).toBe(false);
    expect(lastDayOfMonth("2026-02-10")).toBe(28);
    expect(lastDayOfMonth("2028-02-10")).toBe(29);
    expect(lastDayOfMonth("2026-04-01")).toBe(30);
    expect(lastDayOfMonth("2026-12-31")).toBe(31);
  });
});

describe("quiet hours", () => {
  // Friday 22:00 to 07:00: quiet from Friday 22:00 to Saturday 07:00 (Friday is the day it starts on).
  const friNight: QuietHours = { enabled: true, start: "22:00", end: "07:00", days: [5], ownTimezone: null, timezone: LAGOS };

  it("an overnight window: active until its end, not after, and only from the chosen days", () => {
    expect(quietWindowAt(friNight as { start: string; end: string; days: number[] }, LAGOS, at("2026-10-09T20:59:00Z"))).toBeNull(); // Fri 21:59
    expect(quietWindowAt(friNight as { start: string; end: string; days: number[] }, LAGOS, at("2026-10-09T21:00:00Z"))).toEqual({ start: at("2026-10-09T21:00:00Z"), end: at("2026-10-10T06:00:00Z") });
    const sat0659 = quietState(friNight, LAGOS, at("2026-10-10T05:59:00Z"));
    expect(sat0659).toEqual({ ready: true, active: true, until: "2026-10-10T06:00:00.000Z", nextStart: "2026-10-16T21:00:00.000Z" });
    expect(quietState(friNight, LAGOS, at("2026-10-10T06:00:00Z")).active).toBe(false); // Sat 07:00
    expect(quietState(friNight, LAGOS, at("2026-10-10T21:00:00Z")).active).toBe(false); // Sat 22:00: Saturday not chosen
  });

  it("nextStart is the next window's start", () => {
    expect(quietState(friNight, LAGOS, at("2026-10-08T12:00:00Z"))).toEqual({ ready: true, active: false, until: null, nextStart: "2026-10-09T21:00:00.000Z" });
    const daily: QuietHours = { ...friNight, start: "12:00", end: "13:00", days: [0, 1, 2, 3, 4, 5, 6] };
    expect(quietState(daily, LAGOS, at("2026-10-08T11:30:00Z"))).toEqual({ ready: true, active: true, until: "2026-10-08T12:00:00.000Z", nextStart: "2026-10-09T11:00:00.000Z" });
  });

  it("off, unset, or before 0046: never quiet", () => {
    expect(quietState({ ...friNight, enabled: false }, LAGOS, at("2026-10-10T05:59:00Z"))).toEqual({ ready: true, active: false, until: null, nextStart: null });
    expect(quietState(null, LAGOS, at("2026-10-10T05:59:00Z"))).toEqual({ ready: true, active: false, until: null, nextStart: null });
    expect(quietState({ ...friNight, days: [] }, LAGOS, at("2026-10-10T05:59:00Z")).active).toBe(false);
    expect(quietState(friNight, LAGOS, at("2026-10-10T05:59:00Z"), false)).toEqual({ ready: false, active: false, until: null, nextStart: null });
  });

  it("follows the person's zone across a clock change", () => {
    // London, 22:00 to 07:00 every night: the night of 24 to 25 October ends at 07:00 GMT.
    const nightly: QuietHours = { enabled: true, start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6], ownTimezone: "Europe/London", timezone: "Europe/London" };
    expect(quietState(nightly, "Europe/London", at("2026-10-25T06:30:00Z"))).toMatchObject({ active: true, until: "2026-10-25T07:00:00.000Z" });
    expect(quietState(nightly, "Europe/London", at("2026-10-24T20:30:00Z")).active).toBe(false); // 21:30 BST
    expect(quietState(nightly, "Europe/London", at("2026-10-24T21:00:00Z")).active).toBe(true); // 22:00 BST
  });
});

describe("personTimeZone", () => {
  it("is the person's own when known, else the organisation's", () => {
    expect(personTimeZone("Europe/London", LAGOS)).toBe("Europe/London");
    expect(personTimeZone(null, LAGOS)).toBe(LAGOS);
    expect(personTimeZone(undefined, LAGOS)).toBe(LAGOS);
    expect(personTimeZone("Mars/Olympus_Mons", LAGOS)).toBe(LAGOS);
    expect(personTimeZone("not a zone!", LAGOS)).toBe(LAGOS);
  });
});
