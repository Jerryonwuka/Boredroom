/**
 * Read models for pages. Every query runs under the caller's RLS context, so these
 * helpers only shape data; they never widen access.
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { todayLocal } from "@/server/lib/time";

export type TaskRow = {
  id: string; title: string; status: string; priority: string; category: string; project_id: string; project_name: string;
  assignee_membership_id: string; assignee_name: string; reviewer_membership_id: string | null; reviewer_name: string | null;
  due_at: string | null; estimate_minutes: number | null; capture_requirement: string; blocked_reason: string | null; version: number;
  archived_at: string | null; tracked_seconds: number; updated_at: string;
};

const TASK_SELECT = `
  SELECT t.id, t.title, t.status, t.priority, t.category, t.project_id, p.name AS project_name,
         t.assignee_membership_id, pa.display_name AS assignee_name, t.reviewer_membership_id, pr.display_name AS reviewer_name,
         t.due_at, t.estimate_minutes, t.capture_requirement, t.blocked_reason, t.version, t.archived_at, t.updated_at,
         COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at)))::int FROM session_intervals i WHERE i.task_id = t.id AND i.confirmation_status = 'confirmed'), 0) AS tracked_seconds
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN memberships ma ON ma.id = t.assignee_membership_id JOIN profiles pa ON pa.id = ma.user_id
  LEFT JOIN memberships mr ON mr.id = t.reviewer_membership_id LEFT JOIN profiles pr ON pr.id = mr.user_id`;

export async function myDay(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const today = todayLocal(ctx.org.timezone);
    const planned = await db.query<TaskRow & { position: number }>(`${TASK_SELECT}
      JOIN daily_plan_items d ON d.task_id = t.id AND d.membership_id = $1 AND d.local_date = $2
      WHERE t.organisation_id = $3 ORDER BY d.position`, [ctx.membership.id, today, ctx.org.id]);
    const plannedIds = new Set(planned.map((t) => t.id));
    const assigned = (await db.query<TaskRow>(`${TASK_SELECT}
      WHERE t.organisation_id = $1 AND t.assignee_membership_id = $2 AND t.archived_at IS NULL AND t.status <> 'completed' AND p.status = 'active'
      ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'in_review' THEN 3 ELSE 2 END, t.due_at NULLS LAST, t.priority DESC, t.created_at`, [ctx.org.id, ctx.membership.id]))
      .filter((t) => !plannedIds.has(t.id));
    const overdue = assigned.filter((t) => t.due_at && new Date(t.due_at) < new Date());
    const report = await db.maybeOne<{ id: string; status: string; current_version: number }>(`SELECT id, status, current_version FROM daily_reports WHERE membership_id = $1 AND local_date = $2`, [ctx.membership.id, today]);
    const todaySeconds = await db.one<{ n: number }>(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, now()), $3::timestamptz + interval '1 day') - GREATEST(i.started_at, $3::timestamptz))))::int, 0) AS n
       FROM session_intervals i WHERE i.membership_id = $1 AND i.confirmation_status = 'confirmed' AND i.started_at < $3::timestamptz + interval '1 day' AND COALESCE(i.ended_at, now()) > $3::timestamptz`,
      [ctx.membership.id, ctx.org.id, dayStartIso(today, ctx.org.timezone)]);
    const projects = await db.query<{ id: string; name: string }>(`SELECT p.id, p.name FROM projects p WHERE p.organisation_id = $1 AND p.status = 'active' AND (app_has_role($1, 'owner', 'hr', 'manager') OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.membership_id = $2)) ORDER BY p.name`, [ctx.org.id, ctx.membership.id]);
    const members = await db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id]);
    return { today, planned, assigned, overdue, report, todaySeconds: todaySeconds.n, projects, members };
  });
}

import { localMidnight } from "@/server/lib/time";
function dayStartIso(date: string, tz: string) { return localMidnight(date, tz).toISOString(); }

export async function listProjects(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string; description: string | null; status: string; open_tasks: number; blocked_tasks: number; members: number; created_at: string }>(
    `SELECT p.id, p.name, p.description, p.status, p.created_at,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status NOT IN ('completed') AND t.archived_at IS NULL)::int AS open_tasks,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'blocked' AND t.archived_at IS NULL)::int AS blocked_tasks,
            (SELECT count(*) FROM project_members pm WHERE pm.project_id = p.id)::int AS members
     FROM projects p WHERE p.organisation_id = $1 ORDER BY p.status, p.name`, [ctx.org.id]));
}

export async function projectDetail(ctx: OrgContext, projectId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const project = await db.maybeOne<{ id: string; name: string; description: string | null; status: string; requires_due_date: boolean; requires_estimate: boolean; created_by: string }>(`SELECT id, name, description, status, requires_due_date, requires_estimate, created_by FROM projects WHERE id = $1 AND organisation_id = $2`, [projectId, ctx.org.id]);
    if (!project) return null;
    const tasks = await db.query<TaskRow>(`${TASK_SELECT} WHERE t.project_id = $1 ORDER BY t.archived_at NULLS FIRST, CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'in_review' THEN 2 WHEN 'todo' THEN 3 ELSE 4 END, t.due_at NULLS LAST, t.created_at`, [projectId]);
    const members = await db.query<{ membership_id: string; display_name: string; access_role: string }>(`SELECT pm.membership_id, pr.display_name, pm.access_role FROM project_members pm JOIN memberships m ON m.id = pm.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE pm.project_id = $1 ORDER BY pm.access_role, pr.display_name`, [projectId]);
    const allMembers = await db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id]);
    const isLead = members.some((m) => m.membership_id === ctx.membership.id && m.access_role === "lead") || project.created_by === ctx.membership.id;
    return { project, tasks, members, allMembers, isLead };
  });
}

export async function taskDetail(ctx: OrgContext, taskId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const task = await db.maybeOne<TaskRow & { expected_output: string; created_by: string; created_by_name: string; completed_at: string | null; created_at: string }>(
      `${TASK_SELECT.replace("SELECT t.id,", "SELECT t.expected_output, t.created_by, pc.display_name AS created_by_name, t.completed_at, t.created_at, t.id,").replace("LEFT JOIN memberships mr", "JOIN memberships mc ON mc.id = t.created_by JOIN profiles pc ON pc.id = mc.user_id LEFT JOIN memberships mr")} WHERE t.id = $1 AND t.organisation_id = $2`, [taskId, ctx.org.id]);
    if (!task) return null;
    const sessions = await db.query<{ id: string; state: string; started_at: string; ended_at: string | null; stop_outcome: string | null; stop_note: string | null; member_name: string; confirmed_seconds: number; uncertain_seconds: number }>(
      `SELECT s.id, s.state, s.started_at, s.ended_at, s.stop_outcome, s.stop_note, pr.display_name AS member_name,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at)))::int FROM session_intervals i WHERE i.session_id = s.id AND i.confirmation_status = 'confirmed'), 0) AS confirmed_seconds,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at)))::int FROM session_intervals i WHERE i.session_id = s.id AND i.confirmation_status = 'uncertain'), 0) AS uncertain_seconds
       FROM work_sessions s JOIN memberships m ON m.id = s.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE s.task_id = $1 ORDER BY s.started_at DESC LIMIT 50`, [taskId]);
    const submissions = await db.query<{ id: string; revision: number; note: string; submitted_at: string; submitted_by_name: string }>(
      `SELECT s.id, s.revision, s.note, s.submitted_at, pr.display_name AS submitted_by_name FROM task_submissions s JOIN memberships m ON m.id = s.submitted_by JOIN profiles pr ON pr.id = m.user_id WHERE s.task_id = $1 ORDER BY s.revision DESC`, [taskId]);
    const deliverables = submissions.length ? await db.query<{ id: string; submission_id: string; kind: string; url: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null; scan_status: string; notes: string | null; created_at: string }>(
      `SELECT id, submission_id, kind, url, file_name, mime_type, size_bytes, scan_status, notes, created_at FROM deliverables WHERE submission_id = ANY($1::uuid[]) ORDER BY created_at`, [submissions.map((s) => s.id)]) : [];
    const reviews = submissions.length ? await db.query<{ id: string; submission_id: string; decision: string; note: string; reviewed_at: string; reviewer_name: string }>(
      `SELECT r.id, r.submission_id, r.decision, r.note, r.reviewed_at, pr.display_name AS reviewer_name FROM reviews r JOIN memberships m ON m.id = r.reviewer_membership_id JOIN profiles pr ON pr.id = m.user_id WHERE r.submission_id = ANY($1::uuid[]) ORDER BY r.reviewed_at`, [submissions.map((s) => s.id)]) : [];
    const comments = await db.query<{ id: string; body: string; created_at: string; author_name: string }>(`SELECT c.id, c.body, c.created_at, pr.display_name AS author_name FROM task_comments c JOIN memberships m ON m.id = c.author_membership_id JOIN profiles pr ON pr.id = m.user_id WHERE c.task_id = $1 ORDER BY c.created_at`, [taskId]);
    const history = await db.query<{ from_status: string | null; to_status: string; reason: string | null; occurred_at: string; actor_name: string | null }>(`SELECT h.from_status, h.to_status, h.reason, h.occurred_at, pr.display_name AS actor_name FROM task_status_history h LEFT JOIN memberships m ON m.id = h.actor_membership_id LEFT JOIN profiles pr ON pr.id = m.user_id WHERE h.task_id = $1 ORDER BY h.occurred_at`, [taskId]);
    const members = await db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id]);
    const manages = await db.one<{ v: boolean }>(`SELECT (app_has_role($1, 'owner', 'hr') OR app_manages($1, $2) OR app_is_project_lead($1, $3)) AS v`, [ctx.org.id, task.assignee_membership_id, task.project_id]);
    return { task, sessions, submissions, deliverables, reviews, comments, history, members, canManage: manages.v };
  });
}

export type TeamStatusRow = {
  membership_id: string; display_name: string; employee_code: string; role: string; teams: string[];
  session_id: string | null; session_state: string | null; task_id: string | null; task_title: string | null; started_at: string | null; last_heartbeat_at: string | null;
  today_seconds: number; blocked_tasks: number; open_tasks: number; in_review_tasks: number; last_activity_at: string | null;
};

/** Reported activity for members the caller may see (RLS filters sessions; membership list is org-wide). */
export async function teamStatus(ctx: OrgContext, filters: { teamId?: string | null } = {}) {
  return withUser(ctx.user.profileId, async (db) => {
    const today = todayLocal(ctx.org.timezone);
    const dayStart = dayStartIso(today, ctx.org.timezone);
    const rows = await db.query<TeamStatusRow>(
      `SELECT m.id AS membership_id, pr.display_name, m.employee_code, m.role,
              COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id), '{}') AS teams,
              s.id AS session_id, s.state AS session_state, s.task_id, tk.title AS task_title, s.started_at, s.last_heartbeat_at,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, now()), $2::timestamptz + interval '1 day') - GREATEST(i.started_at, $2::timestamptz))))::int
                        FROM session_intervals i WHERE i.membership_id = m.id AND i.confirmation_status = 'confirmed' AND i.started_at < $2::timestamptz + interval '1 day' AND COALESCE(i.ended_at, now()) > $2::timestamptz), 0) AS today_seconds,
              (SELECT count(*) FROM tasks t WHERE t.assignee_membership_id = m.id AND t.status = 'blocked' AND t.archived_at IS NULL)::int AS blocked_tasks,
              (SELECT count(*) FROM tasks t WHERE t.assignee_membership_id = m.id AND t.status IN ('todo','in_progress','blocked') AND t.archived_at IS NULL)::int AS open_tasks,
              (SELECT count(*) FROM tasks t WHERE t.assignee_membership_id = m.id AND t.status = 'in_review' AND t.archived_at IS NULL)::int AS in_review_tasks,
              (SELECT MAX(COALESCE(ws.ended_at, ws.last_heartbeat_at)) FROM work_sessions ws WHERE ws.membership_id = m.id) AS last_activity_at
       FROM memberships m JOIN profiles pr ON pr.id = m.user_id
       LEFT JOIN work_sessions s ON s.membership_id = m.id AND s.state IN ('running','paused','interrupted')
       LEFT JOIN tasks tk ON tk.id = s.task_id
       WHERE m.organisation_id = $1 AND m.status = 'active'
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.membership_id = m.id AND tm.team_id = $3))
         AND app_can_view_records($1, m.id)
       ORDER BY (s.id IS NULL), pr.display_name`, [ctx.org.id, dayStart, filters.teamId ?? null]);
    const teams = await db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]);
    const timings = await db.maybeOne<{ stale_after_seconds: number }>(`SELECT stale_after_seconds FROM policies WHERE id = $1`, [ctx.org.current_policy_id]);
    const now = await db.one<{ now: string }>(`SELECT now() AS now`);
    return { rows, teams, staleAfterSeconds: timings?.stale_after_seconds ?? 90, serverNow: now.now, today };
  });
}

