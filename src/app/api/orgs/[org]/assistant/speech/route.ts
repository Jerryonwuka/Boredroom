import { NextResponse } from "next/server";
import { route, parseBody, orgContextTx, requireFeature } from "@/server/lib/api";
import { AppError, invalid } from "@/server/lib/errors";
import {
  SPEECH_BODY_MAX, collectAudio, prepareSpeechIn, retryVoiceSchemas, speakPrepared, speechSchema, voiceUnavailable,
} from "@/server/services/natural-voice";

export const dynamic = "force-dynamic";

/**
 * A reply's words in the person's natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract
 * E.1). POST `{ token, text, speed?, as? }`, where `token` and `text` are the `speech` offer a reply carried (the chat,
 * Confirm, Undo): the token is signed, bound to the person, the workspace and these exact words, so this route only ever
 * says what the person's own assistant said to them, never arbitrary text (400 SPEECH_TOKEN otherwise). Signed in on the
 * web (cookie) or from the notch (its desktop token, `Authorization: Bearer`), through the same `orgContext`.
 *
 * Answers an MP3 stream (`as: "stream"`, the web), or the whole MP3 as base64 JSON (`as: "base64"`, the notch, whose
 * bridge returns JSON only). 409 VOICE_UNAVAILABLE `{ details: { reason } }` when the computer voice should speak instead
 * (no voice chosen, Voice off, no key, a cap, the allowance low, ElevenLabs held as down); 502 when ElevenLabs failed
 * (the characters are given back); 429 past 30 a minute; 402 when the plan no longer has the assistant (the offer
 * needed it). The client falls back to the computer voice on any of them.
 *
 * Nothing is stored here (no file, no cache, no row with the words or the audio) and nothing is logged: not the words,
 * the key or the token. ElevenLabs keeps each generation in the History of the key's account, so once the stream is over
 * it is deleted from there by ElevenLabs' own ids for it, never by its words, with a job (ids only) behind the quick tries so a
 * restart loses nothing (services/natural-voice `forgetSpoken`; review and fix review, 9 October 2026). A person who stops
 * before the audio starts is answered at once, but the request to ElevenLabs waits for its headers (its ids) before it is
 * cancelled. Every failure here is an AppError with fixed words, so `errorResponse` never logs a raw error.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  // Read before the transaction opens (a body that is slow to arrive never holds a connection), but a bad one is
  // answered only after the burst limit has counted the request, as before (review, 9 October 2026). Only a JSON body is
  // read here, before the session is known, and never past SPEECH_BODY_MAX: parseBody reads a form body whole, with no
  // cap, and the web and the notch only ever send JSON. Anything else is refused as invalid after the same checks.
  // The same test as parseBody's, so it always takes its capped JSON branch.
  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? parseBody(req, speechSchema, { maxBytes: SPEECH_BODY_MAX }) : Promise.reject(invalid("Body must be valid JSON."));
  await body.then(() => undefined, () => undefined);
  try {
    // The session, the membership, the plan, the burst limit, the person's voice, the key, today's totals and the
    // reservation: one transaction, about 4 round trips where it was 26 in 7 (prepareSpeechIn says what is checked, and
    // in which order). A 401, 404, 403, 402 or 429 is thrown before anything is reserved.
    const out = await retryVoiceSchemas(
      () => orgContextTx(params.org, async (ctx, db) => {
        requireFeature(ctx, "AI_ASSISTANT");
        return { ctx, prepared: await prepareSpeechIn(db, ctx, body, req.signal, { burst: true }) };
      }),
      () => null);
    if (!out) throw voiceUnavailable("not_ready");
    const { ctx, prepared } = out;
    const { stream, characters } = await speakPrepared(ctx, prepared, req.signal);
    if ((await body).as === "base64") {
      const audio = await collectAudio(stream);
      return NextResponse.json(
        { audio: Buffer.from(audio).toString("base64"), mime: "audio/mpeg", characters },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-speech-characters": String(characters),
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Only the error's code (a Postgres code, say): never its message, which could carry the words.
    console.warn(`[voice] speech failed (${String((err as { code?: unknown } | null)?.code ?? "unknown")})`);
    throw new AppError(502, "VOICE_UNAVAILABLE", "ElevenLabs didn't answer, so the computer voice is used.", { details: { reason: "upstream" } });
  }
});
