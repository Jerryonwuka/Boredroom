import { route, orgContext, ok } from "@/server/lib/api";
import { forgetTask } from "@/server/services/act";

/**
 * Forget one of the person's own tasks on their Mac in their Activity (owner request, 12 October 2026; contract D.11,
 * E.6): only an ended task, only their own (404 otherwise), never while someone else is signed in as them.
 */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await forgetTask(ctx, params.id));
});
