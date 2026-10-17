/**
 * The work hours calculator's arithmetic (owner request, 17 October 2026: SEO analysis, Content Plan page 13). Pure
 * functions, no React and no network: the page runs them in the browser and the tests run them in Node. Everything is
 * counted in whole minutes, so 7 h 45 min is 465, never 7.75 rounded twice.
 *
 * - A time is typed freely: "9", "9:30", "0930", "9.30", "9:30am", "5pm", "17:30", "24:00" (an end at midnight).
 * - An end at or before its start is an overnight shift: it ends the next day, and all of it counts on the day it began.
 * - An unpaid break is minutes ("30") or hours and minutes ("1:15"); it comes off that shift.
 * - Overtime: time over the daily limit on each day, plus time over the weekly limit that wasn't already counted as daily
 *   overtime (so no minute is counted twice). Either limit can be off.
 */

export type Entry = { start: string; end: string; breakMinutes: string };
export type DayInput = { label: string; entries: Entry[] };
export type OvertimeRule = { daily: number | null; weekly: number | null };

export type EntryResult =
  | { kind: "empty" }
  | { kind: "error"; field: "start" | "end" | "break"; message: string }
  | { kind: "ok"; start: number; end: number; span: number; breakMinutes: number; worked: number; overnight: boolean };

const MINUTES_IN_DAY = 24 * 60;

