/**
 * Blocked on whom (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). When a task
 * is marked blocked, the person it is assigned to may name who it waits on and the question ("Ben is blocked on you:
 * can you send the copy?"). That person's own assistant brings it to them in the Between-assistants inbox, where they
 * Answer (posted on the task as THEIR comment, and "This unblocks it" moves the task back to In progress as their action:
 * the blocked person consented by naming them) or say "Not me" (the blocked person is told). Leads see who is waiting on
 * whom (the "Waiting on" tab of the Commitments page).
 *
 * Contract decision 8: the answer is written by Boredroom's worker AS THE ANSWERER (a worker transaction that carries the
 * answerer's identity: the comment's own policy wants its author to be the caller, and the worker role lets it reach a
 * task the answerer may not open), so it works even when the answerer cannot open the task; the task title they see is
 * the snapshot the blocked person sent (`task_blocks.task_title`). A block that is no longer true (the task left
 * Blocked, was archived or changed hands) is cleared by app_task_block_settle, from tasks.ts in the same transaction and
 * by the worker's sweep. Read by the blocked person, the person waited on and the blocked person's supervisors. Audit
 * rows hold ids only. Before migration 0048 everything here is absent and says so: the task editor hides "Waiting on"
 * and Mark blocked works as before (server/lib/schema-0048).
 */
import { z } from "zod";
import { withCtx, withUser, withWorker, isRlsViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0048, isMissingSchema, retryWithout0048, schema0048Ready } from "@/server/lib/schema-0048";
import { audit, notify } from "@/server/services/common";
import { toProfile } from "@/lib/assistant-look";
import { clip, firstName, type PersonRef } from "@/lib/follow-ups";
import {
  LOOP_LIMITS as L, LOOP_WORDS as W, LOOPS_NOT_READY_SHORT, blockHref, loopTitle, taskBlockBadge,
  type LoopInboxItem, type TaskBlockStatus, type TaskBlockView, type WaitingOnList,
} from "@/lib/commitments";

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
const notHere = () => notFound(W.errors.notFound);
const warn = (what: string) => (err: unknown) => console.warn(`[task blocks] ${what}: ${(err as Error)?.message ?? String(err)}`);
const isOrgAccount = (role: string) => role === "owner" || role === "hr";
/** Words that may run over lines (a question, an answer): line breaks kept, other control characters spaces, trimmed. */
const multiLine = (s: unknown) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function notWhileImpersonated(ctx: OrgContext, words: (first: string) => string = W.errors.impersonated) {
  if (ctx.user.impersonation) throw forbidden(words(firstName(ctx.user.displayName)));
}

/** Runs `fn` as the person, 503 before 0048. */
async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
}

// ---- Views --------------------------------------------------------------------------------------------------------------

type Row = {
  id: string; status: TaskBlockStatus; task_id: string; task_title: string; blocked_membership_id: string; waiting_on_membership_id: string;
  question: string; answer: string | null; unblocked: boolean; created_at: string; seen_at: string | null; answered_at: string | null; closed_at: string | null;
  task_visible: boolean;
  b_name: string; b_a_name: string | null; b_a_colour: string | null; b_a_visor: string | null; b_a_eyes: string | null;
  w_name: string; w_a_name: string | null; w_a_colour: string | null; w_a_visor: string | null; w_a_eyes: string | null;
};

/** As the viewer ($1 organisation, $2 the viewer): the blocks they may read (row-level security). */
const VIEW_SQL = `
  SELECT b.id, b.status, b.task_id, b.task_title, b.blocked_membership_id, b.waiting_on_membership_id, b.question, b.answer, b.unblocked,
         b.created_at, b.seen_at, b.answered_at, b.closed_at, (t.id IS NOT NULL) AS task_visible,
         bp.display_name AS b_name, ba.name AS b_a_name, ba.colour AS b_a_colour, ba.visor AS b_a_visor, ba.eyes AS b_a_eyes,
         wp.display_name AS w_name, wa.name AS w_a_name, wa.colour AS w_a_colour, wa.visor AS w_a_visor, wa.eyes AS w_a_eyes
  FROM task_blocks b
  JOIN memberships bm ON bm.id = b.blocked_membership_id JOIN profiles bp ON bp.id = bm.user_id
  LEFT JOIN assistant_profiles ba ON ba.membership_id = b.blocked_membership_id
  JOIN memberships wm ON wm.id = b.waiting_on_membership_id JOIN profiles wp ON wp.id = wm.user_id
  LEFT JOIN assistant_profiles wa ON wa.membership_id = b.waiting_on_membership_id
  LEFT JOIN tasks t ON t.id = b.task_id`;