export async function peopleView(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const members = await db.query<{ id: string; display_name: string; email: string; employee_code: string; role: string; status: string; created_at: string; teams: { id: string; name: string; is_manager: boolean }[]; acknowledged: boolean }>(
      `SELECT m.id, pr.display_name, pr.email, m.employee_code, m.role, m.status, m.created_at,
              COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'is_manager', tm.is_manager) ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id), '[]'::json) AS teams,
              EXISTS (SELECT 1 FROM policy_acknowledgements a WHERE a.membership_id = m.id AND a.policy_id = $2) AS acknowledged
       FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 ORDER BY m.status, pr.display_name`, [ctx.org.id, ctx.org.current_policy_id]);
    const invitations = await db.query<{ id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; sent_at: string | null; created_at: string; team_name: string | null }>(
      `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.sent_at, i.created_at, t.name AS team_name FROM invitations i LEFT JOIN teams t ON t.id = i.team_id WHERE i.organisation_id = $1 ORDER BY i.created_at DESC LIMIT 100`, [ctx.org.id]);
    const teams = await db.query<{ id: string; name: string; member_count: number }>(`SELECT t.id, t.name, (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id)::int AS member_count FROM teams t WHERE t.organisation_id = $1 AND t.archived_at IS NULL ORDER BY t.name`, [ctx.org.id]);
    return { members, invitations, teams };
  });
}