/** Minutes after midnight for a typed time, 0 to 1440, or null when it isn't a time. */
export function parseTime(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?(am|pm|a|p)?$/.exec(s) ?? /^(\d{1,2})(\d{2})(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const half = m[3]?.[0];
  if (min > 59) return null;
  if (half) {
    if (h < 1 || h > 12) return null;
    if (half === "a") h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  }
  if (h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** An unpaid break in minutes: "30", "0:30", "1:15", "45m", "1h", "1.5h"; empty is no break; null when unreadable. */
export function parseBreak(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return 0;
  let m = /^(\d{1,4})(?:m|min|mins|minutes)?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2}(?:\.\d{1,2})?)(?:h|hr|hrs|hours)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d{1,2})h(\d{1,2})m?$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

export function entryResult(e: Entry): EntryResult {
  if (!e.start.trim() && !e.end.trim() && !e.breakMinutes.trim()) return { kind: "empty" };
  const start = parseTime(e.start);
  if (start === null) return { kind: "error", field: "start", message: e.start.trim() ? `"${e.start.trim()}" isn't a time. Try 09:00 or 9am.` : "Add a start time." };
  if (start === MINUTES_IN_DAY) return { kind: "error", field: "start", message: "A shift can't start at 24:00. Use 00:00." };
  const endRaw = parseTime(e.end);
  if (endRaw === null) return { kind: "error", field: "end", message: e.end.trim() ? `"${e.end.trim()}" isn't a time. Try 17:30 or 5:30pm.` : "Add an end time." };
  if (endRaw === start) return { kind: "error", field: "end", message: "The end is the same as the start." };
  const overnight = endRaw < start;
  const end = overnight ? endRaw + MINUTES_IN_DAY : endRaw;
  const span = end - start;
  const breakMinutes = parseBreak(e.breakMinutes);
  if (breakMinutes === null) return { kind: "error", field: "break", message: `"${e.breakMinutes.trim()}" isn't a break length. Use minutes, such as 30.` };
  if (breakMinutes >= span) return { kind: "error", field: "break", message: "The break is as long as the shift, or longer." };
  return { kind: "ok", start, end, span, breakMinutes, worked: span - breakMinutes, overnight };
}

export type DayResult = { label: string; entries: EntryResult[]; worked: number; breaks: number; overtime: number; errors: number };
export type WeekResult = {
  days: DayResult[];
  worked: number;
  breaks: number;
  dailyOvertime: number;
  weeklyOvertime: number;
  overtime: number;
  regular: number;
  errors: number;
};

export function calculate(days: readonly DayInput[], rule: OvertimeRule): WeekResult {
  const dailyLimit = rule.daily === null ? null : Math.round(rule.daily * 60);
  const weeklyLimit = rule.weekly === null ? null : Math.round(rule.weekly * 60);
  const results: DayResult[] = days.map((d) => {
    const entries = d.entries.map(entryResult);
    let worked = 0, breaks = 0, errors = 0;
    for (const r of entries) {
      if (r.kind === "ok") { worked += r.worked; breaks += r.breakMinutes; }
      else if (r.kind === "error") errors++;
    }
    const overtime = dailyLimit === null ? 0 : Math.max(0, worked - dailyLimit);
    return { label: d.label, entries, worked, breaks, overtime, errors };
  });
  const worked = results.reduce((n, d) => n + d.worked, 0);
  const breaks = results.reduce((n, d) => n + d.breaks, 0);
  const dailyOvertime = results.reduce((n, d) => n + d.overtime, 0);
  const weeklyOvertime = weeklyLimit === null ? 0 : Math.max(0, worked - dailyOvertime - weeklyLimit);
  const overtime = dailyOvertime + weeklyOvertime;
  return { days: results, worked, breaks, dailyOvertime, weeklyOvertime, overtime, regular: worked - overtime, errors: results.reduce((n, d) => n + d.errors, 0) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 465 → "7:45" (hours and minutes, as a timesheet writes it). */
export function formatHM(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** 465 → "7.75" (decimal hours, two places, as payroll wants it). */
export function formatDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** 465 → "7 h 45 min"; 480 → "8 h"; 30 → "30 min". */
export function formatSpoken(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Minutes after midnight → "09:05" (a time past midnight shows as the next day's clock time). */
export function formatClock(minutes: number): string {
  const t = minutes % MINUTES_IN_DAY;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** The overtime rule in plain words, as the result shows it. */
export function describeRule(rule: OvertimeRule, single = false): string {
  const d = rule.daily, w = single ? null : rule.weekly;
  const hrs = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;
  if (d !== null && w !== null) return `Overtime here is time over ${hrs(d)} in a day, plus time over ${hrs(w)} in the week that wasn't already counted as daily overtime.`;
  if (d !== null) return `Overtime here is time over ${hrs(d)} in a day.`;
  if (w !== null) return `Overtime here is time over ${hrs(w)} in the week.`;
  return "Overtime is off: every hour counts as regular time.";
}

/** Pay before tax: regular hours at the rate, overtime at rate × multiplier. Null when no rate is given. */
export function pay(result: Pick<WeekResult, "regular" | "overtime">, rate: number | null, multiplier: number): { regular: number; overtime: number; total: number } | null {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return null;
  const regular = (result.regular / 60) * rate;
  const overtime = (result.overtime / 60) * rate * multiplier;
  return { regular, overtime, total: regular + overtime };
}

/** A plain-text summary to copy or save. */
export function summaryText(result: WeekResult, rule: OvertimeRule, single: boolean): string {
  const lines: string[] = [single ? "Work hours, one day" : "Work hours, one week", ""];
  for (const d of result.days) {
    const shifts = d.entries.filter((e): e is Extract<EntryResult, { kind: "ok" }> => e.kind === "ok");
    if (!shifts.length) { if (!single) lines.push(`${d.label}: no hours`); continue; }
    const parts = shifts.map((s) => `${formatClock(s.start)} to ${formatClock(s.end)}${s.overnight ? " (next day)" : ""}${s.breakMinutes ? `, ${s.breakMinutes} min break` : ""}`);
    lines.push(`${d.label}: ${parts.join("; ")} = ${formatHM(d.worked)} (${formatDecimal(d.worked)} h)`);
  }
  lines.push(
    "",
    `Total worked: ${formatHM(result.worked)} (${formatDecimal(result.worked)} h)`,
    `Regular: ${formatHM(result.regular)} (${formatDecimal(result.regular)} h)`,
    `Overtime: ${formatHM(result.overtime)} (${formatDecimal(result.overtime)} h)`,
    `Unpaid breaks: ${formatHM(result.breaks)}`,
    "",
    describeRule(rule, single),
  );
  return lines.join("\n");
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The shifts as CSV, one row a shift, for a spreadsheet. */
export function timesheetCsv(result: WeekResult): string {
  const rows = [["Day", "Start", "End", "Ends next day", "Unpaid break (min)", "Worked (h:mm)", "Worked (decimal h)"]];
  for (const d of result.days) {
    for (const e of d.entries) {
      if (e.kind !== "ok") continue;
      rows.push([d.label, formatClock(e.start), formatClock(e.end), e.overnight ? "yes" : "no", String(e.breakMinutes), formatHM(e.worked), formatDecimal(e.worked)]);
    }
  }
  rows.push([], ["Total worked", "", "", "", String(result.breaks), formatHM(result.worked), formatDecimal(result.worked)]);
  rows.push(["Regular", "", "", "", "", formatHM(result.regular), formatDecimal(result.regular)]);
  rows.push(["Overtime", "", "", "", "", formatHM(result.overtime), formatDecimal(result.overtime)]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
