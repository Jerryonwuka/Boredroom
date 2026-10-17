import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_SMALL_BODY, answerSchema, answerTask, readActBody } from "@/server/services/act";

/**
 * The person's answer to a proposal from Brenda for Mac (owner permission rule, 12 October 2026: "Brenda should confirm,
 * do you want me to do this? And then I'll say, yes"; contract D.7.2). Rust alone calls it, after a real press on Yes or
 * words that pass the yes grammar (checked here again); the notch page never can. A yes for that exact plan (its SHA-256)
 * within 75 seconds starts the task; anything else ends it. Only from Brenda for Mac, never while someone else is signed
 * in as the person. A plan (phase 3, 12 October 2026): a yes only once what the Mac found came back (409 ACT_NOT_SCOPED),
 * for the sentence and the lines under it.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, answerSchema, ACT_SMALL_BODY);
  return ok(await answerTask(ctx, params.id, body));
});
