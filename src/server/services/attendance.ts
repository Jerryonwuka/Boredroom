/**
 * Clocking in and out. One record per person per local day; everyone in the organisation clocks
 * (staff, team leads, owner, HR). "Late" is measured against the organisation schedule plus a grace
 * period, both captured on the record so a later schedule change does not rewrite history.
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { conflict, forbidden } from "@/server/lib/errors";
import { audit } from "@/server/services/common";
import { localMidnight, todayLocal, addDays, weekdayOf } from "@/server/lib/time";

export type Schedule = { timezone: string; working_days: number[]; start_local: string; end_local: string; clock_grace_minutes: number };
export type AttendanceRow = {
  id: string; membership_id: string; local_date: string; clock_in_at: string; clock_out_at: string | null; late_seconds: number; left_early_seconds: number | null;
  scheduled_start: string; scheduled_end: string; grace_minutes: number; timezone: string;
};
export type ClockStatus = "not_in" | "in" | "out";

export async function scheduleFor(db: Db, orgId: string, fallbackTz: string): Promise<Schedule> {
  const s = await db.maybeOne<Schedule>(`SELECT timezone, working_days, start_local, end_local, clock_grace_minutes FROM schedules WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1`, [orgId]);
  return s ?? { timezone: fallbackTz, working_days: [1, 2, 3, 4, 5], start_local: "09:00:00", end_local: "17:00:00", clock_grace_minutes: 0 };
}

/** The instant a local time-of-day falls on a local date (DST-safe). */
export function instantOf(dateStr: string, timeLocal: string, timeZone: string): Date {
  const [h, m] = timeLocal.split(":").map(Number);
  return new Date(localMidnight(dateStr, timeZone).getTime() + (h * 60 + m) * 60_000);
}

export function statusOf(r: { clock_in_at: string; clock_out_at: string | null } | null): ClockStatus {
  return !r ? "not_in" : r.clock_out_at ? "out" : "in";
}

/** Clocks the caller in for today. Idempotent: a second press returns the existing record. */
export async function clockIn(ctx: OrgContext, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const s = await scheduleFor(db, ctx.org.id, ctx.org.timezone);
    const now = new Date();
    const today = todayLocal(s.timezone, now);
    const existing = await db.maybeOne<AttendanceRow>(`SELECT * FROM attendance_days WHERE membership_id = $1 AND local_date = $2`, [ctx.membership.id, today]);
    if (existing) return { record: existing, already: true as const };
    const start = instantOf(today, s.start_local, s.timezone).getTime() + s.clock_grace_minutes * 60_000;
    const late = Math.max(0, Math.round((now.getTime() - start) / 1000));
    const record = await db.one<AttendanceRow>(
      `INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, grace_minutes, clock_in_at, late_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [ctx.org.id, ctx.membership.id, today, s.timezone, s.start_local, s.end_local, s.clock_grace_minutes, now.toISOString(), late]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "attendance.clock_in", subjectType: "attendance", subjectId: record.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { localDate: today, lateSeconds: late } });
    return { record, already: false as const };
  });
}

/** Clocks the caller out for today. */
export async function clockOut(ctx: OrgContext, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const s = await scheduleFor(db, ctx.org.id, ctx.org.timezone);
    const now = new Date();
    const today = todayLocal(s.timezone, now);
    const rec = await db.maybeOne<AttendanceRow>(`SELECT * FROM attendance_days WHERE membership_id = $1 AND local_date = $2 FOR UPDATE`, [ctx.membership.id, today]);
    if (!rec) throw conflict("NOT_CLOCKED_IN", "You have not clocked in today, so there is nothing to clock out from.");
    if (rec.clock_out_at) return { record: rec, already: true as const };
    const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE membership_id = $1 AND state IN ('running','paused','interrupted')`, [ctx.membership.id]);
    if (open) throw conflict("SESSION_OPEN", "Stop your running timer before clocking out.");
    const end = instantOf(rec.local_date, rec.scheduled_end, rec.timezone).getTime();
    const early = Math.max(0, Math.round((end - now.getTime()) / 1000));
    const record = await db.one<AttendanceRow>(`UPDATE attendance_days SET clock_out_at = $2, left_early_seconds = $3 WHERE id = $1 RETURNING *`, [rec.id, now.toISOString(), early]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "attendance.clock_out", subjectType: "attendance", subjectId: record.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { localDate: today, leftEarlySeconds: early } });
    return { record, already: false as const };
  });
}