export async function notificationsView(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; type: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string }>(
    `SELECT id, type, title, body, href, read_at, created_at FROM notifications WHERE recipient_membership_id = $1 ORDER BY created_at DESC LIMIT 100`, [ctx.membership.id]));
}

export async function auditView(ctx: OrgContext, filters: { action?: string; from?: string; to?: string; membershipId?: string } = {}) {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; action: string; subject_type: string; subject_id: string | null; occurred_at: string; metadata: Record<string, unknown>; actor_name: string | null; subject_name: string | null }>(
    `SELECT a.id, a.action, a.subject_type, a.subject_id, a.occurred_at, a.metadata, pa.display_name AS actor_name, ps.display_name AS subject_name
     FROM audit_events a
     LEFT JOIN memberships ma ON ma.id = a.actor_membership_id LEFT JOIN profiles pa ON pa.id = ma.user_id
     LEFT JOIN memberships ms ON ms.id = a.subject_membership_id LEFT JOIN profiles ps ON ps.id = ms.user_id
     WHERE a.organisation_id = $1
       AND ($2::text IS NULL OR a.action LIKE $2 || '%')
       AND ($3::timestamptz IS NULL OR a.occurred_at >= $3)
       AND ($4::timestamptz IS NULL OR a.occurred_at < $4)
       AND ($5::uuid IS NULL OR a.actor_membership_id = $5 OR a.subject_membership_id = $5)
     ORDER BY a.occurred_at DESC LIMIT 200`, [ctx.org.id, filters.action || null, filters.from || null, filters.to || null, filters.membershipId || null]));
}

