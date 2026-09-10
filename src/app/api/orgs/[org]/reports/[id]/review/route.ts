import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { reviewReport, reviewReportSchema } from "@/server/services/reports";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, reviewReportSchema);
  await reviewReport(ctx, params.id, body, requestId);
  return ok({ ok: true });
});
