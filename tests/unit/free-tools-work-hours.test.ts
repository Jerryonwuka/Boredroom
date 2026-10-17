import { describe, expect, it } from "vitest";
import { calculate, describeRule, entryResult, formatDecimal, formatHM, parseBreak, parseTime, pay, summaryText, timesheetCsv } from "@/components/marketing/tools/work-hours";

// The work hours calculator's arithmetic (owner request, 17 October 2026: SEO analysis, Content Plan page 13): the page
// shows the working, so the sums must be exactly right.

const shift = (start: string, end: string, breakMinutes = "") => ({ start, end, breakMinutes });

describe("parseTime", () => {
  it.each([
    ["9", 540], ["09:00", 540], ["9:30", 570], ["0930", 570], ["930", 570], ["9.30", 570], ["17:30", 1050], ["1730", 1050],
    ["9am", 540], ["9:30 am", 570], ["5pm", 1020], ["5:30pm", 1050], ["12am", 0], ["12pm", 720], ["12:15a", 15], ["00:00", 0], ["24:00", 1440],
  ])("%s → %i", (s, m) => expect(parseTime(s)).toBe(m));
  it.each(["", "abc", "25:00", "9:60", "13pm", "0am", "24:30", "9:5"])("rejects %j", (s) => expect(parseTime(s)).toBeNull());
});

describe("parseBreak", () => {
  it.each([["", 0], ["30", 30], ["0:30", 30], ["1:15", 75], ["45m", 45], ["45 min", 45], ["1h", 60], ["1.5h", 90], ["1h30", 90]])("%j → %i", (s, m) => expect(parseBreak(s)).toBe(m));
  it.each(["half", "1:75", "-5"])("rejects %j", (s) => expect(parseBreak(s)).toBeNull());
});

describe("entryResult", () => {
  it("takes the break off the span", () => {
    expect(entryResult(shift("09:00", "17:30", "30"))).toMatchObject({ kind: "ok", span: 510, worked: 480, overnight: false });
  });
  it("reads an end before the start as the next day", () => {
    expect(entryResult(shift("22:00", "06:00"))).toMatchObject({ kind: "ok", span: 480, worked: 480, overnight: true });
    expect(entryResult(shift("18:00", "00:00"))).toMatchObject({ kind: "ok", worked: 360, overnight: true });
    expect(entryResult(shift("18:00", "24:00"))).toMatchObject({ kind: "ok", worked: 360, overnight: false });
  });
  it("names the field that is wrong", () => {
    expect(entryResult(shift("", "", ""))).toEqual({ kind: "empty" });
    expect(entryResult(shift("nine", "17:00"))).toMatchObject({ kind: "error", field: "start" });
    expect(entryResult(shift("09:00", ""))).toMatchObject({ kind: "error", field: "end" });
    expect(entryResult(shift("09:00", "09:00"))).toMatchObject({ kind: "error", field: "end" });
    expect(entryResult(shift("09:00", "10:00", "60"))).toMatchObject({ kind: "error", field: "break" });
    expect(entryResult(shift("24:00", "08:00"))).toMatchObject({ kind: "error", field: "start" });
  });
});

describe("calculate", () => {
  const week = (entries: ReturnType<typeof shift>[][]) => entries.map((e, i) => ({ label: `Day ${i + 1}`, entries: e }));

  it("adds split shifts on one day", () => {
    const r = calculate(week([[shift("07:00", "11:00"), shift("16:00", "20:00")]]), { daily: null, weekly: null });
    expect(r.worked).toBe(480);
    expect(r.overtime).toBe(0);
  });

  it("counts daily overtime per day", () => {
    const r = calculate(week([[shift("08:00", "18:00", "30")]]), { daily: 8, weekly: null });
    expect(r.worked).toBe(570);
    expect(r.dailyOvertime).toBe(90);
    expect(r.regular).toBe(480);
  });

  it("never counts a minute twice with daily and weekly limits", () => {
    // Five 9-hour days: 45 h. Daily over 8: 5 h. The remaining 40 h are not over 40, so no weekly overtime.
    const days = week(Array.from({ length: 5 }, () => [shift("08:00", "17:00")]));
    const both = calculate(days, { daily: 8, weekly: 40 });
    expect(both.worked).toBe(45 * 60);
    expect(both.dailyOvertime).toBe(5 * 60);
    expect(both.weeklyOvertime).toBe(0);
    expect(both.overtime).toBe(5 * 60);
    // Weekly only (the US federal rule): 5 h over 40.
    const weekly = calculate(days, { daily: null, weekly: 40 });
    expect(weekly.overtime).toBe(5 * 60);
    // Six 8-hour days with both limits: no daily overtime, 8 h over 40 in the week.
    const six = calculate(week(Array.from({ length: 6 }, () => [shift("09:00", "17:00")])), { daily: 8, weekly: 40 });
    expect(six.dailyOvertime).toBe(0);
    expect(six.weeklyOvertime).toBe(8 * 60);
    expect(six.regular).toBe(40 * 60);
  });

  it("leaves shifts with errors out and counts them", () => {
    const r = calculate(week([[shift("09:00", "17:00"), shift("x", "y")]]), { daily: null, weekly: null });
    expect(r.worked).toBe(480);
    expect(r.errors).toBe(1);
  });
});

describe("formats", () => {
  it("writes hours and minutes and decimal hours", () => {
    expect(formatHM(465)).toBe("7:45");
    expect(formatHM(5)).toBe("0:05");
    expect(formatDecimal(465)).toBe("7.75");
    expect(formatDecimal(10)).toBe("0.17");
  });
  it("says the rule in words", () => {
    expect(describeRule({ daily: 8, weekly: 40 })).toContain("over 8 hours in a day, plus time over 40 hours in the week");
    expect(describeRule({ daily: 8, weekly: 40 }, true)).toBe("Overtime here is time over 8 hours in a day.");
    expect(describeRule({ daily: null, weekly: null })).toContain("off");
  });
  it("works out pay before tax", () => {
    expect(pay({ regular: 2400, overtime: 120 }, 10, 1.5)).toEqual({ regular: 400, overtime: 30, total: 430 });
    expect(pay({ regular: 60, overtime: 0 }, null, 1.5)).toBeNull();
  });
  it("writes a summary and a CSV", () => {
    const r = calculate([{ label: "Monday", entries: [shift("22:00", "06:00", "30")] }], { daily: 8, weekly: 40 });
    expect(summaryText(r, { daily: 8, weekly: 40 }, false)).toContain("Monday: 22:00 to 06:00 (next day), 30 min break = 7:30 (7.50 h)");
    const csv = timesheetCsv(r);
    expect(csv.split("\n")[0]).toBe("Day,Start,End,Ends next day,Unpaid break (min),Worked (h:mm),Worked (decimal h)");
    expect(csv).toContain("Monday,22:00,06:00,yes,30,7:30,7.50");
  });
});
