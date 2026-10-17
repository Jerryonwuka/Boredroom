import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_SMALL_BODY, readActBody } from "@/server/services/act";
import { runPlanChange, runSchema } from "@/server/services/act-plan";

/**
 * A Boredroom change a plan reached (Brenda for Mac, phase 3; owner permission rule, 12 October 2026; contract D.5.4).
 * Rust alone calls it, after the person's recorded yes to the plan, for the step the plan is on. A change that reaches
 * anyone else asks again first ("Next I'll go ahead with …. Do you want me to do this?") and runs only with that step's
 * own recorded yes; it runs exactly as the person's Confirm press would.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, runSchema, ACT_SMALL_BODY);
  return ok(await runPlanChange(ctx, params.id, body));
});