const person = (id: string, name: string, a: { name: unknown; colour: unknown; visor: unknown; eyes: unknown }): PersonRef => ({
  membershipId: id, name, firstName: firstName(name), assistant: toProfile(a),
});

function toView(r: Row, ctx: OrgContext): TaskBlockView {
  const me = ctx.membership.id;
  const viewer: TaskBlockView["viewer"] = r.waiting_on_membership_id === me ? "waiting_on" : r.blocked_membership_id === me ? "blocked" : "supervisor";
  const blocked = person(r.blocked_membership_id, r.b_name, { name: r.b_a_name, colour: r.b_a_colour, visor: r.b_a_visor, eyes: r.b_a_eyes });
  const waitingOn = person(r.waiting_on_membership_id, r.w_name, { name: r.w_a_name, colour: r.w_a_colour, visor: r.w_a_visor, eyes: r.w_a_eyes });
  const open = r.status === "open";
  return {
    id: r.id, status: r.status, viewer,
    taskId: r.task_id, taskTitle: r.task_title, taskHref: r.task_visible ? `/app/${ctx.org.slug}/tasks/${r.task_id}` : null,
    blocked, waitingOn,
    question: r.question, answer: r.answer, unblocked: r.unblocked,
    createdAt: r.created_at, seenAt: r.seen_at, answeredAt: r.answered_at, closedAt: r.closed_at,
    canAnswer: viewer === "waiting_on" && open, canNotMe: viewer === "waiting_on" && open, canCancel: viewer === "blocked" && open,
    badge: taskBlockBadge(r.status, viewer, waitingOn.firstName),
    href: blockHref(ctx.org.slug, r.id),
  };
}

async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[], tail: string): Promise<TaskBlockView[]> {
  // $2 (the viewer) is typed here: not every `where` names it.
  const rows = await db.query<Row>(`${VIEW_SQL} WHERE b.organisation_id = $1 AND $2::uuid IS NOT NULL AND (${where}) ${tail}`, [ctx.org.id, ctx.membership.id, ...params]);
  return rows.map((r) => toView(r, ctx));
}

async function viewOrThrow(ctx: OrgContext, id: string): Promise<TaskBlockView> {
  const v = await asPerson(ctx, async (db) => (await loadViews(db, ctx, "b.id = $3", [id], ""))[0] ?? null);
  if (!v) throw notHere();
  return v;
}

// ---- The task page and editor ---------------------------------------------------------------------------------------------

/**
 * What the task editor and the task page show: the open block, the newest one closed with an answer or "not me" (the
 * line under the Blocked alert), and who it may wait on (every active member but the person). 404 when the person cannot
 * see the task. Before 0048: `ready: false` (the editor hides "Waiting on").
 */
