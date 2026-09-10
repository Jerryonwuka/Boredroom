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
    const assigneeRow = await db.maybeOne(`SELECT 1 FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [assignee, ctx.org.id]);
    if (!assigneeRow) throw invalid("Assignee is not an active member.", { assigneeMembershipId: ["Not an active member."] });
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
