import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { audit, notify, managersOf } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "in_review", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  expectedOutput: z.string().trim().min(1).max(4000),
  assigneeMembershipId: z.string().uuid().optional(),
  reviewerMembershipId: z.string().uuid().nullable().optional(),
  category: z.enum(["work", "meeting", "offline", "admin"]).default("work"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  captureRequirement: z.enum(["none", "optional", "required"]).default("none"),
  addToMyDay: z.boolean().default(false),
});

export const updateTaskSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  expectedOutput: z.string().trim().min(1).max(4000).optional(),
  reviewerMembershipId: z.string().uuid().nullable().optional(),
  assigneeMembershipId: z.string().uuid().optional(),
  category: z.enum(["work", "meeting", "offline", "admin"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  captureRequirement: z.enum(["none", "optional", "required"]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  reason: z.string().trim().max(2000).optional(),
  archive: z.boolean().optional(),
});

type ProjectRow = { id: string; status: string; requires_due_date: boolean; requires_estimate: boolean };

async function loadProject(db: Db, orgId: string, projectId: string): Promise<ProjectRow> {
  const p = await db.maybeOne<ProjectRow>(`SELECT id, status, requires_due_date, requires_estimate FROM projects WHERE id = $1 AND organisation_id = $2`, [projectId, orgId]);
  if (!p) throw notFound("Project not found.");
  return p;
}

async function canManageAssignee(db: Db, ctx: OrgContext, assigneeMembershipId: string, projectId: string): Promise<boolean> {
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") return true;
  const r = await db.one<{ manages: boolean; lead: boolean; member: boolean }>(
    `SELECT app_manages($1, $2) AS manages, app_is_project_lead($1, $3) AS lead,
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $3 AND pm.membership_id = $4) AS member`,
    [ctx.org.id, assigneeMembershipId, projectId, ctx.membership.id]);
  if (r.manages || r.lead) return true;
  return assigneeMembershipId === ctx.membership.id && r.member;
}

export async function createTask(ctx: OrgContext, input: z.infer<typeof createTaskSchema>, requestId?: string) {
  const assignee = input.assigneeMembershipId ?? ctx.membership.id;
  if (input.reviewerMembershipId && input.reviewerMembershipId === assignee) throw invalid("Reviewer must be a different person from the assignee.", { reviewerMembershipId: ["Choose someone other than the assignee."] });
  return withUser(ctx.user.profileId, async (db) => {
    const project = await loadProject(db, ctx.org.id, input.projectId);
    if (project.status !== "active") throw conflict("PROJECT_ARCHIVED", "Tasks cannot be created in an archived project.");
    if (project.requires_due_date && !input.dueAt) throw invalid("This project requires a due date.", { dueAt: ["Required by project policy."] });
    if (project.requires_estimate && !input.estimateMinutes) throw invalid("This project requires an effort estimate.", { estimateMinutes: ["Required by project policy."] });
    if (!(await canManageAssignee(db, ctx, assignee, input.projectId))) throw forbidden("You cannot assign tasks to that person in this project.");
    const assigneeRow = await db.maybeOne<{ role: string }>(`SELECT role FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [assignee, ctx.org.id]);
    if (!assigneeRow) throw invalid("Assignee is not an active member.", { assigneeMembershipId: ["Not an active member."] });
    // Organisation accounts manage and supervise; tasks are only for staff and team leads.
    if (assigneeRow.role === "owner" || assigneeRow.role === "hr") throw invalid("Tasks are for staff and team leads. Organisation accounts supervise; they do not hold tasks.", { assigneeMembershipId: ["Organisation accounts cannot be assigned tasks."] });
    if (input.reviewerMembershipId) {
      const rev = await db.maybeOne(`SELECT 1 FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [input.reviewerMembershipId, ctx.org.id]);
      if (!rev) throw invalid("Reviewer is not an active member.", { reviewerMembershipId: ["Not an active member."] });
    }
    const task = await db.one<{ id: string; version: number }>(
      `INSERT INTO tasks(organisation_id, project_id, assignee_membership_id, reviewer_membership_id, created_by, title, expected_output, category, priority, estimate_minutes, due_at, capture_requirement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, version`,
      [ctx.org.id, input.projectId, assignee, input.reviewerMembershipId ?? null, ctx.membership.id, input.title, input.expectedOutput, input.category, input.priority, input.estimateMinutes ?? null, input.dueAt ?? null, input.captureRequirement]);
    await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status) VALUES ($1, $2, $3, NULL, 'todo')`, [ctx.org.id, task.id, ctx.membership.id]);
    if (input.addToMyDay && assignee === ctx.membership.id) {
      await db.query(`INSERT INTO daily_plan_items(organisation_id, membership_id, local_date, task_id, position)
        VALUES ($1, $2, (now() AT TIME ZONE $3)::date, $4, COALESCE((SELECT MAX(position) + 1 FROM daily_plan_items WHERE membership_id = $2 AND local_date = (now() AT TIME ZONE $3)::date), 0))
        ON CONFLICT DO NOTHING`, [ctx.org.id, ctx.membership.id, ctx.org.timezone, task.id]);
    }
    if (assignee !== ctx.membership.id) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: assignee, type: "task.assigned", title: `New task: ${input.title}`, body: `Assigned by ${ctx.user.displayName}`, resourceType: "task", resourceId: task.id, href: `/app/${ctx.org.slug}/tasks/${task.id}`, dedupKey: `task.assigned:${task.id}:${assignee}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task.created", subjectType: "task", subjectId: task.id, subjectMembershipId: assignee, requestId, metadata: { title: input.title, projectId: input.projectId } });
    return task;
  });
}

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["blocked", "in_review", "todo"],
  blocked: ["in_progress"],
  in_review: ["in_progress"],
  completed: ["in_progress"],
};

