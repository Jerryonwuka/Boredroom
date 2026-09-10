import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { createTask, createTaskSchema } from "@/server/services/tasks";

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, createTaskSchema);
  return idempotent(req, ctx.user, "tasks.create", body, async () => ({ status: 201, body: await createTask(ctx, body, requestId) }));
});
