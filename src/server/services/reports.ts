/**
 * Timesheets: one person's confirmed time for a local day, time corrections, and the CSV export.
 *
 * The staff daily report is gone (owner decision, 6 October 2026): staff no longer write or submit one, and Brenda's
 * end-of-day team report (daily-report.ts) tells supervisors what their teams did. Nothing here waits for a report.
 * Time is confirmed in the ledger (session_intervals) as it always was: timer time as it is recorded (time the server
 * could not vouch for is "uncertain" and never credited on its own), corrected time when a team lead approves the
 * correction. Timesheets, the export, work_summary and Brenda's report all read that ledger, so they agree. Past
 * reports and their versions stay in the database as history; nothing reads or writes them any more.
 */
import { z } from "zod";
import { withUser, isExclusionViolation, type Db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { splitAtLocalMidnight, localMidnight, addDays } from "@/server/lib/time";
import { audit, notify, managersOf } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export type TimesheetEntry = {
  intervalId: string; sessionId: string; taskId: string; taskTitle: string; projectId: string; projectName: string; category: string;
  startedAt: string; endedAt: string; seconds: number; status: string; source: string;
};
export type TimesheetDay = {
  localDate: string; timezone: string;
  entries: TimesheetEntry[];
  uncertain: TimesheetEntry[];
  totalsByTask: { taskId: string; taskTitle: string; projectName: string; seconds: number }[];
  totalSeconds: number;
  notes: { sessionId: string; note: string; outcome: string | null; endedAt: string }[];
};

/** One member's local day from the ledger, split at local midnight. A running timer counts up to now. */
async function buildDay(db: Db, orgId: string, membershipId: string, localDate: string, timezone: string): Promise<TimesheetDay> {
  const dayStart = localMidnight(localDate, timezone);
  const dayEnd = localMidnight(addDays(localDate, 1), timezone);
  const rows = await db.query<{ id: string; session_id: string; task_id: string; title: string; project_id: string; project_name: string; category: string; started_at: string; ended_at: string | null; confirmation_status: string; source: string }>(
    `SELECT i.id, i.session_id, i.task_id, t.title, t.project_id, p.name AS project_name, t.category, i.started_at, i.ended_at, i.confirmation_status, i.source
     FROM session_intervals i JOIN tasks t ON t.id = i.task_id JOIN projects p ON p.id = t.project_id
     WHERE i.organisation_id = $1 AND i.membership_id = $2 AND i.confirmation_status IN ('confirmed','uncertain')
       AND i.started_at < $4 AND COALESCE(i.ended_at, now()) > $3
     ORDER BY i.started_at`, [orgId, membershipId, dayStart.toISOString(), dayEnd.toISOString()]);
  const entries: TimesheetEntry[] = [];
  const uncertain: TimesheetEntry[] = [];
  const nowIso = new Date().toISOString();
  for (const r of rows) {
    const slices = splitAtLocalMidnight({ startedAt: r.started_at, endedAt: r.ended_at ?? nowIso }, timezone).filter((s) => s.localDate === localDate);
    for (const s of slices) {
      const e: TimesheetEntry = { intervalId: r.id, sessionId: r.session_id, taskId: r.task_id, taskTitle: r.title, projectId: r.project_id, projectName: r.project_name, category: r.category, startedAt: s.startedAt, endedAt: s.endedAt, seconds: s.seconds, status: r.confirmation_status, source: r.source };
      (r.confirmation_status === "confirmed" ? entries : uncertain).push(e);
    }
  }
  const byTask = new Map<string, { taskId: string; taskTitle: string; projectName: string; seconds: number }>();
  for (const e of entries) {
    const cur = byTask.get(e.taskId) ?? { taskId: e.taskId, taskTitle: e.taskTitle, projectName: e.projectName, seconds: 0 };
    cur.seconds += e.seconds; byTask.set(e.taskId, cur);
  }
  const notes = await db.query<{ session_id: string; note: string; outcome: string | null; ended_at: string }>(
    `SELECT id AS session_id, stop_note AS note, stop_outcome AS outcome, ended_at FROM work_sessions WHERE membership_id = $1 AND ended_at >= $2 AND ended_at < $3 AND stop_note IS NOT NULL AND stop_note <> '' ORDER BY ended_at`,
    [membershipId, dayStart.toISOString(), dayEnd.toISOString()]);
  return {
    localDate, timezone, entries, uncertain,
    totalsByTask: [...byTask.values()].sort((a, b) => b.seconds - a.seconds),
    totalSeconds: entries.reduce((s, e) => s + e.seconds, 0),
    notes: notes.map((n) => ({ sessionId: n.session_id, note: n.note, outcome: n.outcome, endedAt: n.ended_at })),
  };
}

/**
 * The Timesheets page for one member and local date: the day's time, and the corrections that touch it (a correction
 * belongs to every day its proposed or replaced intervals fall on).
 */
export async function timesheetForDate(ctx: OrgContext, membershipId: string, localDate: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const visible = await db.one<{ v: boolean }>(`SELECT app_can_view_records($1, $2) AS v`, [ctx.org.id, membershipId]);
    if (!visible.v) throw forbidden();
    const day = await buildDay(db, ctx.org.id, membershipId, localDate, ctx.org.timezone);
    const adjustments = await db.query<{ id: string; status: string; reason: string; created_at: string; reviewed_at: string | null; review_note: string | null; task_title: string }>(
      `SELECT a.id, a.status, a.reason, a.created_at, a.reviewed_at, a.review_note, t.title AS task_title FROM time_adjustments a JOIN tasks t ON t.id = a.task_id
       WHERE a.membership_id = $1 AND (
         EXISTS (SELECT 1 FROM jsonb_array_elements(a.proposed_intervals) p WHERE (p->>'startedAt')::timestamptz < $3 AND (p->>'endedAt')::timestamptz > $2)
         OR EXISTS (SELECT 1 FROM session_intervals i WHERE i.id = ANY(a.original_interval_ids) AND i.started_at < $3 AND COALESCE(i.ended_at, now()) > $2))
       ORDER BY a.created_at DESC`,
      [membershipId, localMidnight(localDate, ctx.org.timezone).toISOString(), localMidnight(addDays(localDate, 1), ctx.org.timezone).toISOString()]);
    return { day, adjustments };
  });
}

