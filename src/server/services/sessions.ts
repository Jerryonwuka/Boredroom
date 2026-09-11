import { z } from "zod";
import { withUser, withWorker, isUniqueViolation, isExclusionViolation, type Db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { audit, notify, managersOf } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export type SessionState = "running" | "paused" | "interrupted" | "stopped";

export type SessionView = {
  id: string;
  taskId: string;
  taskTitle: string;
  projectName: string;
  state: SessionState;
  captureMode: string;
  captureRequirement: string;
  startedAt: string;
  endedAt: string | null;
  lastHeartbeatAt: string;
  version: number;
  estimateMinutes: number | null;
  /** Sum of confirmed interval seconds for this session, computed server-side. */
  confirmedSeconds: number;
  /** Seconds since the open interval started (already included in confirmedSeconds). */
  openIntervalStartedAt: string | null;
  uncertainSeconds: number;
  serverNow: string;
  heartbeatSeconds: number;
  staleAfterSeconds: number;
  policyAcknowledged: boolean;
};

export const startSchema = z.object({
  taskId: z.string().uuid(),
  captureMode: z.enum(["none", "optional", "required", "exception"]).default("none"),
  captureExceptionId: z.string().uuid().nullable().optional(),
});
export const versionSchema = z.object({ expectedVersion: z.number().int().positive() });
export const stopSchema = versionSchema.extend({
  note: z.string().trim().max(2000).default(""),
  outcome: z.enum(["continue_later", "blocked", "ready_for_review"]).default("continue_later"),
});
export const switchSchema = versionSchema.extend({
  nextTaskId: z.string().uuid(),
  captureMode: z.enum(["none", "optional", "required", "exception"]).default("none"),
  captureExceptionId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).default(""),
});

async function policyTimings(db: Db, policyId: string | null) {
  const p = policyId ? await db.maybeOne<{ heartbeat_seconds: number; stale_after_seconds: number; recording_mode: string }>(`SELECT heartbeat_seconds, stale_after_seconds, recording_mode FROM policies WHERE id = $1`, [policyId]) : null;
  return { heartbeatSeconds: p?.heartbeat_seconds ?? 30, staleAfterSeconds: p?.stale_after_seconds ?? 90, recordingMode: p?.recording_mode ?? "disabled" };
}

async function lockUser(db: Db, userId: string) {
  // Serialises all session mutations for one user across devices, tabs and workspaces.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userId]);
}

async function confirmedSeconds(db: Db, sessionId: string): Promise<{ confirmed: number; uncertain: number; openStartedAt: string | null }> {
  const r = await db.one<{ confirmed: number; uncertain: number; open_started_at: string | null }>(
    `SELECT COALESCE(SUM(CASE WHEN confirmation_status = 'confirmed' THEN EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) END), 0)::int AS confirmed,
            COALESCE(SUM(CASE WHEN confirmation_status = 'uncertain' THEN EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) END), 0)::int AS uncertain,
            MAX(CASE WHEN ended_at IS NULL AND confirmation_status = 'confirmed' THEN started_at END) AS open_started_at
     FROM session_intervals WHERE session_id = $1`, [sessionId]);
  return { confirmed: r.confirmed, uncertain: r.uncertain, openStartedAt: r.open_started_at };
}

