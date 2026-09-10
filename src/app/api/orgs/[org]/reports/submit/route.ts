import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { submitReport, submitReportSchema } from "@/server/services/reports";

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, submitReportSchema);
  return idempotent(req, ctx.user, `reports.submit:${body.localDate}`, body, async () => ({ status: 201, body: await submitReport(ctx, body, requestId) }));
});
