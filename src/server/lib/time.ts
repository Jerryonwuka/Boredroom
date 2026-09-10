/**
 * Timezone helpers. Storage is UTC; IANA zones decide local-day allocation.
 * Nothing here mutates intervals — splitting is a reporting view only.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try { fmt(tz); return true; } catch { return false; }
}

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = fmt(timeZone).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

export function localDate(instant: Date | string, timeZone: string): string {
  const p = localParts(typeof instant === "string" ? new Date(instant) : instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** UTC offset (ms) of a zone at an instant. */
export function offsetAt(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the given local calendar date starts (local midnight), DST-safe. */
export function localMidnight(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Iterate: subtract the offset observed at the guess until stable (handles DST transitions).
  let t = guess - offsetAt(new Date(guess), timeZone);
  for (let i = 0; i < 3; i++) {
    const next = guess - offsetAt(new Date(t), timeZone);
    if (next === t) break;
    t = next;
  }
  // If midnight does not exist (spring-forward at 00:00), Intl yields the next valid local time.
  return new Date(t);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export type Interval = { startedAt: string; endedAt: string };
export type DaySlice = { localDate: string; startedAt: string; endedAt: string; seconds: number };

/** Splits an interval at local midnights. Seconds are computed on the exact instants; no seconds duplicated or lost. */
export function splitAtLocalMidnight(interval: Interval, timeZone: string): DaySlice[] {
  const start = new Date(interval.startedAt);
  const end = new Date(interval.endedAt);
  if (end <= start) return [];
  const out: DaySlice[] = [];
  let cursor = start;
  let date = localDate(cursor, timeZone);
  while (cursor < end) {
    const nextMidnight = localMidnight(addDays(date, 1), timeZone);
    const sliceEnd = nextMidnight < end ? nextMidnight : end;
    out.push({
      localDate: date,
      startedAt: cursor.toISOString(),
      endedAt: sliceEnd.toISOString(),
      seconds: Math.round((sliceEnd.getTime() - cursor.getTime()) / 1000),
    });
    cursor = sliceEnd;
    date = addDays(date, 1);
  }
  return out;
}

export function secondsBetween(a: string | Date, b: string | Date): number {
  const t1 = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const t2 = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.max(0, Math.round((t2 - t1) / 1000));
}

export function todayLocal(timeZone: string, now = new Date()): string {
  return localDate(now, timeZone);
}

/** Day of week 0..6 (Sunday=0) for a local date string. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
