import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { looseEndTodoSchema, looseEndToTodo } from "@/server/services/loose-ends";

/**
 * "Make it a to-do" (owner decisions, 8 October 2026: phase 7b): the person's own press after the confirm sheet (a to-do
 * from someone else's words is never made in one press). `{ title, dueAt? }` → `{ looseEnd }`. Not theirs 404, already
 * acted on 409 ITEM_CLOSED, owners and HR 403 (they hold no to-dos), 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, looseEndTodoSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "loose_ends.todo", { id: params.id, ...body }, async () => ({ status: 200, body: { looseEnd: await looseEndToTodo(ctx, params.id, body) } }));
});
