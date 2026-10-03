import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { briefing } from "@/server/services/brenda";

/** "What's waiting for me today?" from the person's own data. */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  return ok(await briefing(ctx));
});