export async function sessionView(db: Db, ctx: OrgContext, sessionId: string): Promise<SessionView> {
  const s = await db.maybeOne<{ id: string; task_id: string; title: string; project_name: string; state: SessionState; capture_mode: string; capture_requirement: string; started_at: string; ended_at: string | null; last_heartbeat_at: string; version: number; estimate_minutes: number | null; policy_id: string | null; membership_id: string }>(
    `SELECT s.id, s.task_id, t.title, p.name AS project_name, s.state, s.capture_mode, t.capture_requirement, s.started_at, s.ended_at, s.last_heartbeat_at, s.version, t.estimate_minutes, s.policy_id, s.membership_id
     FROM work_sessions s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id WHERE s.id = $1 AND s.organisation_id = $2`, [sessionId, ctx.org.id]);
  if (!s) throw notFound("Session not found.");
  const sums = await confirmedSeconds(db, s.id);
  const timings = await policyTimings(db, ctx.org.current_policy_id);
  const ack = ctx.org.current_policy_id ? await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [s.membership_id, ctx.org.current_policy_id]) : true;
  const now = await db.one<{ now: string }>(`SELECT now() AS now`);
  return {
    id: s.id, taskId: s.task_id, taskTitle: s.title, projectName: s.project_name, state: s.state, captureMode: s.capture_mode, captureRequirement: s.capture_requirement,
    startedAt: s.started_at, endedAt: s.ended_at, lastHeartbeatAt: s.last_heartbeat_at, version: s.version, estimateMinutes: s.estimate_minutes,
    confirmedSeconds: sums.confirmed, openIntervalStartedAt: sums.openStartedAt, uncertainSeconds: sums.uncertain, serverNow: now.now,
    heartbeatSeconds: timings.heartbeatSeconds, staleAfterSeconds: timings.staleAfterSeconds, policyAcknowledged: !!ack,
  };
}

export async function getSession(ctx: OrgContext, sessionId: string): Promise<SessionView> {
  return withUser(ctx.user.profileId, (db) => sessionView(db, ctx, sessionId));
}

/** The caller's open session, wherever it is. Cross-workspace sessions are reported without task details. */
export async function currentSession(ctx: OrgContext): Promise<{ session: SessionView | null; elsewhere: { organisationName: string; organisationSlug: string } | null }> {
  return withUser(ctx.user.profileId, async (db) => {
    const open = await db.maybeOne<{ id: string; organisation_id: string; name: string; slug: string }>(
      `SELECT s.id, s.organisation_id, o.name, o.slug FROM work_sessions s JOIN organisations o ON o.id = s.organisation_id
       WHERE s.user_id = $1 AND s.state IN ('running','paused','interrupted')`, [ctx.user.profileId]);
    if (!open) return { session: null, elsewhere: null };
    if (open.organisation_id !== ctx.org.id) return { session: null, elsewhere: { organisationName: open.name, organisationSlug: open.slug } };
    return { session: await sessionView(db, ctx, open.id), elsewhere: null };
  });
}

type StartOpts = z.infer<typeof startSchema>;

