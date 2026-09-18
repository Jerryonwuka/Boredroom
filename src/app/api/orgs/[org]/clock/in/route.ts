import { route, orgContext, ok } from "@/server/lib/api";
import { clockIn } from "@/server/services/attendance";

/** Clock in for today. A second press is harmless and returns the existing record. */
export const POST = route<{ org: string }>(async (_req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  return ok(await clockIn(ctx, requestId));
});