export async function updateTask(ctx: OrgContext, taskId: string, input: z.infer<typeof updateTaskSchema>, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ id: string; version: number; status: TaskStatus; assignee_membership_id: string; reviewer_membership_id: string | null; project_id: string; archived_at: string | null; title: string }>(
      `SELECT id, version, status, assignee_membership_id, reviewer_membership_id, project_id, archived_at, title FROM tasks WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    if (t.version !== input.expectedVersion) throw conflict("VERSION_CONFLICT", "This task changed since you loaded it. Reload and try again.", { currentVersion: t.version });
    const isAssignee = t.assignee_membership_id === ctx.membership.id;
    const isReviewer = t.reviewer_membership_id === ctx.membership.id;
    const manages = await canManageAssignee(db, ctx, t.assignee_membership_id, t.project_id);
    if (!isAssignee && !isReviewer && !manages) throw forbidden();

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (input.title !== undefined) push("title", input.title);
    if (input.expectedOutput !== undefined) push("expected_output", input.expectedOutput);
    if (input.category !== undefined) push("category", input.category);
    if (input.priority !== undefined) push("priority", input.priority);
    if (input.estimateMinutes !== undefined) push("estimate_minutes", input.estimateMinutes);
    if (input.dueAt !== undefined) push("due_at", input.dueAt);
    if (input.captureRequirement !== undefined) { if (!manages) throw forbidden("Only managers can change capture requirements."); push("capture_requirement", input.captureRequirement); }
    if (input.reviewerMembershipId !== undefined) {
      if (input.reviewerMembershipId && input.reviewerMembershipId === t.assignee_membership_id) throw invalid("Reviewer must differ from assignee.", { reviewerMembershipId: ["Choose someone other than the assignee."] });
      push("reviewer_membership_id", input.reviewerMembershipId);
    }
    if (input.assigneeMembershipId !== undefined && input.assigneeMembershipId !== t.assignee_membership_id) {
      if (!manages) throw forbidden("Only managers can reassign tasks.");
      const target = await db.maybeOne<{ role: string }>(`SELECT role FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [input.assigneeMembershipId, ctx.org.id]);
      if (!target) throw invalid("Assignee is not an active member.", { assigneeMembershipId: ["Not an active member."] });
      if (target.role === "owner" || target.role === "hr") throw invalid("Organisation accounts cannot be assigned tasks.", { assigneeMembershipId: ["Organisation accounts cannot be assigned tasks."] });
      const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE task_id = $1 AND state IN ('running','paused','interrupted')`, [taskId]);
      if (open) throw conflict("SESSION_OPEN", "This task has an open work session. The employee must stop it before reassignment.");
      if (input.assigneeMembershipId === t.reviewer_membership_id) throw invalid("Assignee cannot be the reviewer.", { assigneeMembershipId: ["Assignee cannot be the reviewer."] });
      push("assignee_membership_id", input.assigneeMembershipId);
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: input.assigneeMembershipId, type: "task.assigned", title: `Task reassigned to you: ${t.title}`, resourceType: "task", resourceId: t.id, href: `/app/${ctx.org.slug}/tasks/${t.id}`, dedupKey: `task.assigned:${t.id}:${input.assigneeMembershipId}:${t.version}` });
    }
    if (input.archive) {
      const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE task_id = $1 AND state IN ('running','paused','interrupted')`, [taskId]);
      if (open) throw conflict("SESSION_OPEN", "Stop the open work session before archiving this task.");
      push("archived_at", new Date().toISOString());
    }
    if (input.status !== undefined && input.status !== t.status) {
      if (t.archived_at) throw conflict("TASK_ARCHIVED", "Archived tasks cannot change status.");
      if (!TRANSITIONS[t.status].includes(input.status)) throw conflict("BAD_TRANSITION", `A task cannot move from ${t.status} to ${input.status} directly.`);
      if (input.status === "in_review") throw conflict("BAD_TRANSITION", "Submit evidence to move a task into review.");
      if (t.status === "completed") {
        if (!(isReviewer || manages)) throw forbidden("Only the reviewer or a manager can reopen completed work.");
        if (!input.reason) throw invalid("Give a reason for reopening.", { reason: ["Required when reopening completed work."] });
      }
      if (t.status === "in_review" && !(isReviewer || manages)) throw forbidden("Only the reviewer can return work from review.");
      if (input.status === "blocked" && !input.reason) throw invalid("Describe what is blocking the task.", { reason: ["Required when marking blocked."] });
      push("status", input.status);
      push("blocked_reason", input.status === "blocked" ? input.reason : null);
      if (input.status !== "completed") push("completed_at", null);
      await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.org.id, taskId, ctx.membership.id, t.status, input.status, input.reason ?? null]);
      if (input.status === "blocked") {
        for (const mgr of await managersOf(db, ctx.org.id, t.assignee_membership_id)) {
          await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "task.blocked", title: `Blocked: ${t.title}`, body: input.reason, resourceType: "task", resourceId: t.id, href: `/app/${ctx.org.slug}/tasks/${t.id}`, dedupKey: `task.blocked:${t.id}:${t.version}` });
        }
      }
    }
    if (sets.length === 0) return { id: t.id, version: t.version };
    params.push(taskId);
    const updated = await db.one<{ version: number }>(`UPDATE tasks SET ${sets.join(", ")}, version = version + 1 WHERE id = $${params.length} RETURNING version`, params);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: input.archive ? "task.archived" : "task.updated", subjectType: "task", subjectId: taskId, subjectMembershipId: t.assignee_membership_id, requestId, metadata: { changed: Object.keys(input).filter((k) => k !== "expectedVersion"), status: input.status, reason: input.reason } });
    return { id: t.id, version: updated.version };
  });
}

