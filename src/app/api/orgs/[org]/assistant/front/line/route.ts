import { route, orgContext, ok, parseBody, requireFeature } from "@/server/lib/api";
import { frontLineOffer, lineSchema } from "@/server/services/front";

/**
 * A speech offer for a line the notch says (Brenda and her helpers, contract M.2; owner request, 27 October 2026:
 * "everything ElevenLabs, no local voice at all"). The notch never speaks with the Mac's own voice any more: a line
 * without an offer of its own (the doing and done lines, a plan and its question, a step's question, a job's end) is
 * signed here for this person and said in their ElevenLabs voice; `{speech: null}` when they have none available (she
 * then stays quiet). The page may call it (it is not one of the Rust-only routes); nothing is stored or logged.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseBody(req, lineSchema, { maxBytes: 4_096 });
  return ok(await frontLineOffer(ctx, body.text));
});
