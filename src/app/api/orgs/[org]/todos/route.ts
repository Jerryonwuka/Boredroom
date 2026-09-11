import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { quickTodo, quickTodoSchema } from "@/server/services/tasks";

/** One-line to-do for staff: everything except the title is filled in automatically. */
export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, quickTodoSchema);
  return idempotent(req, ctx.user, "todos.create", body, async () => ({ status: 201, body: await quickTodo(ctx, body, requestId) }));
});
