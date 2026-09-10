import { describe, expect, it } from "vitest";
import { splitAtLocalMidnight, localMidnight, localDate, addDays, isValidTimeZone } from "@/server/lib/time";
import { csvCell } from "@/server/services/reports";

describe("A09 local-day allocation", () => {
  it("splits an overnight Lagos interval at local midnight without losing seconds", () => {
    const slices = splitAtLocalMidnight({ startedAt: "2026-03-10T22:30:00Z", endedAt: "2026-03-11T01:15:00Z" }, "Africa/Lagos");
    // Lagos is UTC+1: 23:30 local → 02:15 next day local.
    expect(slices.map((s) => s.localDate)).toEqual(["2026-03-10", "2026-03-11"]);
    expect(slices[0].seconds).toBe(30 * 60);
    expect(slices[1].seconds).toBe(135 * 60);
    expect(slices.reduce((a, s) => a + s.seconds, 0)).toBe(165 * 60);
    expect(slices[0].endedAt).toBe(slices[1].startedAt);
  });

  it("handles a spring-forward DST night in London (23:00 → 03:00 local) with no duplicated seconds", () => {
    // 2026-03-29 01:00 UTC clocks go forward in Europe/London.
    const slices = splitAtLocalMidnight({ startedAt: "2026-03-28T23:00:00Z", endedAt: "2026-03-29T02:00:00Z" }, "Europe/London");
    expect(slices.map((s) => s.localDate)).toEqual(["2026-03-28", "2026-03-29"]);
    expect(slices[0].seconds).toBe(3600);
    expect(slices[1].seconds).toBe(7200);
    expect(slices.reduce((a, s) => a + s.seconds, 0)).toBe(3 * 3600);
  });

  it("handles a fall-back DST night in New York (25-hour day)", () => {
    // 2026-11-01 06:00 UTC clocks go back in America/New_York; local day is 25 hours.
    const start = localMidnight("2026-11-01", "America/New_York");
    const end = localMidnight("2026-11-02", "America/New_York");
    expect((end.getTime() - start.getTime()) / 3600000).toBe(25);
    const slices = splitAtLocalMidnight({ startedAt: start.toISOString(), endedAt: end.toISOString() }, "America/New_York");
    expect(slices).toHaveLength(1);
    expect(slices[0].seconds).toBe(25 * 3600);
  });

  it("computes local midnight correctly for a zone with a half-hour offset", () => {
    const m = localMidnight("2026-06-01", "Asia/Kolkata");
    expect(m.toISOString()).toBe("2026-05-31T18:30:00.000Z");
    expect(localDate(m, "Asia/Kolkata")).toBe("2026-06-01");
  });

  it("returns nothing for empty or inverted intervals and validates zones", () => {
    expect(splitAtLocalMidnight({ startedAt: "2026-01-01T10:00:00Z", endedAt: "2026-01-01T10:00:00Z" }, "UTC")).toEqual([]);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("A20 CSV formula safety", () => {
  it("neutralises formula prefixes and quotes separators", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(120)).toBe("120");
    expect(csvCell(null)).toBe("");
  });
});
