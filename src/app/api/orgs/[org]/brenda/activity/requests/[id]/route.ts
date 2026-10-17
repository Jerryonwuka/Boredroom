import { route, orgContext, ok } from "@/server/lib/api";
import { forgetRequest } from "@/server/services/front";

/**
 * Forget one of the person's own requests on their Mac (Brenda and her helpers, build 1; owner's approved brief, 12
 * October 2026: the request is the record, kept 30 days for the person alone; contract E.4, N.3): the request and, when it
 * started one, its job (refused while that job runs: 409 JOB_LIVE, "Stop it first."). Only their own (404 otherwise);
 * never while someone else is signed in as them.
 */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await forgetRequest(ctx, params.id));
});