export async function settingsView(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const policy = await db.maybeOne<{ id: string; version: number; recording_mode: string; retention_days: number; notice_text: string; heartbeat_seconds: number; stale_after_seconds: number; reminder_minutes_before_end: number; invitation_ttl_hours: number; attachment_max_bytes: number; attachment_mime_types: string[]; effective_at: string | null }>(`SELECT id, version, recording_mode, retention_days, notice_text, heartbeat_seconds, stale_after_seconds, reminder_minutes_before_end, invitation_ttl_hours, attachment_max_bytes, attachment_mime_types, effective_at FROM policies WHERE id = $1`, [ctx.org.current_policy_id]);
    const schedule = await db.maybeOne<{ timezone: string; working_days: number[]; start_local: string; end_local: string; effective_from: string }>(`SELECT timezone, working_days, start_local, end_local, effective_from FROM schedules WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1`, [ctx.org.id]);
    const grants = await db.query<{ id: string; grantee_name: string; grantee_membership_id: string; scope_type: string; scope_name: string | null; granted_by_name: string; granted_at: string }>(
      `SELECT g.id, pr.display_name AS grantee_name, g.grantee_membership_id, g.scope_type, t.name AS scope_name, pg.display_name AS granted_by_name, g.granted_at
       FROM recording_grants g JOIN memberships m ON m.id = g.grantee_membership_id JOIN profiles pr ON pr.id = m.user_id
       JOIN memberships mg ON mg.id = g.granted_by JOIN profiles pg ON pg.id = mg.user_id LEFT JOIN teams t ON t.id = g.scope_id
       WHERE g.organisation_id = $1 AND g.revoked_at IS NULL ORDER BY g.granted_at DESC`, [ctx.org.id]);
    const members = await db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id]);
    const teams = await db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]);
    const counts = await db.one<{ members: number; teams: number; projects: number; acknowledged: number }>(
      `SELECT (SELECT count(*) FROM memberships WHERE organisation_id = $1 AND status = 'active')::int AS members,
              (SELECT count(*) FROM teams WHERE organisation_id = $1 AND archived_at IS NULL)::int AS teams,
              (SELECT count(*) FROM projects WHERE organisation_id = $1 AND status = 'active')::int AS projects,
              (SELECT count(*) FROM policy_acknowledgements WHERE organisation_id = $1 AND policy_id = $2)::int AS acknowledged`, [ctx.org.id, ctx.org.current_policy_id]);
    return { policy, schedule, grants, members, teams, counts };
  });
}

export async function policyView(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const policy = await db.maybeOne<{ id: string; version: number; recording_mode: string; retention_days: number; notice_text: string; effective_at: string | null }>(`SELECT id, version, recording_mode, retention_days, notice_text, effective_at FROM policies WHERE id = $1`, [ctx.org.current_policy_id]);
    const ack = await db.maybeOne<{ acknowledged_at: string }>(`SELECT acknowledged_at FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id]);
    const history = await db.query<{ policy_id: string; version: number; acknowledged_at: string }>(`SELECT a.policy_id, p.version, a.acknowledged_at FROM policy_acknowledgements a JOIN policies p ON p.id = a.policy_id WHERE a.membership_id = $1 ORDER BY a.acknowledged_at DESC`, [ctx.membership.id]);
    return { policy, acknowledgedAt: ack?.acknowledged_at ?? null, history };
  });
}

export type { Db };
