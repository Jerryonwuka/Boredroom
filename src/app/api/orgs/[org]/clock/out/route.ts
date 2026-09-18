import { route, orgContext, ok } from "@/server/lib/api";
import { clockOut } from "@/server/services/attendance";

/** Clock out for today. Refused while a timer is still running. */
export const POST = route<{ org: string }>(async (_req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  return ok(await clockOut(ctx, requestId));
});
