import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_SMALL_BODY, readActBody, stepAnswerSchema, stepAnswerTask } from "@/server/services/act";

/**
 * The person's answer to a step that sends, deletes, pays or can't be undone (owner permission rule, 12 October 2026;
 * contract 0.6, D.7.4). Rust alone calls it. A yes (for that exact step: the SHA-256 of what it is) covers that one step;
 * anything else stops the task. A plan's asked step (phase 3: a Boredroom change that reaches anyone else, too) keeps
 * its index in the recorded yes.
 *
 * Brenda and her helpers (contract G.4): a job's asked step too, the Files helper's Trash (the yes covers exactly those
 * files: their count and the SHA-256 of their refs) or the Mac operator's ask_before; a no ends the job.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, stepAnswerSchema, ACT_SMALL_BODY);
  return ok(await stepAnswerTask(ctx, params.id, body));
});