export async function blockFor(ctx: OrgContext, taskId: string): Promise<{ ready: boolean; block: TaskBlockView | null; last: TaskBlockView | null; people: { membershipId: string; name: string }[] }> {
  const none = { ready: false, block: null, last: null, people: [] };
  if (!isUuid(taskId)) throw notFound("Task not found.");
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      const task = await db.maybeOne(`SELECT 1 FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]);
      if (!task) throw notFound("Task not found.");
      if (!(await schema0048Ready(db))) return none;
      const block = (await loadViews(db, ctx, "b.task_id = $3 AND b.status = 'open'", [taskId], "LIMIT 1"))[0] ?? null;
      const last = (await loadViews(db, ctx, "b.task_id = $3 AND b.status IN ('answered', 'not_me')", [taskId], "ORDER BY b.closed_at DESC NULLS LAST, b.created_at DESC LIMIT 1"))[0] ?? null;
      const people = await db.query<{ membershipId: string; name: string }>(
        `SELECT m.id AS "membershipId", p.display_name AS name FROM memberships m JOIN profiles p ON p.id = m.user_id
         WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2 ORDER BY p.display_name`, [ctx.org.id, ctx.membership.id]);
      return { ready: true, block, last, people };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return none; }
    throw err;
  }
}

export const setBlockSchema = z.object({ waitingOn: z.string().uuid(), question: z.string().trim().min(1).max(500) });

/**
 * "Waiting on {person}: {question}", by the person the task is assigned to, on a task that is Blocked (409 otherwise;
 * 403 for anyone else). An open block is withdrawn first (one open block per task), then the new one is inserted as the
 * person (its policy checks the same) and the person waited on is told by their own assistant ("Ben is blocked on you").
 * 422 for themself or someone who is not an active member; 503 before 0048. Audited with ids only.
 */
export async function setBlock(ctx: OrgContext, taskId: string, input: z.infer<typeof setBlockSchema>): Promise<TaskBlockView> {
  if (!isUuid(taskId)) throw notFound("Task not found.");
  // "Ada is blocked on you" is sent in the person's name: never while someone else is signed in as them (security
  // review, 9 October 2026).
  notWhileImpersonated(ctx, W.errors.impersonatedBlock);
  const waitingOn = String(input?.waitingOn ?? "");
  const question = multiLine(input?.question);
  if (!question) throw invalid(W.errors.emptyQuestion, { question: [W.errors.emptyQuestion] });
  if (question.length > L.questionMax) throw invalid(W.errors.tooLong(L.questionMax), { question: [W.errors.tooLong(L.questionMax)] });
  if (!isUuid(waitingOn)) throw invalid(W.errors.notMember("That person"), { waitingOn: [W.errors.notMember("That person")] });
  if (waitingOn.toLowerCase() === ctx.membership.id.toLowerCase()) throw invalid(W.errors.self, { waitingOn: [W.errors.self] });
  const id = await asPerson(ctx, async (db) => {
    const t = await db.maybeOne<{ id: string; title: string; status: string; assignee_membership_id: string; archived: boolean }>(
      `SELECT id, title, status, assignee_membership_id, (archived_at IS NOT NULL) AS archived FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]);
    if (!t) throw notFound("Task not found.");
    if (t.assignee_membership_id !== ctx.membership.id) throw forbidden(W.errors.notHolder);
    if (t.status !== "blocked" || t.archived) throw conflict("NOT_BLOCKED", W.errors.notBlocked);
    const who = await db.maybeOne<{ name: string; status: string }>(
      `SELECT p.display_name AS name, m.status FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.id = $1 AND m.organisation_id = $2`, [waitingOn, ctx.org.id]);
    if (!who || who.status !== "active") throw invalid(W.errors.notMember(who?.name ?? "That person"), { waitingOn: [W.errors.notMember(who?.name ?? "That person")] });
    // A message from the person's assistant to someone else's (security review, 9 October 2026): it respects that
    // person's mute of this assistant, as every other one does, and is bounded per pair and per person a day.
    // The mute is the recipient's own row: asked through phase 6's definer (app_assistant_item_refusal), as a message.
    const refusal = await db.one<{ reason: string | null }>(`SELECT app_assistant_item_refusal($1, $2, 'message') AS reason`, [ctx.org.id, waitingOn]);
    if (refusal.reason === "muted") throw new AppError(403, "MUTED", W.errors.blockMuted(firstName(who.name)));
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`task_block.sender:${ctx.membership.id}`]);
    const sent = await db.one<{ pair: number; total: number }>(
      `SELECT count(*) FILTER (WHERE waiting_on_membership_id = $2)::int AS pair, count(*)::int AS total
       FROM task_blocks WHERE blocked_membership_id = $1 AND created_at > now() - interval '1 day'`, [ctx.membership.id, waitingOn]);
    if (sent.pair >= L.blocksPerPairPerDay) throw conflict("BLOCK_LIMIT", W.errors.blockLimitPair(firstName(who.name)));
    if (sent.total >= L.blocksPerPersonPerDay) throw conflict("BLOCK_LIMIT", W.errors.blockLimitDay);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`task_block:${taskId}`]);
    // A block left from before the task changed hands is no longer true: cleared first (one open block per task).
    await db.query(`SELECT app_task_block_settle($1)`, [taskId]);
    const open = await db.maybeOne<{ id: string }>(`SELECT id FROM task_blocks WHERE task_id = $1 AND status = 'open' AND blocked_membership_id = $2`, [taskId, ctx.membership.id]);
    if (open) await db.query(`SELECT app_task_block_cancel($1)`, [open.id]);
    let row: { id: string };
    try {
      await db.query(`SAVEPOINT task_block_insert`);
      row = await db.one<{ id: string }>(
        `INSERT INTO task_blocks(organisation_id, task_id, blocked_membership_id, waiting_on_membership_id, task_title, question) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [ctx.org.id, taskId, ctx.membership.id, waitingOn, clip(t.title, 200), question]);
      await db.query(`RELEASE SAVEPOINT task_block_insert`);
    } catch (err) {
      await db.query(`ROLLBACK TO SAVEPOINT task_block_insert`).catch(() => undefined);
      if (isRlsViolation(err)) throw conflict("NOT_BLOCKED", W.errors.notBlocked);
      throw err;
    }
    await notify(db, {
      organisationId: ctx.org.id, recipientMembershipId: waitingOn, type: "brenda.blocked_on",
      title: clip(W.notifications.blockedOn(firstName(ctx.user.displayName)), 200), body: clip(W.notifications.blockedOnBody(clip(question.replace(/\s+/g, " "), 280)), 300),
      resourceType: "task_block", resourceId: row.id, href: blockHref(ctx.org.slug, row.id), dedupKey: `block:${row.id}`,
    });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task_block.set", subjectType: "task", subjectId: taskId, subjectMembershipId: waitingOn, metadata: { blockId: row.id, taskId, replaced: open?.id ?? null } });
    return row.id;
  });
  return viewOrThrow(ctx, id);
}

/** "Stop waiting": the person who named someone withdraws their open block on the task (nothing open: `cancelled: false`). */
export async function cancelBlock(ctx: OrgContext, taskId: string): Promise<{ cancelled: boolean }> {
  if (!isUuid(taskId)) throw notFound("Task not found.");
  notWhileImpersonated(ctx, W.errors.impersonatedBlock);
  return asPerson(ctx, async (db) => {
    const open = await db.maybeOne<{ id: string; waiting_on_membership_id: string }>(
      `SELECT id, waiting_on_membership_id FROM task_blocks WHERE task_id = $1 AND organisation_id = $2 AND status = 'open' AND blocked_membership_id = $3`, [taskId, ctx.org.id, ctx.membership.id]);
    if (!open) return { cancelled: false };
    const r = await db.one<{ r: string }>(`SELECT app_task_block_cancel($1) AS r`, [open.id]);
    if (r.r !== "ok") return { cancelled: false };
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task_block.cancelled", subjectType: "task", subjectId: taskId, subjectMembershipId: open.waiting_on_membership_id, metadata: { blockId: open.id, taskId } });
    return { cancelled: true };
  });
}

// ---- The person waited on ---------------------------------------------------------------------------------------------------

export const answerBlockSchema = z.object({ answer: z.string().trim().min(1).max(1000), unblock: z.boolean().default(false) });

/** The definer's word for answer and "not me", as the error the routes answer. */
function stepError(word: string): AppError | null {
  switch (word) {
    case "ok": return null;
    case "not_found": return notHere();
    case "closed": return conflict("ITEM_CLOSED", W.errors.closed);
    case "empty": return invalid(W.errors.emptyAnswer, { answer: [W.errors.emptyAnswer] });
    case "too_long": return invalid(W.errors.tooLong(L.answerMax), { answer: [W.errors.tooLong(L.answerMax)] });
    default: return notHere();
  }
}

/**
 * Answer (the person waited on alone, never while someone else is signed in as them): the definer records it; then, in
 * one worker transaction AS THE ANSWERER, the answer is posted on the task as their comment ("Answer to “{question}”:
 * {answer}") and, when they said it unblocks it, the task moves Blocked → In progress as their action (only while it is
 * still blocked and still held by the person who asked); the blocked person is told. 404, 409 ITEM_CLOSED, 422, 403, 503.
 */
export async function answerBlock(ctx: OrgContext, id: string, input: z.infer<typeof answerBlockSchema>): Promise<TaskBlockView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  const answer = multiLine(input?.answer);
  if (!answer) throw invalid(W.errors.emptyAnswer, { answer: [W.errors.emptyAnswer] });
  if (answer.length > L.answerMax) throw invalid(W.errors.tooLong(L.answerMax), { answer: [W.errors.tooLong(L.answerMax)] });
  const unblock = input?.unblock === true;
  await asPerson(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_task_block_answer($1, $2, $3) AS r`, [id, answer, unblock]);
    const e = stepError(r.r);
    if (e) throw e;
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `block:${id}`]);
  });
  await postAnswer({ organisationId: ctx.org.id, slug: ctx.org.slug, blockId: id, answerer: { membershipId: ctx.membership.id, profileId: ctx.user.profileId, name: ctx.user.displayName } })
    .catch(warn(`posting the answer to ${id}`));
  return viewOrThrow(ctx, id);
}

