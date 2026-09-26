import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { bulkTasks, bulkSchema } from "@/server/services/tasks";

/** One action on many tasks: remove them, or hand them all to one person. Reports which ones refused. */
export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bulkSchema);
  return ok(await bulkTasks(ctx, body, requestId));
});
