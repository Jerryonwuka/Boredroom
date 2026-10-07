import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { chat, chatSchema } from "@/server/services/copilot";
import { speakable } from "@/lib/assistant-speech/speakable";

/**
 * The workspace assistant. Stateless: the browser sends the conversation so far. The reply may carry proposals
 * (to-dos, clock in or out, start a timer, open a page); each is confirmed by the person through the normal endpoint.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): the response also carries `spoken`, the reply as she says it
 * aloud (plain words, no Markdown, links, ids or tokens; lib/assistant-speech/speakable). The notch reads it, so it
 * needs no port of that function; the web ignores it and computes the same thing as it speaks.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseBody(req, chatSchema);
  const result = await chat(ctx, body);
  return ok({ ...result, spoken: speakable(result.reply) });
});