/**
 * The member's last fourteen local days that hold confirmed time, newest first, for stepping between days. Each
 * interval's share of a day is rounded to the second before adding up, as the day's own page does, so the two agree.
 */
export async function recentDays(ctx: OrgContext, membershipId: string, today: string) {
  return withUser(ctx.user.profileId, (db) => db.query<{ local_date: string; seconds: number }>(
    `WITH days AS (SELECT g::date AS local_date, g::date::timestamp AT TIME ZONE $3 AS start_at, (g::date + 1)::timestamp AT TIME ZONE $3 AS end_at
                   FROM generate_series($2::date - 13, $2::date, interval '1 day') g)
     SELECT days.local_date::text AS local_date, SUM(round(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, now()), days.end_at) - GREATEST(i.started_at, days.start_at)))))::int AS seconds
     FROM days JOIN session_intervals i ON i.membership_id = $1 AND i.confirmation_status = 'confirmed' AND i.started_at < days.end_at AND COALESCE(i.ended_at, now()) > days.start_at
     GROUP BY days.local_date ORDER BY days.local_date DESC`, [membershipId, today, ctx.org.timezone]));
}

// ---------------------------------------------------------------------------
// Time adjustments
// ---------------------------------------------------------------------------
export const adjustmentSchema = z.object({
  taskId: z.string().uuid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  originalIntervalIds: z.array(z.string().uuid()).max(50).default([]),
  proposedIntervals: z.array(z.object({ startedAt: z.string().datetime({ offset: true }), endedAt: z.string().datetime({ offset: true }) })).min(0).max(50),
  reason: z.string().trim().min(1).max(2000),
  evidenceNote: z.string().trim().max(2000).optional(),
});

