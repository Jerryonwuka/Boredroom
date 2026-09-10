import { z } from "zod";
import { withUser, isExclusionViolation, type Db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { splitAtLocalMidnight, localMidnight, addDays, weekdayOf } from "@/server/lib/time";
import { audit, notify, managersOf } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export type ReportSnapshotEntry = {
  intervalId: string; sessionId: string; taskId: string; taskTitle: string; projectId: string; projectName: string; category: string;
  startedAt: string; endedAt: string; seconds: number; status: string; source: string;
};
export type ReportSnapshot = {
  localDate: string; timezone: string; generatedAt: string;
  entries: ReportSnapshotEntry[];
  uncertain: ReportSnapshotEntry[];
  totalsByTask: { taskId: string; taskTitle: string; projectName: string; seconds: number }[];
  totalSeconds: number;
  notes: { sessionId: string; note: string; outcome: string | null; endedAt: string }[];
};

/** Builds the report view for one member and local date from immutable intervals, split at local midnight. */
export async function buildSnapshot(db: Db, orgId: string, membershipId: string, localDate: string, timezone: string): Promise<ReportSnapshot> {
  const dayStart = localMidnight(localDate, timezone);
  const dayEnd = localMidnight(addDays(localDate, 1), timezone);
  const rows = await db.query<{ id: string; session_id: string; task_id: string; title: string; project_id: string; project_name: string; category: string; started_at: string; ended_at: string | null; confirmation_status: string; source: string }>(
    `SELECT i.id, i.session_id, i.task_id, t.title, t.project_id, p.name AS project_name, t.category, i.started_at, i.ended_at, i.confirmation_status, i.source
     FROM session_intervals i JOIN tasks t ON t.id = i.task_id JOIN projects p ON p.id = t.project_id
     WHERE i.organisation_id = $1 AND i.membership_id = $2 AND i.confirmation_status IN ('confirmed','uncertain')
       AND i.started_at < $4 AND COALESCE(i.ended_at, now()) > $3
     ORDER BY i.started_at`, [orgId, membershipId, dayStart.toISOString(), dayEnd.toISOString()]);
  const entries: ReportSnapshotEntry[] = [];
  const uncertain: ReportSnapshotEntry[] = [];
  const nowIso = new Date().toISOString();
  for (const r of rows) {
    const slices = splitAtLocalMidnight({ startedAt: r.started_at, endedAt: r.ended_at ?? nowIso }, timezone).filter((s) => s.localDate === localDate);
    for (const s of slices) {
      const e: ReportSnapshotEntry = { intervalId: r.id, sessionId: r.session_id, taskId: r.task_id, taskTitle: r.title, projectId: r.project_id, projectName: r.project_name, category: r.category, startedAt: s.startedAt, endedAt: s.endedAt, seconds: s.seconds, status: r.confirmation_status, source: r.source };
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
    localDate, timezone, generatedAt: nowIso, entries, uncertain,
    totalsByTask: [...byTask.values()].sort((a, b) => b.seconds - a.seconds),
    totalSeconds: entries.reduce((s, e) => s + e.seconds, 0),
    notes: notes.map((n) => ({ sessionId: n.session_id, note: n.note, outcome: n.outcome, endedAt: n.ended_at })),
  };
}

export async function reportForDate(ctx: OrgContext, membershipId: string, localDate: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const visible = await db.one<{ v: boolean }>(`SELECT app_can_view_records($1, $2) AS v`, [ctx.org.id, membershipId]);
    if (!visible.v) throw forbidden();
    const report = await db.maybeOne<{ id: string; status: string; current_version: number; approved_version: number | null; blockers: string; next_priorities: string; updated_at: string }>(
      `SELECT id, status, current_version, approved_version, blockers, next_priorities, updated_at FROM daily_reports WHERE membership_id = $1 AND local_date = $2`, [membershipId, localDate]);
    const versions = report ? await db.query<{ id: string; version: number; status: string; total_seconds: number; submitted_at: string; reviewed_at: string | null; review_note: string | null; reviewer_name: string | null; timezone_snapshot: string; blockers: string; next_priorities: string; snapshot: ReportSnapshot; superseded_at: string | null }>(
      `SELECT v.id, v.version, v.status, v.total_seconds, v.submitted_at, v.reviewed_at, v.review_note, pr.display_name AS reviewer_name, v.timezone_snapshot, v.blockers, v.next_priorities, v.snapshot, v.superseded_at
       FROM report_versions v LEFT JOIN memberships m ON m.id = v.reviewed_by LEFT JOIN profiles pr ON pr.id = m.user_id WHERE v.report_id = $1 ORDER BY v.version DESC`, [report.id]) : [];
    const live = await buildSnapshot(db, ctx.org.id, membershipId, localDate, ctx.org.timezone);
    const openSession = await db.maybeOne<{ id: string }>(`SELECT id FROM work_sessions WHERE membership_id = $1 AND state IN ('running','paused','interrupted')`, [membershipId]);
    const adjustments = await db.query<{ id: string; status: string; reason: string; proposed_intervals: unknown; created_at: string; reviewed_at: string | null; review_note: string | null; task_title: string }>(
      `SELECT a.id, a.status, a.reason, a.proposed_intervals, a.created_at, a.reviewed_at, a.review_note, t.title AS task_title FROM time_adjustments a JOIN tasks t ON t.id = a.task_id
       WHERE a.membership_id = $1 AND (a.report_id = $2 OR ($2 IS NULL AND false)) ORDER BY a.created_at DESC`, [membershipId, report?.id ?? null]);
    return { report, versions, live, openSessionId: openSession?.id ?? null, adjustments };
  });
}

