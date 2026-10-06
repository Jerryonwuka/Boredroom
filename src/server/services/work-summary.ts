/**
 * What got done (owner decision, 5 October 2026): the summary behind Brenda's "what did the team get done this week",
 * "who is behind" and the weekly round-up. Per person and period: confirmed hours tracked, tasks completed, tasks sent
 * for review, open and overdue work, and days clocked in and late.
 *
 * Who appears follows the records rules: staff see only themselves, team leads see themselves and the people on the
 * teams they lead, the owner and HR see everyone who holds work. Every query runs under the person's row-level
 * security, so nothing here can show more than the Timesheets, Attendance and Tasks pages already do. These are
 * plain counts for a conversation, not a score: nobody is ranked.
 */
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { scheduleFor } from "@/server/services/attendance";
import { addDays, localMidnight, todayLocal, weekdayOf } from "@/server/lib/time";

export const SUMMARY_PERIODS = ["today", "week", "month", "last_week", "last_month"] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];
export const isSummaryPeriod = (v: unknown): v is SummaryPeriod => typeof v === "string" && (SUMMARY_PERIODS as readonly string[]).includes(v);

export type PersonWork = {
  membershipId: string; name: string; teams: string[];
  trackedSeconds: number; trackedHours: number;
  tasksCompleted: number; completedTitles: string[];
  submittedForReview: number; submittedTitles: string[];
  openTasks: number; blockedTasks: number; overdueOpen: number; overdueTitles: string[];
  daysClockedIn: number; daysLate: number;
};

export type WorkSummary = {
  period: SummaryPeriod; from: string; to: string; timezone: string;
  /** Whose work the person may see: their own, their teams', or the organisation's. */
  scope: "self" | "team" | "organisation";
  /** Scheduled working days from the start of the period up to today (or the period's end). */
  workingDays: number;
  people: PersonWork[];
  totals: { people: number; trackedHours: number; tasksCompleted: number; submittedForReview: number; overdueOpen: number; blockedTasks: number; daysLate: number };
};

/** The local dates a period covers, inclusive. Weeks start on Monday; "week" and "month" run up to today. */
export function periodRange(period: SummaryPeriod, today: string): { from: string; to: string } {
  const wd = weekdayOf(today);
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  switch (period) {
    case "today": return { from: today, to: today };
    case "week": return { from: monday, to: today };
    case "last_week": return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case "month": return { from: firstOfMonth, to: today };
    case "last_month": { const end = addDays(firstOfMonth, -1); return { from: `${end.slice(0, 7)}-01`, to: end }; }
  }
}

type Row = Omit<PersonWork, "trackedHours">;

export async function workSummary(ctx: OrgContext, opts: { period: SummaryPeriod; membershipId?: string | null }): Promise<WorkSummary> {
  const role = ctx.membership.role;
  const scope: WorkSummary["scope"] = role === "owner" || role === "hr" ? "organisation" : role === "manager" ? "team" : "self";
  const person = opts.membershipId ?? null;
  if (scope === "self" && person && person !== ctx.membership.id) throw forbidden("Staff see a summary of their own work only.");
  const tz = ctx.org.timezone;
  const today = todayLocal(tz);
  const { from, to } = periodRange(opts.period, today);
  const fromAt = localMidnight(from, tz).toISOString();
  const toAt = localMidnight(addDays(to, 1), tz).toISOString();
  return withUser(ctx.user.profileId, async (db) => {
    const schedule = await scheduleFor(db, ctx.org.id, tz);
    let workingDays = 0;
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) if (schedule.working_days.includes(weekdayOf(d))) workingDays++;
    // One statement: the people in scope and every figure per person. The database may be far away; round trips cost.
    const rows = await db.query<Row>(
      `WITH scope AS (
         SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id
         WHERE m.organisation_id = $1 AND m.status = 'active' AND m.role IN ('employee', 'manager')
           AND ($4::text = 'organisation' OR m.id = $5 OR ($4::text = 'team' AND app_manages($1, m.id)))
           AND ($6::uuid IS NULL OR m.id = $6))
       SELECT s.id AS "membershipId", s.display_name AS name,
         COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = s.id AND t.archived_at IS NULL), '{}') AS teams,
         COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, now()), $3::timestamptz) - GREATEST(i.started_at, $2::timestamptz))))::int
                   FROM session_intervals i WHERE i.membership_id = s.id AND i.confirmation_status = 'confirmed' AND i.started_at < $3::timestamptz AND COALESCE(i.ended_at, now()) > $2::timestamptz), 0) AS "trackedSeconds",
         (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.status = 'completed' AND t.completed_at >= $2::timestamptz AND t.completed_at < $3::timestamptz)::int AS "tasksCompleted",
         (SELECT COALESCE(json_agg(x.title), '[]'::json) FROM (SELECT t.title FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.status = 'completed' AND t.completed_at >= $2::timestamptz AND t.completed_at < $3::timestamptz ORDER BY t.completed_at DESC LIMIT 10) x) AS "completedTitles",
         (SELECT count(DISTINCT ts.task_id) FROM task_submissions ts WHERE ts.organisation_id = $1 AND ts.submitted_by = s.id AND ts.submitted_at >= $2::timestamptz AND ts.submitted_at < $3::timestamptz)::int AS "submittedForReview",
         (SELECT COALESCE(json_agg(x.title), '[]'::json) FROM (SELECT t.title FROM tasks t WHERE t.organisation_id = $1 AND EXISTS (SELECT 1 FROM task_submissions ts WHERE ts.task_id = t.id AND ts.submitted_by = s.id AND ts.submitted_at >= $2::timestamptz AND ts.submitted_at < $3::timestamptz) ORDER BY t.updated_at DESC LIMIT 10) x) AS "submittedTitles",
         (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.archived_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked'))::int AS "openTasks",
         (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.archived_at IS NULL AND t.status = 'blocked')::int AS "blockedTasks",
         (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.archived_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked') AND t.due_at < now())::int AS "overdueOpen",
         (SELECT COALESCE(json_agg(x.title), '[]'::json) FROM (SELECT t.title FROM tasks t WHERE t.organisation_id = $1 AND t.assignee_membership_id = s.id AND t.archived_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked') AND t.due_at < now() ORDER BY t.due_at LIMIT 5) x) AS "overdueTitles",
         (SELECT count(*) FROM attendance_days a WHERE a.membership_id = s.id AND a.local_date BETWEEN $7::date AND $8::date)::int AS "daysClockedIn",
         (SELECT count(*) FROM attendance_days a WHERE a.membership_id = s.id AND a.local_date BETWEEN $7::date AND $8::date AND a.late_seconds > 0)::int AS "daysLate"
       FROM scope s ORDER BY s.display_name`,
      [ctx.org.id, fromAt, toAt, scope, ctx.membership.id, person, from, to]);
    if (person && !rows.length) throw forbidden(scope === "team" ? "That person is not on a team you lead." : "That person does not hold work here.");
    const people: PersonWork[] = rows.map((r) => ({ ...r, trackedHours: Math.round(r.trackedSeconds / 360) / 10 }));
    const sum = (k: keyof PersonWork) => people.reduce((n, p) => n + (p[k] as number), 0);
    return {
      period: opts.period, from, to, timezone: tz, scope, workingDays, people,
      totals: { people: people.length, trackedHours: Math.round(sum("trackedSeconds") / 360) / 10, tasksCompleted: sum("tasksCompleted"), submittedForReview: sum("submittedForReview"), overdueOpen: sum("overdueOpen"), blockedTasks: sum("blockedTasks"), daysLate: sum("daysLate") },
    };
  });
}