async function startInternal(db: Db, ctx: OrgContext, input: StartOpts, requestId?: string): Promise<string> {
  // Visibility check first (SELECT policy), then lock (FOR UPDATE additionally requires the UPDATE policy).
  const visible = await db.maybeOne<{ assignee_membership_id: string }>(`SELECT assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [input.taskId, ctx.org.id]);
  if (!visible) throw notFound("Task not found.");
  if (visible.assignee_membership_id !== ctx.membership.id) throw forbidden("Only the task's assignee can start a session on it.");
  const t = await db.maybeOne<{ id: string; title: string; status: string; assignee_membership_id: string; archived_at: string | null; capture_requirement: string; project_status: string }>(
    `SELECT t.id, t.title, t.status, t.assignee_membership_id, t.archived_at, t.capture_requirement, p.status AS project_status
     FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1 AND t.organisation_id = $2 FOR UPDATE OF t`, [input.taskId, ctx.org.id]);
  if (!t) throw notFound("Task not found.");
  if (t.archived_at || t.project_status !== "active") throw conflict("TASK_ARCHIVED", "Archived tasks cannot start sessions.");
  if (t.status === "completed") throw conflict("TASK_COMPLETED", "This task is completed. Reopen it (with a reason) before working on it again.");
  if (t.status === "in_review") throw conflict("TASK_IN_REVIEW", "This task is waiting for review. Wait for the reviewer's decision or ask them to return it.");

  const timings = await policyTimings(db, ctx.org.current_policy_id);
  const captureRequired = t.capture_requirement === "required" && timings.recordingMode === "required_on_designated_tasks";
  let captureMode = input.captureMode;
  if (timings.recordingMode === "disabled") captureMode = "none";
  if (captureRequired) {
    if (captureMode === "exception") {
      const ex = input.captureExceptionId ? await db.maybeOne(`SELECT 1 FROM capture_exceptions WHERE id = $1 AND membership_id = $2 AND organisation_id = $3`, [input.captureExceptionId, ctx.membership.id, ctx.org.id]) : null;
      if (!ex) throw invalid("An exception request is required to work without capture on this task.");
    } else if (captureMode !== "required") {
      throw conflict("CAPTURE_REQUIRED", "This task requires screen capture. Start recording, or request an exception.", { taskId: t.id });
    }
  }
  if (captureMode === "required" || captureMode === "optional") {
    const ack = ctx.org.current_policy_id ? await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id]) : true;
    if (!ack) throw conflict("POLICY_NOT_ACKNOWLEDGED", "Acknowledge the current monitoring policy before starting a recorded session.");
  }

  let s: { id: string; started_at: string };
  try {
    s = await db.one(
      `INSERT INTO work_sessions(organisation_id, user_id, membership_id, task_id, state, capture_mode, capture_exception_id, policy_id)
       VALUES ($1, $2, $3, $4, 'running', $5, $6, $7) RETURNING id, started_at`,
      [ctx.org.id, ctx.user.profileId, ctx.membership.id, t.id, captureMode, captureMode === "exception" ? input.captureExceptionId : null, ctx.org.current_policy_id]);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("SESSION_OPEN", "You already have an open work session. Resume it or switch.", {});
    throw err;
  }
  try {
    // now() is the transaction timestamp: identical to the session's started_at at full microsecond precision.
    await db.query(`INSERT INTO session_intervals(organisation_id, session_id, user_id, membership_id, task_id, started_at) VALUES ($1, $2, $3, $4, $5, now())`,
      [ctx.org.id, s.id, ctx.user.profileId, ctx.membership.id, t.id]);
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict("INTERVAL_OVERLAP", "Another confirmed interval overlaps this moment. Stop it first.");
    throw err;
  }
  await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, request_id, metadata) VALUES ($1, $2, $3, 'started', $4, $5)`,
    [ctx.org.id, s.id, ctx.user.profileId, requestId ?? null, JSON.stringify({ captureMode })]);
  if (t.status === "todo" || t.status === "blocked") {
    await db.query(`UPDATE tasks SET status = 'in_progress', blocked_reason = NULL, version = version + 1 WHERE id = $1`, [t.id]);
    await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status) VALUES ($1, $2, $3, $4, 'in_progress')`, [ctx.org.id, t.id, ctx.membership.id, t.status]);
  }
  await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "session.started", subjectType: "work_session", subjectId: s.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { taskId: t.id, captureMode } });
  return s.id;
}

export async function startSession(ctx: OrgContext, input: StartOpts, requestId?: string) {
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") throw forbidden("Organisation accounts supervise; they do not run timers.");
  return withUser(ctx.user.profileId, async (db) => {
    await lockUser(db, ctx.user.profileId);
    const open = await db.maybeOne<{ id: string; organisation_id: string; task_id: string; state: string }>(
      `SELECT id, organisation_id, task_id, state FROM work_sessions WHERE user_id = $1 AND state IN ('running','paused','interrupted')`, [ctx.user.profileId]);
    if (open) {
      const sameOrg = open.organisation_id === ctx.org.id;
      const details = sameOrg ? { sessionId: open.id, taskId: open.task_id, state: open.state, sameTask: open.task_id === input.taskId } : { elsewhere: true };
      throw conflict("SESSION_OPEN", sameOrg ? "You already have an open work session. Resume it or switch to this task." : "You have an open work session in another workspace. Stop it there first.", details);
    }
    const id = await startInternal(db, ctx, input, requestId);
    return sessionView(db, ctx, id);
  });
}

async function loadOwnOpen(db: Db, ctx: OrgContext, sessionId: string) {
  const s = await db.maybeOne<{ id: string; state: SessionState; version: number; task_id: string; last_heartbeat_at: string; started_at: string; capture_mode: string }>(
    `SELECT id, state, version, task_id, last_heartbeat_at, started_at, capture_mode FROM work_sessions WHERE id = $1 AND organisation_id = $2 AND membership_id = $3 FOR UPDATE`, [sessionId, ctx.org.id, ctx.membership.id]);
  if (!s) throw notFound("Session not found.");
  return s;
}

function checkVersion(s: { version: number; state: SessionState }, expected: number, targetState: SessionState) {
  if (s.version === expected) return "proceed" as const;
  // A retry after a timed-out request sees the committed result instead of a conflict.
  if (s.state === targetState && s.version === expected + 1) return "already" as const;
  throw conflict("VERSION_CONFLICT", "This session changed elsewhere. Reload to see its current state.", { currentVersion: s.version, state: s.state });
}

export async function heartbeat(ctx: OrgContext, sessionId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const s = await db.maybeOne<{ id: string; state: SessionState }>(`SELECT id, state FROM work_sessions WHERE id = $1 AND organisation_id = $2 AND membership_id = $3`, [sessionId, ctx.org.id, ctx.membership.id]);
    if (!s) throw notFound("Session not found.");
    if (s.state === "running") await db.query(`UPDATE work_sessions SET last_heartbeat_at = now() WHERE id = $1`, [sessionId]);
    return sessionView(db, ctx, sessionId);
  });
}

async function closeOpenInterval(db: Db, sessionId: string, at: "now" | string) {
  if (at === "now") await db.query(`UPDATE session_intervals SET ended_at = now() WHERE session_id = $1 AND ended_at IS NULL`, [sessionId]);
  else await db.query(`UPDATE session_intervals SET ended_at = $2 WHERE session_id = $1 AND ended_at IS NULL`, [sessionId, at]);
}

export async function pauseSession(ctx: OrgContext, sessionId: string, expectedVersion: number, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    await lockUser(db, ctx.user.profileId);
    const s = await loadOwnOpen(db, ctx, sessionId);
    if (checkVersion(s, expectedVersion, "paused") === "already") return sessionView(db, ctx, sessionId);
    if (s.state !== "running") throw conflict("BAD_STATE", `Cannot pause a ${s.state} session.`, { state: s.state, currentVersion: s.version });
    await closeOpenInterval(db, sessionId, "now");
    await db.query(`UPDATE work_sessions SET state = 'paused', version = version + 1 WHERE id = $1`, [sessionId]);
    await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, request_id) VALUES ($1, $2, $3, 'paused', $4)`, [ctx.org.id, sessionId, ctx.user.profileId, requestId ?? null]);
    return sessionView(db, ctx, sessionId);
  });
}

