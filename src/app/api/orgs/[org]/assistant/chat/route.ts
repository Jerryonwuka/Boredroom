import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { chat, chatSchema } from "@/server/services/copilot";
import { checkAiBurst } from "@/server/services/ai-usage";
import { speakable } from "@/lib/assistant-speech/speakable";
import { speechOfferFor } from "@/server/services/natural-voice";

/**
 * The workspace assistant. Stateless: the browser sends the conversation so far. The reply may carry proposals
 * (to-dos, clock in or out, start a timer, open a page); each is confirmed by the person through the normal endpoint.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): the response also carries `spoken`, the reply as she says it
 * aloud (plain words, no Markdown, links, ids or tokens; lib/assistant-speech/speakable). The notch reads it, so it
 * needs no port of that function; the web ignores it and computes the same thing as it speaks.
 *
 * Limits (owner decision, 8 October 2026: personal assistants, phase 3): bursts are refused here, per person per minute
 * (429 RATE_LIMITED with words the chat shows as they are); the daily limit is checked inside chat(), where the built-in
 * helper still answers past it. Confirm presses and past chats are not limited.
 *
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract D.3): `speech` is null, or `{ path,
 * token, text }` when the person chose a natural voice: `text` is `spoken` as the speech route takes it and `token` is
 * signed for exactly those words, so the web and the notch can have them said by ElevenLabs (and by nothing else).
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  await checkAiBurst(ctx);
  const body = await parseBody(req, chatSchema);
  // The offer's read runs while the model answers when the pool has a connection to spare, else after it (review, 9
  // October 2026: speechOfferFor).
  const offer = speechOfferFor(ctx);
  const result = await chat(ctx, body);
  const spoken = speakable(result.reply);
  return ok({ ...result, spoken, speech: await offer(spoken) });
});
