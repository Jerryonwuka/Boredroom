import { route, ok, requireFeature } from "@/server/lib/api";
import { macContext } from "@/server/lib/mac-context";
import { readActBody } from "@/server/services/act";
import { createJob, createJobSchema } from "@/server/services/jobs";

/**
 * Starts a background job (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "Helpers in the
 * background … THIS BUILD: the Files helper … and the Mac operator"; contract G.2). Rust alone calls it, with the
 * router's signed job token for the person's own request (120 seconds; this person and workspace; a nonce with no job
 * yet), their yes when "Check with me before every task" is on, and for the Mac operator this Mac's one-time consent.
 * One transaction writes the request row and the job row; the database refuses a running job without the person's own
 * recorded request judged routine, or their recorded yes. One live job per person (409 JOB_BUSY).
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  requireFeature(mc.ctx, "AI_ASSISTANT");
  const body = await readActBody(req, createJobSchema, 16_000);
  return ok(await createJob(mc, body));
});
