/**
 * The stalled re-plan (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). When
 * the chase routine (phase 7a) finds a task stalled a SECOND time (contract decision 9: the same routine chased an earlier
 * stall of it), the follow-up's answer carries a suggested new due date for the lead. It is a suggestion only, never
 * automatic: nothing on the task changes until the lead confirms it, and then through updateTask AS THE LEAD (their own
 * permission to change the due date; a task changed since answers 409 as any edit would). "Not now" keeps the due date.
 *
 * Only the lead reads their proposals (row-level security, migration 0048); only Boredroom's worker inserts them
 * (`proposeReplan`, called by follow-ups when the chase's answer is stored); the lead's answer is the definer
 * app_replan_decide. A newer proposal for the same task makes the older ones 'stale', and so does any change to the task
 * since (its due date moved, it was finished or archived): a stale suggestion says the task changed and offers nothing.
 * Before migration 0048 no proposal is made and the follow-up works as in 7a (server/lib/schema-0048).
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0048, isMissingSchema, retryWithout0048, schema0048Ready } from "@/server/lib/schema-0048";
import { audit } from "@/server/services/common";
import { updateTask } from "@/server/services/tasks";
import { firstName } from "@/lib/follow-ups";
import { LOOP_WORDS as W, LOOPS_NOT_READY_SHORT, loopDueLabel, type ReplanView } from "@/lib/commitments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
const notHere = () => notFound(W.errors.notFound);
const warn = (what: string) => (err: unknown) => console.warn(`[replans] ${what}: ${(err as Error)?.message ?? String(err)}`);
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Open proposals whose task has changed since (its due date moved, it was finished or archived): stale. As the worker,
 * for the given ids (or all of a lead's). One guarded statement.
 */
async function staleChanged(db: Db, where: string, params: unknown[]): Promise<void> {
  await db.query(
    `UPDATE replan_proposals p SET status = 'stale', decided_at = now() FROM tasks t
     WHERE t.id = p.task_id AND p.status = 'proposed' AND (${where})
       AND (t.status = 'completed' OR t.archived_at IS NOT NULL OR t.due_at IS DISTINCT FROM p.previous_due_at)`, params);
}

/**
 * A new due date suggested to the lead (the worker; follow-ups calls it when the chase's answer for a task stalled a
 * second time is stored). Null when the task is finished or archived, the lead is not an active member, this follow-up
 * already carries one, or before 0048. Older open proposals for the task are marked 'stale'. Never throws.
 */
