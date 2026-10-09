import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { answerBlock, answerBlockSchema } from "@/server/services/task-blocks";

/**
 * Answer a "blocked on you" (owner decisions, 8 October 2026: phase 7b): `{ answer, unblock? }`. The person waited on
 * alone: the answer is posted on the task as their comment, and `unblock` moves the task back to In progress. `{ block }`.
 * Anyone else 404, already answered 409 ITEM_CLOSED, empty or too long 422, 403 while someone else is signed in as the
 * person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, answerBlockSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "task_blocks.answer", { id: params.id, ...body }, async () => ({ status: 200, body: { block: await answerBlock(ctx, params.id, body) } }));
});
