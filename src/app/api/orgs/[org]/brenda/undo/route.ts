import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { UNDO_TOKEN_MAX, undoAction } from "@/server/services/undo";
import { speakable } from "@/lib/assistant-speech/speakable";
import { speechOfferFor } from "@/server/services/natural-voice";

/**
 * Undo (owner decision, 8 October 2026: act without asking): takes back something the person's assistant did without a
 * Confirm press, within 10 minutes, once. `{ token }` (the done line's `undo.token`) → `{ undone: true, summary, spoken }`.
 * The token is signed and bound to the person; it runs as them through the same services the buttons use
 * (services/undo). Errors: 400 INVALID, 403 FORBIDDEN, 409 ALREADY_UNDONE | UNDO_EXPIRED | UNDO_CHANGED | UNDO_TOO_LATE
 * (their words say why), 503 NOT_READY. The web chat and the notch (its bearer session) both call it; `spoken` is the
 * summary as the notch may say it aloud (as /brenda/confirm). Not plan-gated: undoing never needs the plan. `speech` as
 * the chat route (natural voice, owner decision, 9 October 2026, contract D.3); null without the assistant in the plan.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ token: z.string().min(10).max(UNDO_TOKEN_MAX) }), { maxBytes: 17_000 });
  const offer = speechOfferFor(ctx); // read while the undo runs, when a connection is spare (review, 9 October 2026)
  const result = await undoAction(ctx, body.token);
  const spoken = speakable(result.summary);
  return ok({ ...result, spoken, speech: await offer(spoken) });
});
