import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { planFromText, planRequestSchema } from "@/server/services/assistant";
import { checkAiBurst } from "@/server/services/ai-usage";

/**
 * Turns a typed or dictated note into proposed to-dos. Nothing is created here: the member reviews the
 * proposals in the browser and confirms, which goes through the normal to-do endpoint. Bursts are refused per person
 * per minute (owner decision, 8 October 2026: personal assistants, phase 3); the daily limit is checked in planFromText.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  await checkAiBurst(ctx);
  const body = await parseBody(req, planRequestSchema);
  return ok(await planFromText(ctx, body));
});