/** Resume opens a new interval. For interrupted sessions the gap since the last heartbeat is recorded as uncertain. */
export async function resumeSession(ctx: OrgContext, sessionId: string, expectedVersion: number, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    await lockUser(db, ctx.user.profileId);
    const s = await loadOwnOpen(db, ctx, sessionId);
    if (checkVersion(s, expectedVersion, "running") === "already") return sessionView(db, ctx, sessionId);
    if (s.state !== "paused" && s.state !== "interrupted") throw conflict("BAD_STATE", `Cannot resume a ${s.state} session.`, { state: s.state, currentVersion: s.version });
    if (s.state === "interrupted") await recordUncertainGap(db, ctx, s);
    try {
      await db.query(`INSERT INTO session_intervals(organisation_id, session_id, user_id, membership_id, task_id, started_at) VALUES ($1, $2, $3, $4, $5, now())`,
        [ctx.org.id, sessionId, ctx.user.profileId, ctx.membership.id, s.task_id]);
    } catch (err) {
      if (isExclusionViolation(err)) throw conflict("INTERVAL_OVERLAP", "Another confirmed interval overlaps this moment.");
      throw err;
    }
    await db.query(`UPDATE work_sessions SET state = 'running', last_heartbeat_at = now(), version = version + 1 WHERE id = $1`, [sessionId]);
    await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, request_id) VALUES ($1, $2, $3, 'resumed', $4)`, [ctx.org.id, sessionId, ctx.user.profileId, requestId ?? null]);
    return sessionView(db, ctx, sessionId);
  });
}

async function recordUncertainGap(db: Db, ctx: OrgContext, s: { id: string; task_id: string; last_heartbeat_at: string }) {
  // The uncertain gap runs from the last confirmed boundary to this reconciliation instant; computed in SQL to keep microsecond precision.
  const gap = await db.maybeOne<{ started_at: string }>(
    `INSERT INTO session_intervals(organisation_id, session_id, user_id, membership_id, task_id, started_at, ended_at, confirmation_status, source)
     SELECT $1, $2, $3, $4, $5, b.from_at, now(), 'uncertain', 'recovery'
     FROM (SELECT COALESCE((SELECT MAX(ended_at) FROM session_intervals WHERE session_id = $2 AND confirmation_status = 'confirmed'), $6::timestamptz) AS from_at) b
     WHERE now() > b.from_at + interval '1 second'
     RETURNING started_at`,
    [ctx.org.id, s.id, ctx.user.profileId, ctx.membership.id, s.task_id, s.last_heartbeat_at]);
  await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, metadata) VALUES ($1, $2, $3, 'reconciled', $4)`,
    [ctx.org.id, s.id, ctx.user.profileId, JSON.stringify({ uncertainFrom: gap?.started_at ?? null })]);
}