/**
 * Posts an answered block on its task (once: the block is held while it runs, and nothing is done when it already has
 * its comment), as the answerer, in a worker transaction carrying their identity: the comment is theirs even on a task
 * they cannot open. The comment holds only the answerer's own words (security review, 9 October 2026): the question is
 * the blocked person's free text, so it is never quoted inside a comment written as someone else; the task's block
 * card shows the question, attributed to whoever asked it. When they said it unblocks it, the task moves Blocked → In
 * progress as their action (only while it is still blocked and held by the person who asked); the blocked person is
 * told. Throws on failure: the worker's sweep finishes it later (settleBlocks).
 */
async function postAnswer(o: { organisationId: string; slug: string; blockId: string; answerer: { membershipId: string; profileId: string; name: string } }): Promise<void> {
  const { organisationId, slug, blockId: id, answerer } = o;
  await withCtx({ userId: answerer.profileId, role: "worker" }, async (db) => {
    const b = await db.maybeOne<{ task_id: string; blocked_membership_id: string; blocked_name: string; answer: string; unblocked: boolean; task_title: string; comment_id: string | null }>(
      `SELECT b.task_id, b.blocked_membership_id, p.display_name AS blocked_name, b.answer, b.unblocked, b.task_title, b.comment_id
       FROM task_blocks b JOIN memberships m ON m.id = b.blocked_membership_id JOIN profiles p ON p.id = m.user_id
       WHERE b.id = $1 AND b.status = 'answered' AND b.waiting_on_membership_id = $2 FOR UPDATE OF b`,
      [id, answerer.membershipId]);
    if (!b || b.comment_id) return;
    const body = clip(`Answer to ${firstName(b.blocked_name)}'s question: ${b.answer}`, 4000);
    const c = await db.one<{ id: string }>(`INSERT INTO task_comments(organisation_id, task_id, author_membership_id, body) VALUES ($1, $2, $3, $4) RETURNING id`,
      [organisationId, b.task_id, answerer.membershipId, body]);
    await db.query(`UPDATE task_blocks SET comment_id = $2 WHERE id = $1`, [id, c.id]);
    let moved = false;
    if (b.unblocked) {
      const t = await db.maybeOne(
        `UPDATE tasks SET status = 'in_progress', blocked_reason = NULL, version = version + 1
         WHERE id = $1 AND organisation_id = $2 AND status = 'blocked' AND archived_at IS NULL AND assignee_membership_id = $3 RETURNING id`,
        [b.task_id, organisationId, b.blocked_membership_id]);
      if (t) {
        moved = true;
        await db.query(`INSERT INTO task_status_history(organisation_id, task_id, actor_membership_id, from_status, to_status, reason) VALUES ($1, $2, $3, 'blocked', 'in_progress', $4)`,
          [organisationId, b.task_id, answerer.membershipId, `Unblocked by ${firstName(answerer.name)}'s answer`]);
      }
    }
    await notify(db, {
      organisationId, recipientMembershipId: b.blocked_membership_id, type: "brenda.block_answered",
      title: clip(W.notifications.blockAnswered(firstName(answerer.name), clip(b.answer.replace(/\s+/g, " "), 120)), 200),
      body: clip(W.notifications.blockAnsweredBody(moved, loopTitle(b.task_title)), 300),
      resourceType: "task", resourceId: b.task_id, href: `/app/${slug}/tasks/${b.task_id}`, dedupKey: `block.answered:${id}`,
    });
    await audit(db, { organisationId, actorMembershipId: answerer.membershipId, action: "task_block.answered", subjectType: "task", subjectId: b.task_id, subjectMembershipId: b.blocked_membership_id, metadata: { blockId: id, taskId: b.task_id, unblocked: moved } });
  });
}

