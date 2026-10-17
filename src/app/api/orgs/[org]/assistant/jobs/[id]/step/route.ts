import { route, ok, requireFeature } from "@/server/lib/api";
import { macContext } from "@/server/lib/mac-context";
import { JOB_LIMITS } from "@/lib/front";
import { readActBody } from "@/server/services/act";
import { filesStep, filesStepSchema } from "@/server/services/jobs";

/**
 * One step of a Files helper job (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "Helpers run
 * their planning on Boredroom's server (claude-sonnet-5-5) and touch files only through a fixed set of safe Mac actions
 * executed by Rust"; contract G.3, G.4). Rust alone calls it with the transcript it holds (the server keeps its SHA-256)
 * and the results of the calls it ran; the server asks the model once and answers with the next calls (checked), the
 * Trash ask (held until the person's yes), or the end. The Mac operator's steps go to /assistant/act/:id/step.
 * Nothing in it is kept or logged.
 */
export const maxDuration = 180;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  requireFeature(mc.ctx, "AI_ASSISTANT");
  const body = await readActBody(req, filesStepSchema, JOB_LIMITS.bodyBytes);
  return ok(await filesStep(mc, params.id, body));
});
