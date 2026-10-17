import { route, orgContext, ok, parseBody, requireFeature } from "@/server/lib/api";
import { frontLineOffer, lineSchema } from "@/server/services/front";

/**
 * The first short line in the person's natural voice (Brenda and her helpers, build 1; owner's approved brief, 12 October
 * 2026: "She speaks a short line at once ('Opening Figma') … first sound ≤ 1 s"; contract M.2). The notch page says the
 * line at once in the Mac's own voice and asks here, in the background, for a speech offer so the ElevenLabs clip is
 * kept for next time. Only the fixed doing and done lines (S.1) with a plain name get one; anything else `{speech: null}`.
 * The page may call it (it is not one of the Rust-only routes); nothing is stored or logged.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseBody(req, lineSchema, { maxBytes: 2_048 });
  return ok(await frontLineOffer(ctx, body.text));
});
