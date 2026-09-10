import { route, orgContext, ok } from "@/server/lib/api";
import { authoriseDeliverableDownload } from "@/server/services/evidence";

export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await authoriseDeliverableDownload(ctx, params.id));
});