/** "Not me" (the person waited on alone): closed; the blocked person is told to name someone else. */
export async function notMeBlock(ctx: OrgContext, id: string): Promise<TaskBlockView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  await asPerson(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_task_block_not_me($1) AS r`, [id]);
    const e = stepError(r.r);
    if (e) throw e;
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `block:${id}`]);
    const b = await db.one<{ task_id: string; blocked_membership_id: string }>(`SELECT task_id, blocked_membership_id FROM task_blocks WHERE id = $1`, [id]);
    await notify(db, {
      organisationId: ctx.org.id, recipientMembershipId: b.blocked_membership_id, type: "brenda.block_not_me",
      title: clip(W.notifications.blockNotMe(firstName(ctx.user.displayName)), 200), body: W.notifications.blockNotMeBody,
      resourceType: "task", resourceId: b.task_id, href: `/app/${ctx.org.slug}/tasks/${b.task_id}`, dedupKey: `block.notme:${id}`,
    });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "task_block.not_me", subjectType: "task", subjectId: b.task_id, subjectMembershipId: b.blocked_membership_id, metadata: { blockId: id, taskId: b.task_id } });
  });
  return viewOrThrow(ctx, id);
}

/** Opening the card marks it seen (the person waited on alone); their notification is read. */
export async function markBlockSeen(ctx: OrgContext, id: string): Promise<void> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx);
  await asPerson(ctx, async (db) => {
    const r = await db.one<{ r: string }>(`SELECT app_task_block_seen($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `block:${id}`]);
  });
}

