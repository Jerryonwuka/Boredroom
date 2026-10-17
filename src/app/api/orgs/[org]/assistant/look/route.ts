import { route, ok, readCappedBytes, requireFeature } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { ndjsonResponse } from "@/server/lib/ndjson";
import { macContext } from "@/server/lib/mac-context";
import { countBurst, frontBurst } from "@/server/services/front";
import { lookChat, lookChatStream } from "@/server/services/copilot";
import {
  lookAllowedFrom, lookBodyVersion, lookErrorReason, neverLookRefusal, parseLookJson, readLookBodyV2Value, readLookBodyValue,
} from "@/server/services/screen-help";
import { LOOK_LIMITS, SCREEN_HELP_WORDS } from "@/lib/screen-help";
import { speakable } from "@/lib/assistant-speech/speakable";
import { speechOfferFor } from "@/server/services/natural-voice";

/**
 * Screen help on Brenda for Mac, phase 1 (owner decisions, 11 October 2026: "start building with your recommendations";
 * owner request the same day: "press the two buttons, ask Brenda a question about what I'm pointing at on my screen and
 * she helps me out with it"; contract A.6 to A.8 and D.6). The Mac sends one picture of the person's front window, with
 * their pointer marked and its position, and the chat so far; the person's own assistant answers in words and Confirm
 * cards, exactly as /assistant/chat answers.
 *
 * Phase 2 (owner request and permission rule, 12 October 2026: instant looks, "it must see the desktop and anything
 * under the pointer", "short spoken answers first", and "Brenda cannot take any action except I explicitly give an
 * instruction"; contract D.5): a body with `version: 2` carries the whole screen the pointer is on and a close-up round
 * the pointer, and the look request's own record (the person's words, how they came, their age). The answer streams as
 * lines (`application/x-ndjson`): `text`, `say`, `point`, `propose`, `done`, `error`, `ping`. This route is the only place
 * a task on the Mac can be proposed (propose_task exists only in this turn's tools), and a proposal only asks: nothing
 * happens until the person says yes (/assistant/act/:id/answer). Today's Mac sends version 1 and gets phase 1's JSON.
 *
 * In this order: the plan; Brenda for Mac only (a desktop session), never while someone else is signed in as the person;
 * migration 0057; the workspace offers it now (the pilot list, Allowed, the notice over, Boredroom's own key); the burst
 * limit (the existing bucket: there is no look bucket, it would be a record of looks); the body (at most 4,000,000 bytes,
 * checked whole: any problem is one 422 with nothing from the body in it); never an app on the never-look lists; never
 * during a call. Then the copilot on Boredroom's own key and the pilot model.
 *
 * Brenda and her helpers (review, 16 October 2026; contract K.5.1, "server ≤ 0.3 s"): steps 2 to 4, the call and the
 * burst count come from the one-trip Mac context (macContext: one query once 0060 is applied, the ordinary reads before
 * it), and the burst count is kept after the answer, as the front route does. Before, about twenty sequential round trips
 * ran before "Let me look properly." (about 4 to 5 seconds on the owner's link). The checks, their order and their words
 * are unchanged.
 *
 * The pictures live in memory only: never logged, stored, put in an error or sent anywhere but Anthropic for this answer.
 * Everything that goes wrong becomes an AppError with fixed words, so the generic error handler never prints a raw error;
 * an unexpected one is logged as "[look]" and a short reason with no content. An error after the first line is one
 * `error` line with the same fixed words.
 */
export const maxDuration = 180;

export const POST = route<{ org: string }>(async (req, { params }) => {
  const mc = await macContext(params.org);
  const ctx = mc.ctx;
  let counting = false;
  try {
    requireFeature(ctx, "AI_ASSISTANT");
    const lists = lookAllowedFrom(mc);
    await frontBurst(mc);
    counting = true;
    const raw = await readCappedBytes(req, LOOK_LIMITS.bodyBytes, SCREEN_HELP_WORDS.errors.tooLarge);
    let parsed: unknown;
    try { parsed = parseLookJson(raw); } finally { raw.fill(0); }
    if (lookBodyVersion(parsed) === 2) {
      const body = readLookBodyV2Value(parsed);
      parsed = null;
      if (body.look.app) {
        const never = neverLookRefusal(body.look.app, lists);
        if (never) throw never;
      }
      if (mc.onCall) throw new AppError(409, "LOOK_ON_CALL", SCREEN_HELP_WORDS.errors.onCall);
      return await ndjsonResponse(async (write, signal) => {
        const mac = { name: mc.name, allowance: mc.allowance, checkEvery: mc.checkEvery, ready0060: mc.ready0060 };
        try {
          const result = await lookChatStream(ctx, body, { act: lists.act, lists: { workspace: lists.workspace, you: lists.you }, write, signal, mac });
          write({ t: "done", result });
        } finally {
          await countBurst(mc);
        }
      }, { onError: streamError });
    }
    const body = readLookBodyValue(parsed);
    parsed = null;
    const never = neverLookRefusal(body.look.app, lists);
    if (never) throw never;
    if (mc.onCall) throw new AppError(409, "LOOK_ON_CALL", SCREEN_HELP_WORDS.errors.onCall);
    // Her answer describes the screen, so it is offered only on Boredroom's own ElevenLabs key: a workspace's own key
    // keeps it in that workspace's ElevenLabs History (review, 11 October 2026). Otherwise the Mac's own voice says it.
    const offer = speechOfferFor(ctx, { boredroomKeyOnly: true });
    const result = await lookChat(ctx, body).finally(() => countBurst(mc));
    const spoken = speakable(result.reply);
    return ok({ ...result, spoken, speech: await offer(spoken) });
  } catch (err) {
    // A request refused after the burst check still counts towards it, as it did when the count came first.
    if (counting) await countBurst(mc);
    if (err instanceof AppError) throw err;
    console.error(`[look] ${lookErrorReason(err)}`);
    // Only lookChat's own LOOK_FAILED (an AppError, passed on above) is about Claude; anything else here (a database
    // fault before the model was asked, say) gets neutral words (review, 11 October 2026).
    throw new AppError(502, "LOOK_FAILED", SCREEN_HELP_WORDS.errors.serverFailed);
  }
});

/** An error after the stream started, as an `error` line: fixed words only, never anything from the request. */
function streamError(err: unknown): Record<string, unknown> {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  console.error(`[look] ${lookErrorReason(err)}`);
  return { status: 502, code: "LOOK_FAILED", message: SCREEN_HELP_WORDS.errors.serverFailed };
}
