import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { updateTask, updateTaskSchema } from "@/server/services/tasks";
import { taskDetail } from "@/server/services/views";
import { notFound } from "@/server/lib/errors";

/** GET is what the task pop-up on the Tasks page shows: the task, its discussion and status history. */
export const GET = route<{ org: string; task: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  const d = await taskDetail(ctx, params.task);
  if (!d) throw notFound("Task not found.");
  return ok({ task: d.task, comments: d.comments.slice(-5), history: d.history, canManage: d.canManage, submissions: d.submissions.length, sessions: d.sessions.length });
});

export const PATCH = route<{ org: string; task: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, updateTaskSchema);
  return ok(await updateTask(ctx, params.task, body, requestId));
});