/** "YYYY-MM" → first and last local date of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
export const isMonth = (v: string | undefined | null): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** The caller's clock for today plus one month of history (the current month unless another is asked for). */
export async function myClock(ctx: OrgContext, opts: { month?: string | null } = {}) {
  return withUser(ctx.user.profileId, async (db) => {
    const s = await scheduleFor(db, ctx.org.id, ctx.org.timezone);
    const now = new Date();
    const today = todayLocal(s.timezone, now);
    const month = isMonth(opts.month) ? opts.month : today.slice(0, 7);
    const range = monthRange(month);
    const rows = await db.query<AttendanceRow>(`SELECT * FROM attendance_days WHERE membership_id = $1 AND (local_date = $2 OR local_date BETWEEN $3 AND $4) ORDER BY local_date DESC`, [ctx.membership.id, today, range.from, range.to]);
    const todayRow = rows.find((r) => r.local_date === today) ?? null;
    const running = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE membership_id = $1 AND state IN ('running','paused','interrupted')`, [ctx.membership.id]);
    const history = rows.filter((r) => r.local_date !== today && r.local_date >= range.from && r.local_date <= range.to);
    const workingDaysSoFar = daysOf(range.from, month === today.slice(0, 7) ? addDays(today, -1) : range.to).filter((d) => s.working_days.includes(weekdayOf(d)));
    return {
      today, month, schedule: s, workingDay: s.working_days.includes(weekdayOf(today)), record: todayRow, status: statusOf(todayRow),
      history, summary: { present: history.length, late: history.filter((h) => h.late_seconds > 0).length, missed: workingDaysSoFar.filter((d) => !history.some((h) => h.local_date === d)).length },
      serverNow: now.toISOString(), timerOpen: !!running,
      scheduledStartAt: instantOf(today, s.start_local, s.timezone).toISOString(), scheduledEndAt: instantOf(today, s.end_local, s.timezone).toISOString(),
    };
  });
}

/** Every local date from `from` to `to` inclusive (empty when `to` is before `from`). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type BoardRow = {
  membership_id: string; display_name: string; employee_code: string; role: string; teams: string[];
  clock_in_at: string | null; clock_out_at: string | null; late_seconds: number | null; left_early_seconds: number | null; status: ClockStatus;
};

/**
 * Who has clocked in on a given day, who has not, and who has already left. Organisation accounts see everyone;
 * team leads see the people on their teams (and themselves). Staff have no board.
 */
export async function attendanceBoard(ctx: OrgContext, opts: { date?: string; teamId?: string | null } = {}) {
  if (ctx.membership.role === "employee") throw forbidden("Attendance boards are for team leads and organisation accounts.");
  const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  const wanted = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : null;
  return withUser(ctx.user.profileId, async (db) => {
    // One statement: the schedule in force, the local date it implies, the people and the team filter list, as JSON.
    // The board runs on every dashboard load and the database may be far away, so round trips are the cost that matters.
    const r = await db.one<{ schedule: Schedule; date: string; today: string; people: (Omit<BoardRow, "status">)[] | null; teams: { id: string; name: string }[] | null }>(
      `WITH sched AS (
         SELECT timezone, working_days, start_local, end_local, clock_grace_minutes FROM schedules
         WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1
       ), s AS (
         SELECT COALESCE((SELECT timezone FROM sched), $6::text) AS timezone,
                COALESCE((SELECT working_days FROM sched), '{1,2,3,4,5}'::int[]) AS working_days,
                COALESCE((SELECT start_local FROM sched), '09:00:00'::time)::text AS start_local,
                COALESCE((SELECT end_local FROM sched), '17:00:00'::time)::text AS end_local,
                COALESCE((SELECT clock_grace_minutes FROM sched), 0)::int AS clock_grace_minutes
       ), d AS (
         SELECT (now() AT TIME ZONE (SELECT timezone FROM s))::date AS today,
                COALESCE($2::date, (now() AT TIME ZONE (SELECT timezone FROM s))::date) AS date
       )
       SELECT (SELECT row_to_json(s) FROM s) AS schedule, (SELECT date::text FROM d) AS date, (SELECT today::text FROM d) AS today,
         (SELECT json_agg(p ORDER BY p.clock_in_at NULLS LAST, p.display_name) FROM (
            SELECT m.id AS membership_id, pr.display_name, m.employee_code, m.role,
                   COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL), '{}') AS teams,
                   a.clock_in_at, a.clock_out_at, a.late_seconds, a.left_early_seconds
            FROM memberships m JOIN profiles pr ON pr.id = m.user_id
            LEFT JOIN attendance_days a ON a.membership_id = m.id AND a.local_date = (SELECT date FROM d)
            WHERE m.organisation_id = $1 AND m.status = 'active' AND m.created_at < ((SELECT date FROM d) + 1)::timestamptz
              AND ($3::boolean OR m.id = $4 OR app_manages($1, m.id))
              AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = $5 AND tm.membership_id = m.id))) p) AS people,
         (SELECT json_agg(t ORDER BY t.name) FROM (
            SELECT t.id, t.name FROM teams t
            WHERE t.organisation_id = $1 AND t.archived_at IS NULL
              AND ($3::boolean OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.membership_id = $4 AND tm.is_manager))) t) AS teams`,
      [ctx.org.id, wanted, isOrg, ctx.membership.id, opts.teamId ?? null, ctx.org.timezone]);
    const iso = (v: string | null) => (v ? new Date(v).toISOString() : v);
    const people: BoardRow[] = (r.people ?? []).map((p) => ({ ...p, clock_in_at: iso(p.clock_in_at), clock_out_at: iso(p.clock_out_at), status: statusOf(p.clock_in_at ? { clock_in_at: p.clock_in_at, clock_out_at: p.clock_out_at } : null) }));
    const s = r.schedule;
    const counts = {
      in: people.filter((p) => p.status === "in").length,
      late: people.filter((p) => (p.late_seconds ?? 0) > 0).length,
      not_in: people.filter((p) => p.status === "not_in").length,
      out: people.filter((p) => p.status === "out").length,
    };
    return { date: r.date, today: r.today, schedule: s, workingDay: s.working_days.includes(weekdayOf(r.date)), people, counts, teams: r.teams ?? [], serverNow: new Date().toISOString() };
  });
}

export type MonthCell = { in: string; out: string | null; late: number };
export type MonthRow = {
  membership_id: string; display_name: string; employee_code: string; role: string; teams: string[]; joined: string;
  days: Record<string, MonthCell>; present: number; late: number; missed: number; total_seconds: number;
};

/**
 * One month at a glance for supervisors: a row per person, a cell per calendar day, and totals.
 * "Missed" counts scheduled working days up to yesterday (or the month's end) with no clock-in.
 */
export async function attendanceMonth(ctx: OrgContext, opts: { month?: string | null; teamId?: string | null } = {}) {
  if (ctx.membership.role === "employee") throw forbidden("Attendance boards are for team leads and organisation accounts.");
  return withUser(ctx.user.profileId, async (db) => {
    const s = await scheduleFor(db, ctx.org.id, ctx.org.timezone);
    const today = todayLocal(s.timezone);
    const month = isMonth(opts.month) ? opts.month : today.slice(0, 7);
    const range = monthRange(month);
    const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
    const people = await db.query<{ membership_id: string; display_name: string; employee_code: string; role: string; teams: string[]; joined: string }>(
      `SELECT m.id AS membership_id, pr.display_name, m.employee_code, m.role, m.created_at::date::text AS joined,
              COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL), '{}') AS teams
       FROM memberships m JOIN profiles pr ON pr.id = m.user_id
       WHERE m.organisation_id = $1 AND m.status = 'active' AND m.created_at < ($3::date + 1)::timestamptz
         AND ($4::boolean OR m.id = $5 OR app_manages($1, m.id))
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = $2 AND tm.membership_id = m.id))
       ORDER BY pr.display_name`, [ctx.org.id, opts.teamId ?? null, range.to, isOrg, ctx.membership.id]);
    const ids = people.map((p) => p.membership_id);
    const recs = ids.length ? await db.query<{ membership_id: string; local_date: string; clock_in_at: string; clock_out_at: string | null; late_seconds: number }>(
      `SELECT membership_id, local_date::text, clock_in_at, clock_out_at, late_seconds FROM attendance_days WHERE membership_id = ANY($1::uuid[]) AND local_date BETWEEN $2 AND $3`, [ids, range.from, range.to]) : [];
    const days = daysOf(range.from, range.to);
    const countable = days.filter((d) => d < today && s.working_days.includes(weekdayOf(d)));
    const rows: MonthRow[] = people.map((p) => {
      const mine = recs.filter((r) => r.membership_id === p.membership_id);
      const byDay: Record<string, MonthCell> = {};
      for (const r of mine) byDay[r.local_date] = { in: r.clock_in_at, out: r.clock_out_at, late: r.late_seconds };
      const total = mine.reduce((acc, r) => acc + (r.clock_out_at ? Math.round((Date.parse(r.clock_out_at) - Date.parse(r.clock_in_at)) / 1000) : 0), 0);
      return { ...p, days: byDay, present: mine.length, late: mine.filter((r) => r.late_seconds > 0).length, missed: countable.filter((d) => d >= p.joined && !byDay[d]).length, total_seconds: total };
    });
    const teams = await db.query<{ id: string; name: string }>(
      isOrg ? `SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`
            : `SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $1 AND tm.is_manager AND t.archived_at IS NULL ORDER BY t.name`, [isOrg ? ctx.org.id : ctx.membership.id]);
    return { month, today, days, workingDays: days.filter((d) => s.working_days.includes(weekdayOf(d))), schedule: s, rows, teams, serverNow: new Date().toISOString() };
  });
}