/**
 * Proposes replacing intervals with new ones. Validates chronology and non-overlap against every confirmed
 * interval of the user (all organisations) without revealing other organisations' details. The ledger does not
 * change until a team lead approves the correction.
 */
export async function requestAdjustment(ctx: OrgContext, input: z.infer<typeof adjustmentSchema>, requestId?: string) {
  const proposed = [...input.proposedIntervals].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (let i = 0; i < proposed.length; i++) {
    const p = proposed[i];
    if (new Date(p.endedAt) <= new Date(p.startedAt)) throw invalid("Each proposed interval must end after it starts.", { proposedIntervals: ["End must be after start."] });
    if (new Date(p.endedAt) > new Date()) throw invalid("Proposed intervals cannot be in the future.", { proposedIntervals: ["Cannot be in the future."] });
    if (i > 0 && new Date(p.startedAt) < new Date(proposed[i - 1].endedAt)) throw invalid("Proposed intervals overlap each other.", { proposedIntervals: ["Intervals overlap."] });
  }
  return withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ id: string; assignee_membership_id: string }>(`SELECT id, assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [input.taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    if (t.assignee_membership_id !== ctx.membership.id) throw forbidden("You can only correct time on your own tasks.");
    if (input.originalIntervalIds.length) {
      const owned = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM session_intervals WHERE id = ANY($1::uuid[]) AND membership_id = $2 AND confirmation_status IN ('confirmed','uncertain')`, [input.originalIntervalIds, ctx.membership.id]);
      if (owned.n !== input.originalIntervalIds.length) throw invalid("One of the referenced intervals is not yours or was already changed.");
      const pending = await db.maybeOne(`SELECT 1 FROM time_adjustments WHERE status = 'pending' AND original_interval_ids && $1::uuid[]`, [input.originalIntervalIds]);
      if (pending) throw conflict("ADJUSTMENT_PENDING", "A pending correction already references one of these intervals.");
    }
    // Overlap check against the user's confirmed intervals across all organisations (excluding those being replaced).
    for (const p of proposed) {
      const clash = await db.maybeOne<{ n: number }>(
        `SELECT 1 AS n FROM app_user_interval_overlaps($1::timestamptz, $2::timestamptz, $3::uuid[]) LIMIT 1`, [p.startedAt, p.endedAt, input.originalIntervalIds]);
      if (clash) throw conflict("INTERVAL_OVERLAP", "A proposed interval overlaps another confirmed work session. Adjust the times.");
    }
    const adj = await db.one<{ id: string }>(
      `INSERT INTO time_adjustments(organisation_id, membership_id, task_id, original_interval_ids, proposed_intervals, reason, evidence_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ctx.org.id, ctx.membership.id, input.taskId, input.originalIntervalIds, JSON.stringify(proposed), input.reason, input.evidenceNote ?? null]);
    for (const mgr of await managersOf(db, ctx.org.id, ctx.membership.id)) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "adjustment.requested", title: `${ctx.user.displayName} requested a time correction for ${input.localDate}`, body: input.reason, resourceType: "time_adjustment", resourceId: adj.id, href: `/app/${ctx.org.slug}/reviews`, dedupKey: `adjustment:${adj.id}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "adjustment.requested", subjectType: "time_adjustment", subjectId: adj.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { localDate: input.localDate, replaced: input.originalIntervalIds.length, proposed: proposed.length } });
    return { adjustmentId: adj.id };
  });
}

export const adjustmentReviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(4000).default("") });

async function assertReviewScope(db: Db, ctx: OrgContext, membershipId: string) {
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") throw forbidden("Organisation accounts see reviews; the team lead gives the decision.");
  if (membershipId === ctx.membership.id) throw forbidden("You cannot approve your own records.");
  const r = await db.one<{ v: boolean }>(`SELECT (app_has_role($1, 'owner', 'hr') OR app_manages($1, $2)) AS v`, [ctx.org.id, membershipId]);
  if (!r.v) throw forbidden("This record is outside your review scope.");
}

