import { route, orgContext, ok } from "@/server/lib/api";
import { clearPastTasks } from "@/server/services/tasks";

/** Clears the caller's past tasks from their own list. Nothing is deleted. */
export const POST = route<{ org: string }>(async (_req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  return ok(await clearPastTasks(ctx, requestId));
});