// ---- Reading ----------------------------------------------------------------------------------------------------------------

/** The open blocks waiting on this person (the inbox's "blocked on you"), oldest first, at most 20. [] before 0048. */
export async function waitingBlocks(ctx: OrgContext): Promise<LoopInboxItem[]> {
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return [];
      const views = await loadViews(db, ctx, "b.waiting_on_membership_id = $2 AND b.status = 'open'", [], `ORDER BY b.created_at, b.id LIMIT ${L.waitingMax}`);
      return views.map((block): LoopInboxItem => ({ kind: "blocked_on", block }));
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return []; }
    throw err;
  }
}

/**
 * Who is waiting on whom (the Commitments page's "Waiting on" tab, and her `waiting_on`): `mine` (open blocks where the
 * person is blocked or waited on), `team` (team leads: those whose blocked person is on a team they lead) or `all` (the
 * owner and HR). Open only, oldest first, with a count per person waited on (most first). 403 for a scope the person may
 * not read. Before 0048: `ready: false`, empty.
 */
export async function waitingOnList(ctx: OrgContext, o: { scope?: "mine" | "team" | "all" } = {}): Promise<WaitingOnList> {
  const scope = o.scope === "team" || o.scope === "all" ? o.scope : "mine";
  const none: WaitingOnList = { ready: false, scope, items: [], byPerson: [] };
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db): Promise<WaitingOnList> => {
      if (!(await schema0048Ready(db))) return none;
      if (scope === "all" && !isOrgAccount(ctx.membership.role)) throw forbidden("Only the owner and HR see everyone's.");
      if (scope === "team") {
        const leads = await db.maybeOne(`SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.archived_at IS NULL WHERE tm.membership_id = $1 AND tm.is_manager LIMIT 1`, [ctx.membership.id]);
        if (!leads) throw forbidden("Only team leads see their teams'.");
      }
      const where = scope === "mine" ? "(b.blocked_membership_id = $2 OR b.waiting_on_membership_id = $2)"
        : scope === "team" ? "(b.blocked_membership_id <> $2 AND app_manages($1, b.blocked_membership_id))"
        : "true";
      const items = await loadViews(db, ctx, `b.status = 'open' AND ${where}`, [], "ORDER BY b.created_at, b.id LIMIT 200");
      const counts = new Map<string, { waitingOn: PersonRef; count: number }>();
      for (const v of items) {
        const c = counts.get(v.waitingOn.membershipId) ?? { waitingOn: v.waitingOn, count: 0 };
        c.count++;
        counts.set(v.waitingOn.membershipId, c);
      }
      const byPerson = [...counts.values()].sort((a, b) => b.count - a.count || a.waitingOn.name.localeCompare(b.waitingOn.name));
      return { ready: true, scope, items, byPerson };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return none; }
    throw err;
  }
}