export async function addComment(ctx: OrgContext, taskId: string, body: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const t = await db.maybeOne<{ assignee_membership_id: string; reviewer_membership_id: string | null; title: string }>(`SELECT assignee_membership_id, reviewer_membership_id, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    const c = await db.one<{ id: string }>(`INSERT INTO task_comments(organisation_id, task_id, author_membership_id, body) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.org.id, taskId, ctx.membership.id, body]);
    for (const r of [t.assignee_membership_id, t.reviewer_membership_id]) {
      if (r && r !== ctx.membership.id) await notify(db, { organisationId: ctx.org.id, recipientMembershipId: r, type: "task.comment", title: `${ctx.user.displayName} commented on ${t.title}`, body: body.slice(0, 200), resourceType: "task", resourceId: taskId, href: `/app/${ctx.org.slug}/tasks/${taskId}`, dedupKey: `comment:${c.id}:${r}` });
    }
    return c;
  });
}

export const planSchema = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), taskIds: z.array(z.string().uuid()).max(50) });

/** Replaces the employee's own My Day order for a date. Order is employee-specific. */
export async function setDailyPlan(ctx: OrgContext, input: z.infer<typeof planSchema>) {
  return withUser(ctx.user.profileId, async (db) => {
    await db.query(`DELETE FROM daily_plan_items WHERE membership_id = $1 AND local_date = $2`, [ctx.membership.id, input.localDate]);
    for (let i = 0; i < input.taskIds.length; i++) {
      await db.query(`INSERT INTO daily_plan_items(organisation_id, membership_id, local_date, task_id, position) VALUES ($1, $2, $3, $4, $5)`,
        [ctx.org.id, ctx.membership.id, input.localDate, input.taskIds[i], i]);
    }
  });
}

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  requiresDueDate: z.boolean().default(false),
  requiresEstimate: z.boolean().default(false),
  memberIds: z.array(z.string().uuid()).default([]),
});

