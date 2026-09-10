import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { reviewSubmission, reviewSchema } from "@/server/services/evidence";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, reviewSchema);
  return idempotent(req, ctx.user, `review:${params.id}`, body, async () => ({ status: 200, body: await reviewSubmission(ctx, params.id, body, requestId) }));
});
