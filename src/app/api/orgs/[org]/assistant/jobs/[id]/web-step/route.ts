import { route, ok, requireFeature } from "@/server/lib/api";
import { macContext } from "@/server/lib/mac-context";
import { JOB_LIMITS } from "@/lib/front";
import { readActBody } from "@/server/services/act";
import { webStep, webStepSchema } from "@/server/services/jobs";

/**
 * One step of a Browser helper job (owner decisions, 4 November 2026: phase 2). Rust alone calls it, as with the Files
 * helper's /step: the transcript it holds (the server keeps its SHA-256) and the results of the calls the extension ran in
 * the person's Chrome; the server asks the model once and answers with the next calls (checked), one call to ask the
 * person about (held until their yes), or the end. Nothing in it is kept or logged.
 */
export const maxDuration = 180;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  requireFeature(mc.ctx, "AI_ASSISTANT");
  const body = await readActBody(req, webStepSchema, JOB_LIMITS.bodyBytes);
  return ok(await webStep(mc, params.id, body));
});
