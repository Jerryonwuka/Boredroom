import { route, orgContext, ok } from "@/server/lib/api";
import { forgetJob } from "@/server/services/jobs";

/**
 * Forget one of the person's own ended jobs and its request (Brenda and her helpers, build 1; contract E.4, N.1). 404 when
 * it isn't theirs; 409 JOB_LIVE while it runs ("Stop it first."); never while someone else is signed in as them.
 */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await forgetJob(ctx, params.id));
});
