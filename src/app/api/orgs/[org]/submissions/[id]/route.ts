import { route, orgContext, ok } from "@/server/lib/api";
import { submissionDetail } from "@/server/services/evidence";

/** What the review pop-up shows for one submission. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await submissionDetail(ctx, params.id));
});