export const submitReportSchema = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), blockers: z.string().trim().max(4000).default(""), nextPriorities: z.string().trim().max(4000).default("") });

/** Creates a versioned, immutable snapshot and moves the report to submitted. Open sessions overlapping the day block submission. */
export async function submitReport(ctx: OrgContext, input: z.infer<typeof submitReportSchema>, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const dayEnd = localMidnight(addDays(input.localDate, 1), ctx.org.timezone);
    const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE membership_id = $1 AND state IN ('running','paused','interrupted') AND started_at < $2`, [ctx.membership.id, dayEnd.toISOString()]);
    if (open) throw conflict("SESSION_OPEN", "Stop your open work session before submitting this day's report.");
    const snapshot = await buildSnapshot(db, ctx.org.id, ctx.membership.id, input.localDate, ctx.org.timezone);
    const existing = await db.maybeOne<{ id: string; status: string; current_version: number }>(`SELECT id, status, current_version FROM daily_reports WHERE membership_id = $1 AND local_date = $2 FOR UPDATE`, [ctx.membership.id, input.localDate]);
    if (existing && (existing.status === "submitted")) throw conflict("ALREADY_SUBMITTED", "This report is already waiting for review.");
    if (existing && existing.status === "approved") throw conflict("ALREADY_APPROVED", "This report is approved. Request a time correction to change it.");
    const reportId = existing?.id ?? (await db.one<{ id: string }>(`INSERT INTO daily_reports(organisation_id, membership_id, local_date) VALUES ($1, $2, $3) RETURNING id`, [ctx.org.id, ctx.membership.id, input.localDate])).id;
    const version = (existing?.current_version ?? 0) + 1;
    const v = await db.one<{ id: string }>(
      `INSERT INTO report_versions(organisation_id, report_id, version, timezone_snapshot, status, snapshot, total_seconds, blockers, next_priorities, submitted_by)
       VALUES ($1, $2, $3, $4, 'submitted', $5, $6, $7, $8, $9) RETURNING id`,
      [ctx.org.id, reportId, version, ctx.org.timezone, JSON.stringify(snapshot), snapshot.totalSeconds, input.blockers, input.nextPriorities, ctx.membership.id]);
    await db.query(`UPDATE daily_reports SET status = 'submitted', current_version = $2, blockers = $3, next_priorities = $4 WHERE id = $1`, [reportId, version, input.blockers, input.nextPriorities]);
    for (const mgr of await managersOf(db, ctx.org.id, ctx.membership.id)) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "report.submitted", title: `${ctx.user.displayName} submitted a report for ${input.localDate}`, resourceType: "daily_report", resourceId: reportId, href: `/app/${ctx.org.slug}/reviews`, dedupKey: `report.submitted:${v.id}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "report.submitted", subjectType: "report_version", subjectId: v.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { localDate: input.localDate, version, totalSeconds: snapshot.totalSeconds } });
    return { reportId, version, totalSeconds: snapshot.totalSeconds };
  });
}