async function stopInternal(db: Db, ctx: OrgContext, s: { id: string; state: SessionState; task_id: string; last_heartbeat_at: string }, input: { note: string; outcome: "continue_later" | "blocked" | "ready_for_review" }, requestId?: string) {
  if (s.state === "interrupted") await recordUncertainGap(db, ctx, s);
  await closeOpenInterval(db, s.id, "now");
  await db.query(`UPDATE work_sessions SET state = 'stopped', ended_at = now(), stop_note = $2, stop_outcome = $3, version = version + 1 WHERE id = $1`, [s.id, input.note, input.outcome]);
  await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, request_id, metadata) VALUES ($1, $2, $3, 'stopped', $4, $5)`,
    [ctx.org.id, s.id, ctx.user.profileId, requestId ?? null, JSON.stringify({ outcome: input.outcome })]);
  const t = await db.one<{ status: string; title: string; version: number }>(`SELECT status, title, version FROM tasks WHERE id = $1 FOR UPDATE`, [s.task_id]);
  if (input.outcome === "blocked" && t.status !== "blocked") {
    await db.query(`UPDATE tasks SET status = 'blocked', blocked_reason = $2, version = version + 1 WHERE id = $1`, [s.task_id, input.note || "Blocked at end of session"]);
    await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4, 'blocked', $5)`, [ctx.org.id, s.task_id, ctx.membership.id, t.status, input.note]);
    for (const mgr of await managersOf(db, ctx.org.id, ctx.membership.id)) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: mgr, type: "task.blocked", title: `Blocked: ${t.title}`, body: input.note, resourceType: "task", resourceId: s.task_id, href: `/app/${ctx.org.slug}/tasks/${s.task_id}`, dedupKey: `task.blocked:${s.task_id}:${t.version}` });
    }
  }
  if (input.note) {
    await db.query(`INSERT INTO task_comments(organisation_id, task_id, author_membership_id, body) VALUES ($1, $2, $3, $4)`, [ctx.org.id, s.task_id, ctx.membership.id, `Progress note (${input.outcome.replace(/_/g, " ")}): ${input.note}`]);
  }
  await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "session.stopped", subjectType: "work_session", subjectId: s.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { outcome: input.outcome } });
}