/** A team lead's decision. Approval applies the ledger change atomically: the corrected time is confirmed from then on. */
export async function reviewAdjustment(ctx: OrgContext, adjustmentId: string, input: z.infer<typeof adjustmentReviewSchema>, requestId?: string) {
  if (input.decision === "rejected" && !input.note) throw invalid("Explain why the correction is rejected.", { note: ["Required when rejecting."] });
  return withUser(ctx.user.profileId, async (db) => {
    const a = await db.maybeOne<{ id: string; membership_id: string; status: string }>(`SELECT id, membership_id, status FROM time_adjustments WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [adjustmentId, ctx.org.id]);
    if (!a) throw notFound("Correction not found.");
    await assertReviewScope(db, ctx, a.membership_id);
    if (a.status !== "pending") throw conflict("BAD_STATE", "This correction was already decided.");
    if (input.decision === "approved") await applyAdjustmentLedger(db, ctx, a.id);
    else await db.query(`UPDATE time_adjustments SET status = 'rejected', reviewer_membership_id = $2, review_note = $3, reviewed_at = now() WHERE id = $1`, [a.id, ctx.membership.id, input.note]);
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: a.membership_id, type: `adjustment.${input.decision}`, title: `Time correction ${input.decision}`, body: input.note || undefined, resourceType: "time_adjustment", resourceId: a.id, href: `/app/${ctx.org.slug}/timesheets`, dedupKey: `adjustment.review:${a.id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `adjustment.${input.decision}`, subjectType: "time_adjustment", subjectId: a.id, subjectMembershipId: a.membership_id, requestId });
  });
}

/** Marks replaced intervals superseded and inserts the proposed ones as confirmed, guarded by the no-overlap constraint. */
async function applyAdjustmentLedger(db: Db, ctx: OrgContext, adjustmentId: string) {
  const a = await db.one<{ id: string; membership_id: string; user_id: string; task_id: string; session_id: string | null; original_interval_ids: string[]; proposed_intervals: { startedAt: string; endedAt: string }[]; status: string }>(
    `SELECT a.id, a.membership_id, m.user_id, a.task_id, a.session_id, a.original_interval_ids, a.proposed_intervals, a.status FROM time_adjustments a JOIN memberships m ON m.id = a.membership_id WHERE a.id = $1 FOR UPDATE OF a`, [adjustmentId]);
  if (a.status !== "pending") return;
  await db.query(`UPDATE session_intervals SET confirmation_status = 'superseded', adjustment_id = $2 WHERE id = ANY($1::uuid[])`, [a.original_interval_ids, a.id]);
  let sessionId = a.session_id;
  if (!sessionId) {
    const s = await db.maybeOne<{ session_id: string }>(`SELECT session_id FROM session_intervals WHERE id = ANY($1::uuid[]) LIMIT 1`, [a.original_interval_ids]);
    sessionId = s?.session_id ?? null;
  }
  if (!sessionId) {
    // Correction for work with no timer session: create a stopped container session for the ledger.
    const s = await db.one<{ id: string }>(
      `INSERT INTO work_sessions(organisation_id, user_id, membership_id, task_id, state, started_at, ended_at, last_heartbeat_at, stop_note, stop_outcome)
       VALUES ($1, $2, $3, $4, 'stopped', $5, $6, $5, 'Created from an approved time correction', 'continue_later') RETURNING id`,
      [ctx.org.id, a.user_id, a.membership_id, a.task_id, a.proposed_intervals[0]?.startedAt ?? new Date().toISOString(), a.proposed_intervals.at(-1)?.endedAt ?? new Date().toISOString()]);
    sessionId = s.id;
  }
  try {
    for (const p of a.proposed_intervals) {
      await db.query(`INSERT INTO session_intervals(organisation_id, session_id, user_id, membership_id, task_id, started_at, ended_at, confirmation_status, source, adjustment_id) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', 'adjustment', $8)`,
        [ctx.org.id, sessionId, a.user_id, a.membership_id, a.task_id, p.startedAt, p.endedAt, a.id]);
    }
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict("INTERVAL_OVERLAP", "The proposed time now overlaps another confirmed session; the correction cannot be applied as-is.");
    throw err;
  }
  await db.query(`UPDATE time_adjustments SET status = 'approved', reviewer_membership_id = $2, reviewed_at = now() WHERE id = $1`, [a.id, ctx.membership.id]);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Confirmed time per person, local day and task. It used to read approved daily-report versions; with the staff report
 * gone (owner decision, 6 October 2026) it reads the ledger the Timesheets page shows, split at local midnight in the
 * organisation's time zone, so a day's rows add up to that day's confirmed time there. Left out, as an unapproved
 * report's time was: uncertain time and a correction still waiting for its decision (once approved it is in the
 * ledger). A timer still running is left out until it stops.
 */
