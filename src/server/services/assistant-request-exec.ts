/**
 * Doing an accepted request (owner decision, 8 October 2026: personal assistants, phase 6). "The recipient always
 * approves anything that changes their account": once Ada presses Accept, her own assistant does exactly what the
 * request's validated structured payload says, AS ADA, through the same services her buttons use, each in its own
 * transaction under her row-level security, with her permissions and her audit rows. Nothing here reads the sender's
 * words as an instruction: the payload alone (lib/assistant-items `payloadOrNull`) decides what runs.
 *
 * | kind         | as the recipient                                                                               |
 * | ------------ | ---------------------------------------------------------------------------------------------- |
 * | add_todo     | quickTodo (their own to-do; createTask audits task.created as them)                            |
 * | set_reminder | createReminder                                                                                 |
 * | task_status  | updateTask (to do, in progress, blocked), submitTask (in review), completeTask (done), only on |
 * |              | a task they still hold and only a move the holder may make from where it is now                |
 * | task_comment | addComment (the comment is theirs, exactly the text they accepted)                             |
 *
 * A refusal by a service becomes the result's code and its own words (contract C.2 step 4): 403 not_allowed, 404
 * task_gone, 409 bad_transition, 422 about the reminder's time in_past, any other 4xx invalid; anything else is `error`
 * with plain words and a server log. Never throws.
 */
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { createReminder } from "@/server/services/brenda";
import { addComment, completeTask, quickTodo, updateTask } from "@/server/services/tasks";
import { submitTask } from "@/server/services/evidence";
import { ASSISTANT_ITEM_WORDS as W, HOLDER_MOVES, STATUS_WORDS, isRequestTaskStatus, type RequestPayload, type ResultCode } from "@/lib/assistant-items";
import { clip, firstName } from "@/lib/follow-ups";

/** `sentForCheck`: a move to Done that completeTask sent for a check instead (the task has a reviewer). */
export type ExecRefs = { taskId?: string; reminderId?: string; commentId?: string; sentForCheck?: boolean };
export type ExecOutcome = { code: ResultCode; words: string; refs: ExecRefs };

const fail = (code: ResultCode, words: string): ExecOutcome => ({ code, words: clip(words, 300), refs: {} });

/** A service's refusal in the result's words (contract C.2 step 4). */
export function outcomeOfError(err: unknown): ExecOutcome {
  if (err instanceof AppError) {
    if (err.status === 403) return fail("not_allowed", err.message);
    if (err.status === 404) return fail("task_gone", err.message);
    if (err.status === 409) return fail("bad_transition", err.message);
    if (err.status === 422 && err.fieldErrors?.remindAt && /passed/i.test(err.message)) return fail("in_past", err.message);
    if (err.status >= 400 && err.status < 500) return fail("invalid", err.message);
  }
  // Row-level security said no: the person may no longer do this (review, 8 October 2026: the same as a 403).
  if ((err as { code?: string } | null)?.code === "42501") return fail("not_allowed", "You are not allowed to do that.");
  console.error(`[assistant items] an accepted request failed: ${(err as Error)?.message ?? String(err)}`);
  return fail("error", W.results.error);
}

/**
 * Does the request as `ctx` (the recipient's own context, from their own request: never anyone else's). `senderFirst`
 * only fills the default note of a task sent for review ("Sent for review at Olu's request.").
 */
export async function executeRequest(ctx: OrgContext, p: RequestPayload, o: { senderFirst: string }): Promise<ExecOutcome> {
  const me = firstName(ctx.user.displayName);
  try {
    switch (p.kind) {
      case "add_todo": {
        // Owners and HR hold no to-dos (quickTodo would say so too; this says it in the request's words).
        if (ctx.membership.role === "owner" || ctx.membership.role === "hr") return fail("no_todos", W.results.noTodos(me));
        const task = await quickTodo(ctx, { title: p.title, dueAt: p.dueAt });
        return { code: "done", words: "to-do added", refs: { taskId: task.id } };
      }
      case "set_reminder": {
        const r = await createReminder(ctx, { body: p.text, remindAt: p.at, taskId: null });
        return { code: "done", words: "reminder set", refs: { reminderId: r.id } };
      }
      case "task_comment": {
        const c = await addComment(ctx, p.taskId, p.text);
        return { code: "done", words: "comment added", refs: { commentId: c.id, taskId: p.taskId } };
      }
      case "task_status": {
        // As the recipient: the task as they see it now. Gone or out of sight: task_gone; no longer theirs: not_allowed.
        const t = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; version: number; status: string; assignee_membership_id: string; archived_at: string | null; title: string }>(
          `SELECT id, version, status, assignee_membership_id, archived_at, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [p.taskId, ctx.org.id]));
        if (!t || t.archived_at) return fail("task_gone", W.results.taskGone);
        if (t.assignee_membership_id !== ctx.membership.id) return fail("not_allowed", W.results.noLongerHolds(me, t.title));
        if (!isRequestTaskStatus(t.status)) return fail("invalid", W.results.invalid);
        if (t.status === p.to) return { code: "done", words: "already there", refs: { taskId: t.id } };
        // Moved since the request was sent: still done when the holder may make this move from where it is now.
        if (!HOLDER_MOVES[t.status].includes(p.to)) return fail("bad_transition", W.results.movedSince(t.title, STATUS_WORDS[t.status].toLowerCase(), STATUS_WORDS[p.to]));
        if (p.to === "in_review") {
          await submitTask(ctx, t.id, { note: p.reason ?? W.results.inReviewNote(o.senderFirst), links: [], fileIds: [] });
        } else if (p.to === "completed") {
          // With a reviewer, Done is a submission: the task waits in review (never "is now done").
          const r = await completeTask(ctx, t.id, { note: p.reason ?? "" });
          if (!r.completed) return { code: "done", words: "sent for a check", refs: { taskId: t.id, sentForCheck: true } };
        } else {
          await updateTask(ctx, t.id, { expectedVersion: t.version, status: p.to, ...(p.reason ? { reason: p.reason } : {}) });
        }
        return { code: "done", words: "moved", refs: { taskId: t.id } };
      }
    }
  } catch (err) {
    return outcomeOfError(err);
  }
}
