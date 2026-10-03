import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { autoClockIn } from "@/server/services/brenda";

/** The app reports the first sign of work today; Brenda clocks the person in if the organisation and the person allow it. */
export const POST = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  return ok(await autoClockIn(ctx));
});
