/**
 * What the subject's assistant may share in a follow-up (owner decision, 8 October 2026: personal assistants, phase 4).
 * "Answering from facts first": before anyone is disturbed, the subject's assistant gathers what their work shows about
 * the task (or about what they are working on) and answers from it when it is recent enough.
 *
 * Never broader, by construction (review, 8 October 2026: decision 3). For a person's follow-up every statement runs in
 * ONE transaction as the person who asked (`withUser`), so tasks, comments, status history, submissions, sessions and
 * intervals are filtered by exactly the row-level security that filters their own pages: a colleague never sees time or
 * timers (`app_can_view_records` is false for them), and the facts say "time not shared with you". The workspace's own
 * collection (no requester) gathers the same statements with the worker, limited to tasks ASSIGNED to the subject:
 * its rows are readable by the subject, owners, HR and the subject's team leads, and a lead sees on their own pages only
 * the tasks assigned to the people they lead, not one the subject merely checks or commented on in a project the lead
 * is not in (security review, 8 October 2026: the collection quoted such a comment in a lead's report).
 *
 * Never in the facts (decision 2): a task its holder made for themself (`created_by = assignee_membership_id`, their own
 * to-dos: no title, comment, history or time on it; a timer on one is "a to-do of their own"), the day plan, documents,
 * messages, chats with their assistant, attendance, or calls: never a call's transcript lines or its recap (fix review,
 * 10 October 2026: phase 8 took screen recordings out and brought call notes in; tests/unit/follow-ups-lib.test.ts checks
 * this file reads no call table). Only the statements below are read.
 *
 * Freshness (decision 4): a signal by the subject, visible to the asker, within the last working day (the last N
 * working hours, N the length of the organisation's working day); a completed task is always fresh. For the workspace
 * collection, fresh means a signal since local midnight today. Other people's words (comments, reasons, notes) are kept
 * as written, clipped to 280 characters; they reach the model only inside brain's neutralised blocks.
 */
import { withUser, withWorker, type Db } from "@/server/db";
import { scheduleFor } from "@/server/services/attendance";
import { addDays, localMidnight, todayLocal, weekdayOf } from "@/server/lib/time";
import { fromSchedule, workingDaySeconds, workingTimeBefore, type WorkingSchedule } from "@/server/lib/working-time";
import { clip, type FollowUpFacts, type FollowUpUpdateKind, type TaskStatusWord } from "@/lib/follow-ups";

export type FactsScope = { kind: "person"; profileId: string; membershipId: string } | { kind: "workspace" };

const TEXT_MAX = 280;
const text = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? clip(t, TEXT_MAX) : null;
};
const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

/** The organisation's clock: its schedule (time zone, working days and hours), today, local midnight and this Monday. */
export type OrgClock = { timezone: string; schedule: WorkingSchedule; today: string; midnight: Date; monday: Date };

export async function orgClock(db: Db, organisationId: string, now: Date): Promise<OrgClock> {
  const org = await db.maybeOne<{ timezone: string }>(`SELECT timezone FROM organisations WHERE id = $1`, [organisationId]);
  const raw = await scheduleFor(db, organisationId, org?.timezone ?? "UTC");
  const schedule = fromSchedule(raw);
  const tz = schedule.timezone;
  const today = todayLocal(tz, now);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  return { timezone: tz, schedule, today, midnight: localMidnight(today, tz), monday: localMidnight(monday, tz) };
}

/** Where freshness starts: the last working day for a person who asks, local midnight for the workspace's collection. */
export function freshSinceFor(scope: FactsScope["kind"], clock: OrgClock, now: Date): Date {
  return scope === "workspace" ? clock.midnight : workingTimeBefore(now, clock.schedule, workingDaySeconds(clock.schedule));
}

type TaskRow = { id: string; title: string; project: string; status: TaskStatusWord; progress: number; due_at: string | null; overdue: boolean; blocked_reason: string | null; completed_at: string | null };
type SignalRow = { kind: FollowUpUpdateKind; at: string; text: string | null; task_title: string | null };
type TimerRow = { state: "running" | "paused" | "interrupted"; started_at: string; task_id: string; title: string; own_todo: boolean; theirs: boolean };