export async function exportTimesheetsCsv(ctx: OrgContext, filters: { from: string; to: string; membershipId?: string | null }) {
  if (!["owner", "hr", "manager"].includes(ctx.membership.role)) throw forbidden();
  const tz = ctx.org.timezone;
  return withUser(ctx.user.profileId, async (db) => {
    const rows = await db.query<{ membership_id: string; employee_code: string; display_name: string; task_id: string; task_title: string; project_name: string; started_at: string; ended_at: string }>(
      `SELECT i.membership_id, m.employee_code, pr.display_name, i.task_id, t.title AS task_title, p.name AS project_name, i.started_at, i.ended_at
       FROM session_intervals i JOIN memberships m ON m.id = i.membership_id JOIN profiles pr ON pr.id = m.user_id
       JOIN tasks t ON t.id = i.task_id JOIN projects p ON p.id = t.project_id
       WHERE i.organisation_id = $1 AND i.confirmation_status = 'confirmed' AND i.ended_at IS NOT NULL AND i.started_at < $3 AND i.ended_at > $2
         AND ($4::uuid IS NULL OR i.membership_id = $4) AND app_can_view_records($1, i.membership_id)
       ORDER BY i.started_at`,
      [ctx.org.id, localMidnight(filters.from, tz).toISOString(), localMidnight(addDays(filters.to, 1), tz).toISOString(), filters.membershipId ?? null]);
    type Line = { name: string; code: string; date: string; project: string; task: string; seconds: number };
    const byDayAndTask = new Map<string, Line>();
    for (const r of rows) {
      for (const s of splitAtLocalMidnight({ startedAt: r.started_at, endedAt: r.ended_at }, tz)) {
        if (s.localDate < filters.from || s.localDate > filters.to) continue;
        const key = `${r.membership_id}|${s.localDate}|${r.task_id}`;
        const cur = byDayAndTask.get(key) ?? { name: r.display_name, code: r.employee_code, date: s.localDate, project: r.project_name, task: r.task_title, seconds: 0 };
        cur.seconds += s.seconds; byDayAndTask.set(key, cur);
      }
    }
    const sorted = [...byDayAndTask.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.project.localeCompare(b.project) || a.task.localeCompare(b.task));
    const header = ["organisation", "employee_id", "employee_name", "local_date", "timezone", "project", "task", "confirmed_seconds"];
    const lines = [header.join(","), ...sorted.map((l) => [ctx.org.name, l.code, l.name, l.date, tz, l.project, l.task, l.seconds].map(csvCell).join(","))];
    const total = sorted.reduce((n, l) => n + l.seconds, 0);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "export.timesheets", subjectType: "organisation", subjectId: ctx.org.id, metadata: { ...filters, rows: sorted.length, totalSeconds: total } });
    return { csv: lines.join("\r\n") + "\r\n", rows: sorted.length, totalSeconds: total };
  });
}
