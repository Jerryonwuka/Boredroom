import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { requestAdjustment, adjustmentSchema } from "@/server/services/reports";

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, adjustmentSchema);
  return idempotent(req, ctx.user, "adjustments.create", body, async () => ({ status: 201, body: await requestAdjustment(ctx, body, requestId) }));
});
