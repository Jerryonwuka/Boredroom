import { z } from "zod";
import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { decideMentionProposal } from "@/server/services/mentions";
import { speakable } from "@/lib/assistant-speech/speakable";

/**
 * Confirm or decline one of the actions an assistant prepared in a thread (owner decision, 8 October 2026: personal
 * assistants, phase 5), by its index: the signed token never leaves the server. Only the person who tagged (anyone
 * else 404); a Confirm runs once, bound to them as any Confirm is, and needs the AI assistant in the plan; a second
 * press or an expired one 409; 503 before migration 0041. `spoken` as the Brenda confirm route.
 */
export const POST = route<{ org: string; id: string; index: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!/^\d{1,2}$/.test(params.index) || Number(params.index) > 19) throw notFound("That answer is not yours or is no longer there.");
  const body = await parseBody(req, z.object({ decision: z.enum(["confirm", "decline"], { error: "Say confirm or decline." }) }), { maxBytes: 4096 });
  if (body.decision === "confirm") requireFeature(ctx, "AI_ASSISTANT");
  const result = await decideMentionProposal(ctx, params.id, Number(params.index), body.decision);
  const said = result.error ?? (result.actions.map((a) => a.summary).join(". ") || (body.decision === "confirm" ? "Done." : "Not done."));
  return ok({ ...result, spoken: speakable(said) });
});