export async function createProject(ctx: OrgContext, input: z.infer<typeof createProjectSchema>) {
  if (!["owner", "hr", "manager"].includes(ctx.membership.role)) throw forbidden("Employees cannot create projects.");
  return withUser(ctx.user.profileId, async (db) => {
    const p = await db.one<{ id: string }>(`INSERT INTO projects(organisation_id, name, description, requires_due_date, requires_estimate, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ctx.org.id, input.name, input.description ?? null, input.requiresDueDate, input.requiresEstimate, ctx.membership.id]);
    await db.query(`INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'lead')`, [ctx.org.id, p.id, ctx.membership.id]);
    for (const m of input.memberIds) {
      if (m === ctx.membership.id) continue;
      await db.query(`INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, 'contributor') ON CONFLICT DO NOTHING`, [ctx.org.id, p.id, m]);
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "project.created", subjectType: "project", subjectId: p.id, metadata: { name: input.name } });
    return p;
  });
}

export async function setProjectMember(ctx: OrgContext, projectId: string, membershipId: string, accessRole: "lead" | "contributor" | "viewer" | "remove") {
  return withUser(ctx.user.profileId, async (db) => {
    if (accessRole === "remove") await db.query(`DELETE FROM project_members WHERE project_id = $1 AND membership_id = $2 AND organisation_id = $3`, [projectId, membershipId, ctx.org.id]);
    else await db.query(`INSERT INTO project_members(organisation_id, project_id, membership_id, access_role) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, membership_id) DO UPDATE SET access_role = EXCLUDED.access_role`, [ctx.org.id, projectId, membershipId, accessRole]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "project.member_set", subjectType: "project", subjectId: projectId, subjectMembershipId: membershipId, metadata: { accessRole } });
  });
}

export async function archiveProject(ctx: OrgContext, projectId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const open = await db.maybeOne(`SELECT 1 FROM work_sessions s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = $1 AND s.state IN ('running','paused','interrupted')`, [projectId]);
    if (open) throw conflict("SESSION_OPEN", "Stop open work sessions in this project before archiving it.");
    const r = await db.maybeOne(`UPDATE projects SET status = 'archived', archived_at = now() WHERE id = $1 AND organisation_id = $2 AND status = 'active' RETURNING id`, [projectId, ctx.org.id]);
    if (!r) throw notFound("Project not found.");
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "project.archived", subjectType: "project", subjectId: projectId });
  });
}

/** The team lead of the first team a member belongs to (used as the default reviewer). */
export async function defaultReviewerFor(db: Db, orgId: string, membershipId: string): Promise<string | null> {
  const r = await db.maybeOne<{ membership_id: string }>(
    `SELECT mgr.membership_id FROM team_members tm JOIN team_members mgr ON mgr.team_id = tm.team_id AND mgr.is_manager AND mgr.membership_id <> tm.membership_id
     JOIN teams t ON t.id = tm.team_id WHERE tm.organisation_id = $1 AND tm.membership_id = $2 AND t.archived_at IS NULL ORDER BY t.name LIMIT 1`, [orgId, membershipId]);
  if (r) return r.membership_id;
  // No team lead: fall back to an organisation account so work can still be reviewed.
  const o = await db.maybeOne<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role IN ('hr','owner') AND id <> $2 ORDER BY (role = 'hr') DESC, created_at LIMIT 1`, [orgId, membershipId]);
  return o?.id ?? null;
}

