import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_SMALL_BODY, readActBody } from "@/server/services/act";
import { progressPlan, progressSchema } from "@/server/services/act-plan";

/**
 * An open step of a plan, done (or not) on the Mac (Brenda for Mac, phase 3; owner request, 12 October 2026; contract
 * D.5.1). Rust alone calls it, after the person's recorded yes, for the step the plan is on (409 ACT_STEP_ORDER
 * otherwise). An open that failed ends the plan; what was done before it stays done.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, progressSchema, ACT_SMALL_BODY);
  return ok(await progressPlan(ctx, params.id, body));
});
