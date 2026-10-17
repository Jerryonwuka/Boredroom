import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_LIMITS } from "@/lib/act";
import { readActBody } from "@/server/services/act";
import { scopePlan, scopeSchema } from "@/server/services/act-plan";

/**
 * What Brenda for Mac found for a plan before asking (Brenda for Mac, phase 3; owner request, 12 October 2026: "open an
 * app on my desktop", "look through my documents and summarise them"; contract D.3, H.2.2). Rust alone calls it, once, for
 * the person's own proposed plan: the app it would open, the file or folder it found, the count and kinds of a folder's
 * files (names stay on the Mac; only their hashes come). The answer is the plan with the lines under its sentence and its
 * hash (the yes is to both), or the words to say when something can't be found or opened (the plan then ends). Nothing
 * runs from it, and nothing in it is logged.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, scopeSchema, ACT_LIMITS.scopeBody);
  return ok(await scopePlan(ctx, params.id, body));
});