/** Where a member's own to-dos go: their team's working project, else a personal project created on first use. */
export async function todoProjectFor(db: Db, ctx: OrgContext): Promise<string> {
  const team = await db.maybeOne<{ team_id: string; project_id: string; is_manager: boolean }>(
    `SELECT t.id AS team_id, t.project_id, tm.is_manager FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN projects p ON p.id = t.project_id
     WHERE tm.membership_id = $1 AND t.archived_at IS NULL AND p.status = 'active' ORDER BY t.name LIMIT 1`, [ctx.membership.id]);
  if (team?.project_id) {
    // Make sure the member has access to their team's working project (idempotent).
    await db.query(`SELECT app_sync_team_project_member($1, $2, $3, $4)`, [ctx.org.id, team.team_id, ctx.membership.id, team.is_manager ? "lead" : "contributor"]);
    return team.project_id;
  }
  const existing = await db.maybeOne<{ project_id: string }>(`SELECT pm.project_id FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE pm.membership_id = $1 AND pm.access_role = 'lead' AND p.status = 'active' AND p.name = $2`, [ctx.membership.id, `${ctx.user.displayName}'s to-dos`]);
  if (existing) return existing.project_id;
  const created = await db.one<{ id: string }>(`SELECT app_create_personal_project($1, $2, $3) AS id`, [ctx.org.id, ctx.membership.id, `${ctx.user.displayName}'s to-dos`]);
  return created.id;
}

export const quickTodoSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** Team leads may hand a to-do to someone on their team; staff can only add for themselves. */
  assigneeMembershipId: z.string().uuid().nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
});

/**
 * One-line to-do: title only, or title plus a description, deadline and (for team leads) an assignee.
 * Project, reviewer and today's plan are filled in automatically; an assignee who is not the creator is notified.
 */
export async function quickTodo(ctx: OrgContext, input: z.infer<typeof quickTodoSchema>, requestId?: string) {
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") throw forbidden("Organisation accounts supervise; they do not hold tasks.");
  const assignee = input.assigneeMembershipId ?? ctx.membership.id;
  const forSelf = assignee === ctx.membership.id;
  const projectId = await withUser(ctx.user.profileId, (db) => todoProjectFor(db, ctx));
  // Own to-dos are checked by the team lead; a to-do handed out by a lead is checked by that lead.
  const reviewer = forSelf ? await withUser(ctx.user.profileId, (db) => defaultReviewerFor(db, ctx.org.id, ctx.membership.id)) : ctx.membership.id;
  return createTask(ctx, { projectId, title: input.title, expectedOutput: input.description?.trim() || input.title, assigneeMembershipId: assignee, reviewerMembershipId: reviewer, category: "work", priority: "normal", estimateMinutes: input.estimateMinutes ?? null, dueAt: input.dueAt ?? null, captureRequirement: "none", addToMyDay: forSelf }, requestId);
}

/** People a member may hand to-dos to: everyone on the teams they lead (owner/HR see everyone who can hold tasks). */
export async function assignableMembers(ctx: OrgContext): Promise<{ id: string; display_name: string; team_name: string }[]> {
  return withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string; team_name: string }>(
    `SELECT DISTINCT ON (m.id) m.id, pr.display_name, t.name AS team_name
     FROM team_members lead JOIN teams t ON t.id = lead.team_id AND t.archived_at IS NULL
     JOIN team_members tm ON tm.team_id = lead.team_id JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' AND m.role IN ('employee','manager')
     JOIN profiles pr ON pr.id = m.user_id
     WHERE lead.membership_id = $1 AND lead.is_manager AND m.id <> $1
     ORDER BY m.id, t.name`, [ctx.membership.id]).then((rows) => rows.sort((a, b) => a.display_name.localeCompare(b.display_name))));
}