export const reviewReportSchema = z.object({ decision: z.enum(["approved", "changes_requested"]), note: z.string().trim().max(4000).default(""), version: z.number().int().positive() });

async function assertReviewScope(db: Db, ctx: OrgContext, membershipId: string) {
  if (membershipId === ctx.membership.id) throw forbidden("You cannot approve your own records.");
  const r = await db.one<{ v: boolean }>(`SELECT (app_has_role($1, 'owner', 'hr') OR app_manages($1, $2)) AS v`, [ctx.org.id, membershipId]);
  if (!r.v) throw forbidden("This record is outside your review scope.");
}

export async function reviewReport(ctx: OrgContext, reportId: string, input: z.infer<typeof reviewReportSchema>, requestId?: string) {
  if (input.decision === "changes_requested" && !input.note) throw invalid("Say what needs to change.", { note: ["Required when requesting changes."] });
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.maybeOne<{ id: string; membership_id: string; local_date: string; status: string; current_version: number; approved_version: number | null }>(`SELECT id, membership_id, local_date, status, current_version, approved_version FROM daily_reports WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [reportId, ctx.org.id]);
    if (!r) throw notFound("Report not found.");
    await assertReviewScope(db, ctx, r.membership_id);
    if (r.status !== "submitted") throw conflict("BAD_STATE", "This report is not waiting for review.");
    if (r.current_version !== input.version) throw conflict("VERSION_CONFLICT", "A newer version was submitted. Reload.", { currentVersion: r.current_version });
    const v = await db.one<{ id: string; adjustment_id: string | null }>(`UPDATE report_versions SET status = $3, reviewed_by = $4, reviewed_at = now(), review_note = $5 WHERE report_id = $1 AND version = $2 RETURNING id, adjustment_id`, [reportId, input.version, input.decision, ctx.membership.id, input.note || null]);
    if (input.decision === "approved") {
      if (r.approved_version) await db.query(`UPDATE report_versions SET status = 'superseded', superseded_at = now() WHERE report_id = $1 AND version = $2 AND status = 'approved'`, [reportId, r.approved_version]);
      await db.query(`UPDATE daily_reports SET status = 'approved', approved_version = $2 WHERE id = $1`, [reportId, input.version]);
      if (v.adjustment_id) await applyAdjustmentLedger(db, ctx, v.adjustment_id);
    } else {
      await db.query(`UPDATE daily_reports SET status = 'changes_requested' WHERE id = $1`, [reportId]);
      if (v.adjustment_id) await db.query(`UPDATE time_adjustments SET status = 'rejected', reviewer_membership_id = $2, review_note = $3, reviewed_at = now() WHERE id = $1 AND status = 'pending'`, [v.adjustment_id, ctx.membership.id, input.note]);
    }
    await notify(db, { organisationId: ctx.org.id, recipientMembershipId: r.membership_id, type: `report.${input.decision}`, title: `Report for ${r.local_date} ${input.decision === "approved" ? "approved" : "needs changes"}`, body: input.note || undefined, resourceType: "daily_report", resourceId: reportId, href: `/app/${ctx.org.slug}/timesheets?date=${r.local_date}`, dedupKey: `report.review:${v.id}` });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: `report.${input.decision}`, subjectType: "report_version", subjectId: v.id, subjectMembershipId: r.membership_id, requestId, metadata: { localDate: r.local_date, version: input.version } });
  });
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
 * interval of the user (all organisations) without revealing other organisations' details. Creates a new
 * proposed report version when the day already has a submitted/approved report.
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
    const report = await db.maybeOne<{ id: string; status: string; current_version: number; approved_version: number | null }>(`SELECT id, status, current_version, approved_version FROM daily_reports WHERE membership_id = $1 AND local_date = $2 FOR UPDATE`, [ctx.membership.id, input.localDate]);
    const adj = await db.one<{ id: string }>(
      `INSERT INTO time_adjustments(organisation_id, membership_id, report_id, based_on_version, task_id, original_interval_ids, proposed_intervals, reason, evidence_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [ctx.org.id, ctx.membership.id, report?.id ?? null, report?.current_version ?? null, input.taskId, input.originalIntervalIds, JSON.stringify(proposed), input.reason, input.evidenceNote ?? null]);
    let versionInfo: { version: number } | null = null;
    if (report && report.status !== "draft") {
      // Proposed replacement version: the current approved snapshot stays untouched until this one is approved.
      const projected = await projectSnapshot(db, ctx, input, proposed, adj.id);
      const version = report.current_version + 1;
      await db.query(
        `INSERT INTO report_versions(organisation_id, report_id, version, timezone_snapshot, status, snapshot, total_seconds, blockers, next_priorities, submitted_by, adjustment_id)
         SELECT $1, $2, $3, $4, 'submitted', $5, $6, blockers, next_priorities, $7, $8 FROM daily_reports WHERE id = $2`,
        [ctx.org.id, report.id, version, ctx.org.timezone, JSON.stringify(projected), projected.totalSeconds, ctx.membership.id, adj.id]);
      await db.query(`UPDATE daily_reports SET status = 'submitted', current_version = $2 WHERE id = $1`, [report.id, version]);
      versionInfo = { version };
    }
    for (const mgr of await managersOf(db, ctx.org.id, ctx.membership.id)) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "adjustment.requested", title: `${ctx.user.displayName} requested a time correction for ${input.localDate}`, body: input.reason, resourceType: "time_adjustment", resourceId: adj.id, href: `/app/${ctx.org.slug}/reviews`, dedupKey: `adjustment:${adj.id}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "adjustment.requested", subjectType: "time_adjustment", subjectId: adj.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { localDate: input.localDate, replaced: input.originalIntervalIds.length, proposed: proposed.length } });
    return { adjustmentId: adj.id, reportVersion: versionInfo?.version ?? null };
  });
}

async function projectSnapshot(db: Db, ctx: OrgContext, input: z.infer<typeof adjustmentSchema>, proposed: { startedAt: string; endedAt: string }[], adjustmentId: string): Promise<ReportSnapshot> {
  const base = await buildSnapshot(db, ctx.org.id, ctx.membership.id, input.localDate, ctx.org.timezone);
  const removed = new Set(input.originalIntervalIds);
  const task = await db.one<{ title: string; project_id: string; project_name: string; category: string }>(`SELECT t.title, t.project_id, p.name AS project_name, t.category FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1`, [input.taskId]);
  const entries = base.entries.filter((e) => !removed.has(e.intervalId));
  for (const p of proposed) {
    for (const s of splitAtLocalMidnight(p, ctx.org.timezone).filter((s) => s.localDate === input.localDate)) {
      entries.push({ intervalId: `proposed:${adjustmentId}`, sessionId: "", taskId: input.taskId, taskTitle: task.title, projectId: task.project_id, projectName: task.project_name, category: task.category, startedAt: s.startedAt, endedAt: s.endedAt, seconds: s.seconds, status: "proposed", source: "adjustment" });
    }
  }
  entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byTask = new Map<string, { taskId: string; taskTitle: string; projectName: string; seconds: number }>();
  for (const e of entries) { const cur = byTask.get(e.taskId) ?? { taskId: e.taskId, taskTitle: e.taskTitle, projectName: e.projectName, seconds: 0 }; cur.seconds += e.seconds; byTask.set(e.taskId, cur); }
  return { ...base, entries, uncertain: base.uncertain.filter((e) => !removed.has(e.intervalId)), totalsByTask: [...byTask.values()], totalSeconds: entries.reduce((s, e) => s + e.seconds, 0), generatedAt: new Date().toISOString() };
}

export const adjustmentReviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(4000).default("") });

/** Manager decision. Approval applies the ledger change atomically and approves the proposed report version. */
export async function reviewAdjustment(ctx: OrgContext, adjustmentId: string, input: z.infer<typeof adjustmentReviewSchema>, requestId?: string) {
  if (input.decision === "rejected" && !input.note) throw invalid("Explain why the correction is rejected.", { note: ["Required when rejecting."] });
  return withUser(ctx.user.profileId, async (db) => {
    const a = await db.maybeOne<{ id: string; membership_id: string; status: string; report_id: string | null }>(`SELECT id, membership_id, status, report_id FROM time_adjustments WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [adjustmentId, ctx.org.id]);
    if (!a) throw notFound("Correction not found.");
    await assertReviewScope(db, ctx, a.membership_id);
    if (a.status !== "pending") throw conflict("BAD_STATE", "This correction was already decided.");
    const version = a.report_id ? await db.maybeOne<{ report_id: string; version: number; status: string }>(`SELECT report_id, version, status FROM report_versions WHERE adjustment_id = $1`, [a.id]) : null;
    if (input.decision === "approved") {
      await applyAdjustmentLedger(db, ctx, a.id);
      if (version && version.status === "submitted") {
        const rep = await db.one<{ approved_version: number | null }>(`SELECT approved_version FROM daily_reports WHERE id = $1 FOR UPDATE`, [version.report_id]);
        await db.query(`UPDATE report_versions SET status = 'approved', reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE report_id = $1 AND version = $2`, [version.report_id, version.version, ctx.membership.id, input.note || null]);
        if (rep.approved_version) await db.query(`UPDATE report_versions SET status = 'superseded', superseded_at = now() WHERE report_id = $1 AND version = $2 AND status = 'approved'`, [version.report_id, rep.approved_version]);
        await db.query(`UPDATE daily_reports SET status = 'approved', approved_version = $2 WHERE id = $1`, [version.report_id, version.version]);
      }
    } else {
      await db.query(`UPDATE time_adjustments SET status = 'rejected', reviewer_membership_id = $2, review_note = $3, reviewed_at = now() WHERE id = $1`, [a.id, ctx.membership.id, input.note]);
      if (version && version.status === "submitted") {
        await db.query(`UPDATE report_versions SET status = 'withdrawn', reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE report_id = $1 AND version = $2`, [version.report_id, version.version, ctx.membership.id, input.note]);
        const rep = await db.one<{ approved_version: number | null }>(`SELECT approved_version FROM daily_reports WHERE id = $1`, [version.report_id]);
        await db.query(`UPDATE daily_reports SET status = $2 WHERE id = $1`, [version.report_id, rep.approved_version ? "approved" : "changes_requested"]);
      }
    }
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

/** Approved, versioned records only. Totals reconcile with approved snapshots by construction. */
export async function exportTimesheetsCsv(ctx: OrgContext, filters: { from: string; to: string; membershipId?: string | null }) {
  if (!["owner", "hr", "manager"].includes(ctx.membership.role)) throw forbidden();
  return withUser(ctx.user.profileId, async (db) => {
    const rows = await db.query<{ membership_id: string; employee_code: string; display_name: string; local_date: string; version: number; reviewer_name: string | null; reviewed_at: string | null; snapshot: ReportSnapshot; total_seconds: number }>(
      `SELECT r.membership_id, m.employee_code, pr.display_name, r.local_date, v.version, prv.display_name AS reviewer_name, v.reviewed_at, v.snapshot, v.total_seconds
       FROM daily_reports r JOIN report_versions v ON v.report_id = r.id AND v.version = r.approved_version AND v.status = 'approved'
       JOIN memberships m ON m.id = r.membership_id JOIN profiles pr ON pr.id = m.user_id
       LEFT JOIN memberships mrv ON mrv.id = v.reviewed_by LEFT JOIN profiles prv ON prv.id = mrv.user_id
       WHERE r.organisation_id = $1 AND r.local_date BETWEEN $2 AND $3 AND ($4::uuid IS NULL OR r.membership_id = $4) AND app_can_view_records($1, r.membership_id)
       ORDER BY r.local_date, pr.display_name`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null]);
    const header = ["organisation", "employee_id", "employee_name", "local_date", "timezone", "project", "task", "approved_seconds", "reviewer", "approval_timestamp", "report_version"];
    const lines = [header.join(",")];
    let total = 0;
    for (const r of rows) {
      const snap = r.snapshot;
      let sum = 0;
      for (const t of snap.totalsByTask) {
        sum += t.seconds;
        lines.push([ctx.org.name, r.employee_code, r.display_name, r.local_date, snap.timezone, t.projectName, t.taskTitle, t.seconds, r.reviewer_name ?? "", r.reviewed_at ?? "", r.version].map(csvCell).join(","));
      }
      if (sum !== r.total_seconds) throw new Error(`snapshot totals do not reconcile for report ${r.local_date}/${r.employee_code}`);
      total += sum;
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "export.timesheets", subjectType: "organisation", subjectId: ctx.org.id, metadata: { ...filters, rows: rows.length, totalSeconds: total } });
    return { csv: lines.join("\r\n") + "\r\n", rows: rows.length, totalSeconds: total };
  });
}

