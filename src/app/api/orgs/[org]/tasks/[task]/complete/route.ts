import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { completeTask, completeSchema } from "@/server/services/tasks";

/** "Done" from My Day: own to-dos complete at once; tasks handed out by someone else go to them for a check. */
export const POST = route<{ org: string; task: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, completeSchema);
  return idempotent(req, ctx.user, `tasks.complete:${params.task}`, body, async () => ({ status: 200, body: await completeTask(ctx, params.task, body, requestId) }));
});