type CompletableTask = { id: string; title: string; status: TaskStatus; assignee_membership_id: string; created_by: string; reviewer_membership_id: string | null; archived_at: string | null; version: number };

/** Marks a member's own to-do completed in one step (no review round-trip). Caller holds the row lock. */
export async function completeOwnTaskInternal(db: Db, ctx: OrgContext, t: CompletableTask, note: string | null, requestId?: string) {
  if (t.archived_at) throw conflict("TASK_ARCHIVED", "Archived tasks cannot be completed.");
  if (t.status === "completed") return { id: t.id, version: t.version, completed: true as const };
  if (t.status === "in_review") throw conflict("TASK_IN_REVIEW", "This task is waiting for your team lead's check.");
  const open = await db.maybeOne(`SELECT 1 FROM work_sessions WHERE task_id = $1 AND state IN ('running','paused','interrupted')`, [t.id]);
  if (open) throw conflict("SESSION_OPEN", "Stop the running session on this task first.");
  const updated = await db.one<{ version: number }>(`UPDATE tasks SET status = 'completed', completed_at = now(), blocked_reason = NULL, version = version + 1 WHERE id = $1 RETURNING version`, [t.id]);
  await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, 'completed', $5)`, [ctx.org.id, t.id, ctx.membership.id, t.status, note || "Marked done"]);
  if (note) await db.query(`INSERT INTO task_comments(organisation_id, task_id, author_membership_id, body) VALUES ($1, $2, $3, $4)`, [ctx.org.id, t.id, ctx.membership.id, `Done: ${note}`]);
  await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task.completed", subjectType: "task", subjectId: t.id, subjectMembershipId: t.assignee_membership_id, requestId, metadata: { self: true } });
  return { id: t.id, version: updated.version, completed: true as const };
}

export const completeSchema = z.object({ note: z.string().trim().max(2000).default("") });

/**
 * "Done" from My Day. A to-do the member wrote for themselves is completed on the spot.
 * A task handed out by a team lead (or anyone else) is submitted for that person's check instead,
 * so leads still see finished work before it counts as done.
 */
export async function completeTask(ctx: OrgContext, taskId: string, input: z.infer<typeof completeSchema>, requestId?: string): Promise<{ id: string; version: number; completed: boolean }> {
  const decision = await withUser(ctx.user.profileId, async (db) => {
    const visible = await db.maybeOne<{ assignee_membership_id: string }>(`SELECT assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]);
    if (!visible) throw notFound("Task not found.");
    if (visible.assignee_membership_id !== ctx.membership.id) throw forbidden("Only the person the task is assigned to can mark it done.");
    const t = await db.one<CompletableTask>(`SELECT id, title, status, assignee_membership_id, created_by, reviewer_membership_id, archived_at, version FROM tasks WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [taskId, ctx.org.id]);
    const selfMade = t.created_by === ctx.membership.id;
    if (selfMade) return { kind: "completed" as const, result: await completeOwnTaskInternal(db, ctx, t, input.note || null, requestId) };
    return { kind: "submit" as const, version: t.version };
  });
  if (decision.kind === "completed") return decision.result;
  const { submitTask } = await import("@/server/services/evidence");
  await submitTask(ctx, taskId, { note: input.note || "Marked done from My Day", links: [], fileIds: [] }, requestId);
  return { id: taskId, version: decision.version + 1, completed: false };
}

/** Hides the member's completed tasks from their past-tasks list. Nothing is deleted. */
export async function clearPastTasks(ctx: OrgContext, requestId?: string): Promise<{ cleared: number }> {
  return withUser(ctx.user.profileId, async (db) => {
    const rows = await db.query<{ id: string }>(`UPDATE tasks SET cleared_at = now() WHERE organisation_id = $1 AND assignee_membership_id = $2 AND cleared_at IS NULL AND (status = 'completed' OR archived_at IS NOT NULL) RETURNING id`, [ctx.org.id, ctx.membership.id]);
    if (rows.length) await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task.past_cleared", subjectType: "membership", subjectId: ctx.membership.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { count: rows.length } });
    return { cleared: rows.length };
  });
}
