import { z } from "zod";
import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { confirmAction } from "@/server/services/copilot";
import { speakable } from "@/lib/assistant-speech/speakable";

/**
 * Runs an action Brenda prepared and the person approved. The token is signed, short-lived and bound to the person.
 *
 * Her voice (review, 7 October 2026: phase 2): the response also carries `spoken`, what running it did as she says it
 * aloud (lib/assistant-speech/speakable), as the chat route does. The notch reads it: the summaries carry what people
 * typed (a to-do's title), which must never reach `say` as a URL, an id or one of its `[[…]]` commands. The words are
 * the notch's own (the error, else the summaries joined, else "Done."); the web ignores it.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseBody(req, z.object({ token: z.string().min(10).max(8000) }));
  const result = await confirmAction(ctx, body.token);
  const said = result.error ?? (result.actions.map((a) => a.summary).join(". ") || "Done.");
  return ok({ ...result, spoken: speakable(said) });
});