/**
 * The facts about one person (and one task, when `taskId` is given), as the asker may see them. `{ gone }` when the task
 * is not one to share: archived, missing, not visible to the asker, someone's own to-do, or not held or checked by the
 * subject.
 */
export async function gatherFacts(scope: FactsScope, p: { organisationId: string; subjectMembershipId: string; taskId: string | null; now?: Date; freshSince?: Date }): Promise<FollowUpFacts | { gone: "task_gone" }> {
  const now = p.now ?? new Date();
  const run = <T>(fn: (db: Db) => Promise<T>) => (scope.kind === "person" ? withUser(scope.profileId, fn) : withWorker(fn));
  return run(async (db) => {
    const clock = await orgClock(db, p.organisationId, now);
    const freshSince = p.freshSince ?? freshSinceFor(scope.kind, clock, now);
    const org = p.organisationId, subject = p.subjectMembershipId, taskId = p.taskId;
    const nowIso = now.toISOString(), midnight = clock.midnight.toISOString(), monday = clock.monday.toISOString();
    const timeVisible = scope.kind === "workspace"
      ? true
      : (await db.one<{ ok: boolean }>(`SELECT COALESCE(app_can_view_records($1, $2), false) AS ok`, [org, subject])).ok;

    // ---- The task (task kind) ----
    let task: TaskRow | null = null;
    if (taskId) {
      task = await db.maybeOne<TaskRow>(
        `SELECT t.id, t.title, p.name AS project, t.status, CASE WHEN t.status = 'completed' THEN 100 ELSE t.progress_percent END::int AS progress,
                t.due_at, (t.due_at IS NOT NULL AND t.due_at < $4::timestamptz AND t.status <> 'completed') AS overdue, t.blocked_reason, t.completed_at
         FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.id = $3 AND t.organisation_id = $1 AND t.archived_at IS NULL AND t.created_by <> t.assignee_membership_id
           AND ($2::uuid = t.assignee_membership_id OR $2::uuid = t.reviewer_membership_id)`, [org, subject, taskId, nowIso]);
      if (!task) return { gone: "task_gone" as const };
    }

    // ---- Time and the timer (only for those who may see the person's records; row-level security hides them anyway) ----
    let time: FollowUpFacts["time"] = null;
    let timer: FollowUpFacts["timer"] = null;
    if (timeVisible) {
      const t = await db.one<{ today: number; week: number }>(
        `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, $5::timestamptz), $5::timestamptz) - GREATEST(i.started_at, $3::timestamptz))))
                  FILTER (WHERE COALESCE(i.ended_at, $5::timestamptz) > $3::timestamptz), 0)::int AS today,
                COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(i.ended_at, $5::timestamptz), $5::timestamptz) - GREATEST(i.started_at, $4::timestamptz)))), 0)::int AS week
         FROM session_intervals i
         WHERE i.organisation_id = $6 AND i.membership_id = $1 AND ($2::uuid IS NULL OR i.task_id = $2::uuid) AND i.confirmation_status = 'confirmed'
           AND COALESCE(i.ended_at, $5::timestamptz) > $4::timestamptz AND i.started_at < $5::timestamptz`,
        [subject, taskId, midnight, monday, nowIso, org]);
      time = { todaySeconds: Math.max(0, Number(t.today) || 0), weekSeconds: Math.max(0, Number(t.week) || 0) };
      const s = await db.maybeOne<TimerRow>(
        `SELECT s.state, s.started_at, s.task_id, t.title, (t.created_by = t.assignee_membership_id) AS own_todo, (t.assignee_membership_id = s.membership_id) AS theirs
         FROM work_sessions s JOIN tasks t ON t.id = s.task_id
         WHERE s.organisation_id = $1 AND s.membership_id = $2 AND s.state IN ('running', 'paused', 'interrupted')
         ORDER BY s.started_at DESC LIMIT 1`, [org, subject]);
      // Task kind: only a timer on this task. An own to-do's timer is said to exist, never what it is.
      if (s && (!taskId || s.task_id === taskId)) {
        // The workspace's collection names the task only when it is assigned to them (every reader can see those).
        const named = scope.kind === "person" || s.theirs;
        timer = s.own_todo
          ? { state: s.state, since: iso(s.started_at)!, taskId: null, taskTitle: null, ownTodo: true }
          : { state: s.state, since: iso(s.started_at)!, taskId: named ? s.task_id : null, taskTitle: named ? s.title : null, ownTodo: false };
      }
    }

    // ---- The newest signal by the subject that the asker can see (30 days) ----
    const params: unknown[] = [org, subject, nowIso];
    let onTask = "";
    if (taskId) { params.push(taskId); onTask = "AND t.id = $4"; }
    // The workspace's collection runs as the worker (no row-level security): only tasks assigned to the subject.
    if (scope.kind === "workspace") onTask += " AND t.assignee_membership_id = $2";
    const signal = await db.maybeOne<SignalRow>(
      `SELECT kind, at, text, task_title FROM (
         SELECT 'status' AS kind, h.occurred_at AS at, h.to_status AS text, t.title AS task_title
           FROM task_status_history h JOIN tasks t ON t.id = h.task_id
           WHERE h.actor_membership_id = $2 AND t.organisation_id = $1 AND t.created_by <> t.assignee_membership_id ${onTask}
             AND h.occurred_at > $3::timestamptz - interval '30 days'
         UNION ALL
         SELECT 'comment', c.created_at, c.body, t.title FROM task_comments c JOIN tasks t ON t.id = c.task_id
           WHERE c.author_membership_id = $2 AND t.organisation_id = $1 AND t.created_by <> t.assignee_membership_id ${onTask}
             AND c.created_at > $3::timestamptz - interval '30 days'
         UNION ALL
         SELECT 'submission', s.submitted_at, NULLIF(btrim(s.note), ''), t.title FROM task_submissions s JOIN tasks t ON t.id = s.task_id
           WHERE s.submitted_by = $2 AND t.organisation_id = $1 AND t.created_by <> t.assignee_membership_id ${onTask}
             AND s.submitted_at > $3::timestamptz - interval '30 days'
         ${timeVisible ? `UNION ALL
         SELECT 'time', MAX(COALESCE(i.ended_at, $3::timestamptz)), NULL, NULL FROM session_intervals i JOIN tasks t ON t.id = i.task_id
           WHERE i.membership_id = $2 AND t.organisation_id = $1 AND i.confirmation_status = 'confirmed' AND t.created_by <> t.assignee_membership_id ${onTask}
             AND COALESCE(i.ended_at, $3::timestamptz) > $3::timestamptz - interval '30 days'` : ""}
       ) s WHERE at IS NOT NULL AND at <= $3::timestamptz ORDER BY at DESC LIMIT 1`, params);
    let lastUpdate: FollowUpFacts["lastUpdate"] = signal
      ? { kind: signal.kind, at: iso(signal.at)!, text: signal.kind === "status" ? signal.text : text(signal.text), taskTitle: signal.task_title }
      : null;
    // A running timer on shared work is the newest signal there is (it is running now).
    if (timer && timer.state === "running" && !timer.ownTodo) lastUpdate = { kind: "timer", at: nowIso, text: null, taskTitle: timer.taskTitle };

    const base = { v: 1 as const, gatheredAt: nowIso, freshSince: freshSince.toISOString(), timeVisible, time, timer, lastUpdate };
    const recent = !!lastUpdate && new Date(lastUpdate.at).getTime() >= freshSince.getTime();

    if (task) {
      const [history, comments, submission] = [
        await db.query<{ from_status: string | null; to_status: string; reason: string | null; occurred_at: string; by_name: string | null; by_them: boolean | null }>(
          `SELECT h.from_status, h.to_status, h.reason, h.occurred_at, pr.display_name AS by_name, (h.actor_membership_id = $2::uuid) AS by_them
           FROM task_status_history h LEFT JOIN memberships m ON m.id = h.actor_membership_id LEFT JOIN profiles pr ON pr.id = m.user_id
           WHERE h.task_id = $1 ORDER BY h.occurred_at DESC LIMIT 5`, [task.id, subject]),
        await db.query<{ body: string; created_at: string; by_name: string; by_them: boolean }>(
          `SELECT c.body, c.created_at, pr.display_name AS by_name, (c.author_membership_id = $2::uuid) AS by_them
           FROM task_comments c JOIN memberships m ON m.id = c.author_membership_id JOIN profiles pr ON pr.id = m.user_id
           WHERE c.task_id = $1 ORDER BY c.created_at DESC LIMIT 3`, [task.id, subject]),
        await db.maybeOne<{ submitted_at: string; note: string | null }>(
          `SELECT s.submitted_at, NULLIF(btrim(s.note), '') AS note FROM task_submissions s WHERE s.task_id = $1 AND s.submitted_by = $2 ORDER BY s.revision DESC LIMIT 1`, [task.id, subject]),
      ];
      return {
        ...base, kind: "task" as const,
        fresh: task.status === "completed" || recent,
        task: {
          id: task.id, title: task.title, project: task.project, status: task.status,
          progressPercent: Math.max(0, Math.min(100, Number(task.progress) || 0)),
          dueAt: iso(task.due_at), overdue: !!task.overdue,
          blockedReason: task.status === "blocked" ? text(task.blocked_reason) : null,
          completedAt: iso(task.completed_at),
        },
        history: history.map((h) => ({ from: h.from_status, to: h.to_status, at: iso(h.occurred_at)!, by: h.by_name, byThem: !!h.by_them, reason: text(h.reason) })),
        comments: comments.map((c) => ({ by: c.by_name, byThem: !!c.by_them, at: iso(c.created_at)!, body: text(c.body) ?? "" })),
        submission: submission ? { at: iso(submission.submitted_at)!, note: text(submission.note) } : null,
      };
    }

    // ---- "What are they working on" ----
    const open = await db.query<{ id: string; title: string; status: Exclude<TaskStatusWord, "completed">; progress: number; due_at: string | null; overdue: boolean; blocked_reason: string | null; total: number }>(
      `SELECT t.id, t.title, t.status, t.progress_percent::int AS progress, t.due_at, (t.due_at IS NOT NULL AND t.due_at < $3::timestamptz) AS overdue, t.blocked_reason,
              count(*) OVER ()::int AS total
       FROM tasks t
       WHERE t.organisation_id = $1 AND t.assignee_membership_id = $2 AND t.archived_at IS NULL AND t.created_by <> t.assignee_membership_id
         AND t.status IN ('todo', 'in_progress', 'blocked', 'in_review')
       ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END, t.due_at NULLS LAST, t.updated_at DESC
       LIMIT 8`, [org, subject, nowIso]);
    const done = await db.query<{ id: string; title: string }>(
      `SELECT t.id, t.title FROM tasks t
       WHERE t.organisation_id = $1 AND t.assignee_membership_id = $2 AND t.status = 'completed' AND t.completed_at >= $3::timestamptz
         AND t.archived_at IS NULL AND t.created_by <> t.assignee_membership_id
       ORDER BY t.completed_at DESC LIMIT 5`, [org, subject, midnight]);
    const total = open[0]?.total ?? 0;
    return {
      ...base, kind: "person" as const,
      fresh: recent,
      openTasks: open.map((t) => ({
        id: t.id, title: t.title, status: t.status, progressPercent: Math.max(0, Math.min(100, Number(t.progress) || 0)),
        dueAt: iso(t.due_at), overdue: !!t.overdue, blockedReason: t.status === "blocked" ? text(t.blocked_reason) : null,
      })),
      openMore: Math.max(0, total - open.length),
      completedToday: done.map((t) => ({ id: t.id, title: t.title })),
    };
  });
}
