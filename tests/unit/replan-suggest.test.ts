import { describe, it, expect } from "vitest";
import { REPLAN_MIN_WORKING_DAYS, suggestReplanDue } from "@/server/services/replan-suggest";

// The stalled re-plan's suggested date (owner decisions, 8 October 2026: phase 7b, contract F.3): at least two working
// days from now (or from a due date still ahead), longer for a bigger estimate, at the end of that working day. Pure.

const schedule = { timezone: "Africa/Lagos", workingDays: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
// Thursday 8 October 2026, 10:00 in Lagos (UTC+1).
const THU_10 = new Date("2026-10-08T09:00:00Z");

describe("suggestReplanDue", () => {
  it("two working days from now, at the end of that day", () => {
    expect(REPLAN_MIN_WORKING_DAYS).toBe(2);
    // Thu 10:00 plus 16 working hours is Mon 10:00; the end of Monday is 17:00 Lagos.
    expect(suggestReplanDue({ now: THU_10, previousDueAt: null, estimateMinutes: null, schedule }).toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });

  it("skips the weekend: asked on Saturday, it is Tuesday's end", () => {
    expect(suggestReplanDue({ now: new Date("2026-10-10T10:00:00Z"), previousDueAt: null, estimateMinutes: null, schedule }).toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("a bigger estimate takes more working days (20 hours: 3 days)", () => {
    expect(suggestReplanDue({ now: THU_10, previousDueAt: null, estimateMinutes: 20 * 60, schedule }).toISOString()).toBe("2026-10-13T16:00:00.000Z");
    // A small estimate never makes it shorter than two days.
    expect(suggestReplanDue({ now: THU_10, previousDueAt: null, estimateMinutes: 30, schedule }).toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });

  it("counts from the due date when it is still ahead, from now when it has passed", () => {
    // Due Wed 14 Oct 17:00 Lagos: two working days after it is Fri 16 Oct 17:00.
    expect(suggestReplanDue({ now: THU_10, previousDueAt: "2026-10-14T16:00:00Z", estimateMinutes: null, schedule }).toISOString()).toBe("2026-10-16T16:00:00.000Z");
    expect(suggestReplanDue({ now: THU_10, previousDueAt: "2026-10-01T16:00:00Z", estimateMinutes: null, schedule }).toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });

  it("always lands on a working day at the schedule's end time", () => {
    for (let h = 0; h < 24 * 7; h += 5) {
      const at = suggestReplanDue({ now: new Date(Date.UTC(2026, 9, 5, h)), previousDueAt: null, estimateMinutes: null, schedule });
      const local = new Date(at.getTime() + 3_600_000);
      expect([1, 2, 3, 4, 5]).toContain(local.getUTCDay());
      expect(`${local.getUTCHours()}:${local.getUTCMinutes()}`).toBe("17:0");
    }
  });
});