/** One block, for the blocked person, the person waited on, or someone who may view the blocked person's records; null otherwise. */
export async function getBlock(ctx: OrgContext, id: string): Promise<TaskBlockView | null> {
  if (!isUuid(id)) return null;
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return null;
      return (await loadViews(db, ctx, "b.id = $3", [id], ""))[0] ?? null;
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return null; }
    throw err;
  }
}

// ---- The worker -----------------------------------------------------------------------------------------------------------------

/**
 * Clears open blocks that are no longer true (the task left Blocked, was archived or changed hands) through
 * app_task_block_settle, at most `limit` tasks a run (the worker's `commitments.sweep`; tasks.ts also settles in the same
 * transaction as the change). Never throws; nothing before 0048.
 */
export async function settleBlocks(o: { limit?: number } = {}): Promise<{ cleared: number }> {
  const limit = Math.min(500, Math.max(1, Math.round(o.limit ?? 100)));
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return { cleared: 0 };
      const tasks = await db.query<{ task_id: string }>(
        `SELECT DISTINCT b.task_id FROM task_blocks b JOIN tasks t ON t.id = b.task_id
         WHERE b.status = 'open' AND (t.status <> 'blocked' OR t.archived_at IS NOT NULL OR t.assignee_membership_id <> b.blocked_membership_id) LIMIT $1`, [limit]);
      let cleared = 0;
      for (const t of tasks) cleared += (await db.one<{ n: number }>(`SELECT app_task_block_settle($1) AS n`, [t.task_id])).n;
      return { cleared };
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("settling blocks")(err);
    return { cleared: 0 };
  } finally {
    await finishAnswers(limit).catch(warn("finishing answers"));
  }
}

/**
 * Answers recorded but never posted (the web process stopped, or the posting failed, after the answer was kept): posted
 * now, as their answerer (review, 9 October 2026). Only those answered more than two minutes ago (the answer's own
 * request posts it at once) and within the last day.
 */
async function finishAnswers(limit: number): Promise<number> {
  const rows = await withWorker(async (db) => {
    if (!(await schema0048Ready(db))) return [];
    return db.query<{ id: string; organisation_id: string; slug: string; membership_id: string; user_id: string; name: string }>(
      `SELECT b.id, b.organisation_id, o.slug, b.waiting_on_membership_id AS membership_id, m.user_id, p.display_name AS name
       FROM task_blocks b JOIN organisations o ON o.id = b.organisation_id
       JOIN memberships m ON m.id = b.waiting_on_membership_id JOIN profiles p ON p.id = m.user_id
       WHERE b.status = 'answered' AND b.comment_id IS NULL AND b.answered_at < now() - interval '2 minutes' AND b.answered_at > now() - interval '1 day'
       ORDER BY b.answered_at LIMIT $1`, [limit]);
  });
  let n = 0;
  for (const r of rows) {
    try {
      await postAnswer({ organisationId: r.organisation_id, slug: r.slug, blockId: r.id, answerer: { membershipId: r.membership_id, profileId: r.user_id, name: r.name } });
      n++;
    } catch (err) { warn(`posting the answer to ${r.id}`)(err); }
  }
  return n;
}