// ---------------------------------------------------------------------------
// Metrics (section 12)
// ---------------------------------------------------------------------------
export async function metrics(ctx: OrgContext, filters: { from: string; to: string; membershipId?: string | null; projectId?: string | null; teamId?: string | null }) {
  return withUser(ctx.user.profileId, async (db) => {
    const scope = `AND ($4::uuid IS NULL OR m.id = $4) AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.membership_id = m.id AND tm.team_id = $5)) AND app_can_view_records($1, m.id)`;
    const approvedTime = await db.query<{ membership_id: string; display_name: string; seconds: number; days: number }>(
      `SELECT m.id AS membership_id, pr.display_name, COALESCE(SUM(v.total_seconds), 0)::int AS seconds, count(v.id)::int AS days
       FROM memberships m JOIN profiles pr ON pr.id = m.user_id
       LEFT JOIN daily_reports r ON r.membership_id = m.id AND r.local_date BETWEEN $2 AND $3
       LEFT JOIN report_versions v ON v.report_id = r.id AND v.version = r.approved_version AND v.status = 'approved'
       WHERE m.organisation_id = $1 AND m.status = 'active' ${scope} GROUP BY m.id, pr.display_name ORDER BY pr.display_name`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null]);
    const provisional = await db.query<{ membership_id: string; seconds: number }>(
      `SELECT m.id AS membership_id, COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at))), 0)::int AS seconds
       FROM memberships m JOIN session_intervals i ON i.membership_id = m.id AND i.confirmation_status = 'confirmed'
       WHERE m.organisation_id = $1 AND m.status = 'active' AND i.started_at >= $2::date AND i.started_at < ($3::date + 1) ${scope} GROUP BY m.id`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null]);
    const delivery = await db.one<{ approved: number; with_due: number; on_time: number; est_count: number; est_variance: number }>(
      `SELECT count(*)::int AS approved,
              count(*) FILTER (WHERE t.due_at IS NOT NULL)::int AS with_due,
              count(*) FILTER (WHERE t.due_at IS NOT NULL AND s.submitted_at <= t.due_at)::int AS on_time,
              count(*) FILTER (WHERE t.estimate_minutes IS NOT NULL)::int AS est_count,
              COALESCE(SUM(CASE WHEN t.estimate_minutes IS NOT NULL THEN
                 (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (i.ended_at - i.started_at))), 0) FROM session_intervals i WHERE i.task_id = t.id AND i.confirmation_status = 'confirmed' AND i.ended_at IS NOT NULL) - t.estimate_minutes * 60 END), 0)::int AS est_variance
       FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id
       JOIN LATERAL (SELECT ts.submitted_at FROM task_submissions ts JOIN reviews rv ON rv.submission_id = ts.id AND rv.decision = 'approved' WHERE ts.task_id = t.id ORDER BY ts.revision DESC LIMIT 1) s ON true
       WHERE t.organisation_id = $1 AND t.status = 'completed' AND t.completed_at >= $2::date AND t.completed_at < ($3::date + 1)
         AND ($6::uuid IS NULL OR t.project_id = $6) ${scope}`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null, filters.projectId ?? null]);
    const blockers = await db.query<{ id: string; title: string; display_name: string; blocked_reason: string | null; since: string }>(
      `SELECT t.id, t.title, pr.display_name, t.blocked_reason, (SELECT MAX(h.occurred_at) FROM task_status_history h WHERE h.task_id = t.id AND h.to_status = 'blocked') AS since
       FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles pr ON pr.id = m.user_id
       WHERE t.organisation_id = $1 AND t.status = 'blocked' AND t.archived_at IS NULL AND $2::date <= $3::date AND ($6::uuid IS NULL OR t.project_id = $6) ${scope} ORDER BY since`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null, filters.projectId ?? null]);
    const schedule = await db.maybeOne<{ working_days: number[] }>(`SELECT working_days FROM schedules WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1`, [ctx.org.id]);
    const workingDays = schedule?.working_days ?? [1, 2, 3, 4, 5];
    const expectedDays: string[] = [];
    for (let d = filters.from; d <= filters.to && expectedDays.length < 400; d = addDays(d, 1)) if (workingDays.includes(weekdayOf(d))) expectedDays.push(d);
    const completeness = await db.query<{ membership_id: string; display_name: string; submitted: number; exempt: number }>(
      `SELECT m.id AS membership_id, pr.display_name,
              (SELECT count(*) FROM daily_reports r WHERE r.membership_id = m.id AND r.local_date = ANY($6::date[]) AND r.status IN ('submitted','approved','changes_requested'))::int AS submitted,
              (SELECT count(*) FROM workday_exemptions e WHERE e.membership_id = m.id AND e.local_date = ANY($6::date[]))::int AS exempt
       FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND $2::date <= $3::date ${scope} ORDER BY pr.display_name`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null, expectedDays]);
    const capture = await db.one<{ recorded: number; tracked: number; pending: number }>(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(rc.capture_ended_at, i.ended_at) - GREATEST(rc.capture_started_at, i.started_at)))) FILTER (WHERE rc.upload_state = 'ready' AND LEAST(rc.capture_ended_at, i.ended_at) > GREATEST(rc.capture_started_at, i.started_at)), 0)::int AS recorded,
              COALESCE(SUM(EXTRACT(EPOCH FROM (i.ended_at - i.started_at))), 0)::int AS tracked,
              count(DISTINCT rc.id) FILTER (WHERE rc.upload_state IN ('pending','uploading','processing','partial'))::int AS pending
       FROM session_intervals i JOIN work_sessions s ON s.id = i.session_id JOIN memberships m ON m.id = i.membership_id
       LEFT JOIN recordings rc ON rc.session_id = s.id AND rc.deleted_at IS NULL
       WHERE i.organisation_id = $1 AND s.capture_mode = 'required' AND i.confirmation_status = 'confirmed' AND i.ended_at IS NOT NULL AND i.started_at >= $2::date AND i.started_at < ($3::date + 1) ${scope}`, [ctx.org.id, filters.from, filters.to, filters.membershipId ?? null, filters.teamId ?? null]);
    return { approvedTime, provisional, delivery, blockers, completeness, expectedDays: expectedDays.length, capture };
  });
}

export type { Db };
