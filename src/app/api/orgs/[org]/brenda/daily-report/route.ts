import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { teamReportNow } from "@/server/services/daily-report";
import { checkAiBurst } from "@/server/services/ai-usage";

/**
 * "Send me today's report now" (Settings): Brenda writes today's team report for the person asking and saves it to
 * their Docs, or returns today's end-of-day report once it has gone out. Team leads, the owner and HR; staff get 403.
 * Each press may call the model for the headline, so it is held to the same per-minute burst limit as the chat and counts
 * as one of the person's daily requests (review, 8 October 2026).
 */
export const POST = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  await checkAiBurst(ctx);
  const r = await teamReportNow(ctx);
  if (r.status === "refused") throw forbidden(r.message);
  return ok(r);
});
