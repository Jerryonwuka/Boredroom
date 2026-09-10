import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { updateTask, updateTaskSchema } from "@/server/services/tasks";

export const PATCH = route<{ org: string; task: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, updateTaskSchema);
  return ok(await updateTask(ctx, params.task, body, requestId));
});