export async function proposeReplan(p: { organisationId: string; taskId: string; leadMembershipId: string; followUpId: string | null; routineRunId?: string | null; proposedDueAt: Date }): Promise<string | null> {
  if (!isUuid(p.organisationId) || !isUuid(p.taskId) || !isUuid(p.leadMembershipId) || (p.followUpId !== null && !isUuid(p.followUpId))) return null;
  const due = p.proposedDueAt instanceof Date ? p.proposedDueAt : new Date(p.proposedDueAt as unknown as string);
  if (Number.isNaN(due.getTime())) return null;
  const runId = p.routineRunId && isUuid(p.routineRunId) ? p.routineRunId : null;
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return null;
      const task = await db.maybeOne<{ due_at: string | null; status: string; archived: boolean }>(
        `SELECT due_at, status, (archived_at IS NOT NULL) AS archived FROM tasks WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [p.taskId, p.organisationId]);
      if (!task || task.archived || task.status === "completed") return null;
      const lead = await db.maybeOne(`SELECT 1 FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [p.leadMembershipId, p.organisationId]);
      if (!lead) return null;
      if (p.followUpId && (await db.maybeOne(`SELECT 1 FROM replan_proposals WHERE follow_up_id = $1`, [p.followUpId]))) return null;
      if (p.followUpId && !(await db.maybeOne(`SELECT 1 FROM follow_ups WHERE id = $1 AND organisation_id = $2`, [p.followUpId, p.organisationId]))) return null;
      if (runId && !(await db.maybeOne(`SELECT 1 FROM routine_runs WHERE id = $1`, [runId]))) return null;
      await db.query(`UPDATE replan_proposals SET status = 'stale', decided_at = now() WHERE task_id = $1 AND status = 'proposed'`, [p.taskId]);
      const row = await db.one<{ id: string }>(
        `INSERT INTO replan_proposals(organisation_id, task_id, lead_membership_id, follow_up_id, routine_run_id, previous_due_at, proposed_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [p.organisationId, p.taskId, p.leadMembershipId, p.followUpId, runId, task.due_at, due.toISOString()]);
      await audit(db, { organisationId: p.organisationId, action: "replan.proposed", subjectType: "task", subjectId: p.taskId, subjectMembershipId: p.leadMembershipId, metadata: { replanId: row.id, taskId: p.taskId, followUpId: p.followUpId } });
      return row.id;
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("proposing a re-plan")(err);
    return null;
  }
}

// ---- Views --------------------------------------------------------------------------------------------------------------

type Row = {
  id: string; status: ReplanView["status"]; task_id: string; task_title: string | null; previous_due_at: string | null; proposed_due_at: string;
  confirmed_due_at: string | null; follow_up_id: string | null;
};
const VIEW_SQL = `
  SELECT p.id, p.status, p.task_id, t.title AS task_title, p.previous_due_at, p.proposed_due_at, p.confirmed_due_at, p.follow_up_id
  FROM replan_proposals p LEFT JOIN tasks t ON t.id = p.task_id`;

function toView(r: Row, ctx: OrgContext): ReplanView {
  return {
    id: r.id, status: r.status, taskId: r.task_id, taskTitle: r.task_title ?? "A task", taskHref: `/app/${ctx.org.slug}/tasks/${r.task_id}`,
    previousDueAt: r.previous_due_at, proposedDueAt: r.proposed_due_at, proposedLabel: loopDueLabel(r.proposed_due_at, ctx.org.timezone) ?? "",
    confirmedDueAt: r.confirmed_due_at, followUpId: r.follow_up_id, canConfirm: r.status === "proposed",
  };
}

/** As the lead: their proposals matching `where` (from $3), stale ones settled first. */
async function readViews(ctx: OrgContext, where: string, params: unknown[], tail: string): Promise<ReplanView[] | null> {
  try {
    return await retryWithout0048(async () => {
      const ready = await withUser(ctx.user.profileId, (db) => schema0048Ready(db));
      if (!ready) return null;
      await withWorker((db) => staleChanged(db, "p.lead_membership_id = $1", [ctx.membership.id])).catch(warn("settling stale proposals"));
      return withUser(ctx.user.profileId, async (db) => {
        const rows = await db.query<Row>(`${VIEW_SQL} WHERE p.organisation_id = $1 AND p.lead_membership_id = $2 AND (${where}) ${tail}`, [ctx.org.id, ctx.membership.id, ...params]);
        return rows.map((r) => toView(r, ctx));
      });
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return null; }
    throw err;
  }
}

/** The proposal a follow-up carries, for its requester (the lead) only; null otherwise and before 0048. */
export async function replanForFollowUp(ctx: OrgContext, followUpId: string): Promise<ReplanView | null> {
  if (!isUuid(followUpId)) return null;
  return (await readViews(ctx, "p.follow_up_id = $3", [followUpId], "ORDER BY p.created_at DESC LIMIT 1"))?.[0] ?? null;
}

/** The proposals this lead has not answered yet, newest first. [] before 0048. */
export async function listOpenReplans(ctx: OrgContext): Promise<ReplanView[]> {
  return (await readViews(ctx, "p.status = 'proposed'", [], "ORDER BY p.created_at DESC LIMIT 50")) ?? [];
}

async function viewOrThrow(ctx: OrgContext, id: string): Promise<ReplanView> {
  const v = (await readViews(ctx, "p.id = $3", [id], ""))?.[0];
  if (!v) throw notHere();
  return v;
}

function decideError(word: string): AppError | null {
  switch (word) {
    case "ok": return null;
    case "not_found": return notHere();
    case "closed": return conflict("ITEM_CLOSED", W.errors.closed);
    case "no_date": return invalid("Pick the new due date.", { dueAt: ["Pick the new due date."] });
    default: return invalid("That isn't an answer to a re-plan.");
  }
}

/**
 * Confirm the new due date (the lead alone, never while someone else is signed in as them): `dueAt` (the suggestion, or
 * the date they changed it to) is set through updateTask AS THE LEAD, with the task's current version (their own
 * permission; a refusal or a 409 surfaces as it is), then recorded. A proposal gone stale answers 409 with why.
 */
export async function confirmReplan(ctx: OrgContext, id: string, input: { dueAt?: string | null }): Promise<ReplanView> {
  if (!isUuid(id)) throw notHere();
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated(firstName(ctx.user.displayName)));
  if (input?.dueAt != null && !isIso(input.dueAt)) throw invalid("Pick the new due date.", { dueAt: ["Pick a date and time."] });
  const current = (await readViews(ctx, "p.id = $3", [id], ""));
  if (current === null) throw notReady();
  const p = current[0];
  if (!p) throw notHere();
  if (p.status === "stale") throw conflict("ITEM_CLOSED", W.replan.stale);
  if (p.status !== "proposed") throw conflict("ITEM_CLOSED", W.errors.closed);
  const dueAt = new Date(input?.dueAt ?? p.proposedDueAt).toISOString();
  const task = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ version: number }>(`SELECT version FROM tasks WHERE id = $1 AND organisation_id = $2`, [p.taskId, ctx.org.id]));
  if (!task) throw notFound("Task not found.");
  await updateTask(ctx, p.taskId, { expectedVersion: task.version, dueAt });
  await withUser(ctx.user.profileId, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_replan_decide($1, 'confirm', $2::timestamptz) AS r`, [id, dueAt]);
    const e = decideError(r.r);
    if (e) throw e;
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "replan.confirmed", subjectType: "task", subjectId: p.taskId, subjectMembershipId: ctx.membership.id, metadata: { replanId: id, taskId: p.taskId } });
  });
  return viewOrThrow(ctx, id);
}

/** "Not now" (the lead alone): the due date stays as it is. */
export async function dismissReplan(ctx: OrgContext, id: string): Promise<ReplanView> {
  if (!isUuid(id)) throw notHere();
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated(firstName(ctx.user.displayName)));
  try {
    await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) throw notReady();
      const r = await db.one<{ r: string }>(`SELECT app_replan_decide($1, 'dismiss', NULL) AS r`, [id]);
      const e = decideError(r.r);
      if (e) throw e;
      await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "replan.dismissed", subjectType: "replan", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { replanId: id } });
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
  return viewOrThrow(ctx, id);
}