export async function stopSession(ctx: OrgContext, sessionId: string, input: z.infer<typeof stopSchema>, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    await lockUser(db, ctx.user.profileId);
    const s = await loadOwnOpen(db, ctx, sessionId);
    if (checkVersion(s, input.expectedVersion, "stopped") === "already") return sessionView(db, ctx, sessionId);
    if (s.state === "stopped") throw conflict("BAD_STATE", "This session is already stopped.", { state: s.state, currentVersion: s.version });
    await stopInternal(db, ctx, s, input, requestId);
    return sessionView(db, ctx, sessionId);
  });
}

/** Closes the current session and opens the next one atomically. Capture permission for the next task must already be granted client-side. */
export async function switchSession(ctx: OrgContext, sessionId: string, input: z.infer<typeof switchSchema>, requestId?: string) {
  return withUser(ctx.user.profileId, async (db) => {
    await lockUser(db, ctx.user.profileId);
    const s = await loadOwnOpen(db, ctx, sessionId);
    if (s.state === "stopped") {
      // Retry of a completed switch: return the session that replaced it.
      const next = await db.maybeOne<{ id: string }>(`SELECT id FROM work_sessions WHERE user_id = $1 AND state IN ('running','paused','interrupted') AND task_id = $2 AND started_at >= $3`, [ctx.user.profileId, input.nextTaskId, s.started_at]);
      if (next && s.version === input.expectedVersion + 1) return sessionView(db, ctx, next.id);
      throw conflict("BAD_STATE", "This session is already stopped.", { state: s.state, currentVersion: s.version });
    }
    if (s.version !== input.expectedVersion) throw conflict("VERSION_CONFLICT", "This session changed elsewhere. Reload to see its current state.", { currentVersion: s.version, state: s.state });
    if (s.task_id === input.nextTaskId) throw conflict("SAME_TASK", "You are already working on that task.");
    await stopInternal(db, ctx, s, { note: input.note, outcome: "continue_later" }, requestId);
    const nextId = await startInternal(db, ctx, { taskId: input.nextTaskId, captureMode: input.captureMode, captureExceptionId: input.captureExceptionId }, requestId);
    await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, request_id, metadata) VALUES ($1, $2, $3, 'switched_from', $4, $5)`, [ctx.org.id, nextId, ctx.user.profileId, requestId ?? null, JSON.stringify({ previousSessionId: s.id })]);
    return sessionView(db, ctx, nextId);
  });
}

/**
 * Worker recovery: sessions whose heartbeat stopped are interrupted at the last acknowledged
 * heartbeat. Nothing after it is credited; the employee reconciles on reconnect.
 */
export async function interruptStaleSessions(): Promise<number> {
  return withWorker(async (db) => {
    const stale = await db.query<{ id: string; organisation_id: string; last_heartbeat_at: string; membership_id: string }>(
      `SELECT s.id, s.organisation_id, s.last_heartbeat_at, s.membership_id FROM work_sessions s
       LEFT JOIN policies p ON p.id = s.policy_id
       WHERE s.state = 'running' AND s.last_heartbeat_at < now() - make_interval(secs => COALESCE(p.stale_after_seconds, 90))
       FOR UPDATE OF s SKIP LOCKED`);
    for (const s of stale) {
      await db.query(`UPDATE session_intervals SET ended_at = GREATEST(started_at, $2::timestamptz) WHERE session_id = $1 AND ended_at IS NULL`, [s.id, s.last_heartbeat_at]);
      await db.query(`UPDATE work_sessions SET state = 'interrupted', version = version + 1 WHERE id = $1`, [s.id]);
      await db.query(`INSERT INTO session_events(organisation_id, session_id, event_type, metadata) VALUES ($1, $2, 'interrupted', $3)`, [s.organisation_id, s.id, JSON.stringify({ confirmedUntil: s.last_heartbeat_at, detectedAt: new Date().toISOString() })]);
      await audit(db, { organisationId: s.organisation_id, action: "session.interrupted", subjectType: "work_session", subjectId: s.id, subjectMembershipId: s.membership_id, metadata: { confirmedUntil: s.last_heartbeat_at } });
    }
    return stale.length;
  });
}
