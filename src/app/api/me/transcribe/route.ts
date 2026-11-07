import { route, requireAuth, ok } from "@/server/lib/api";
import { AppError, invalid } from "@/server/lib/errors";
import { rateLimitCommitted } from "@/server/auth";
import { ElevenLabsError, STT_MAX_BYTES, transcribeSpeech } from "@/server/services/elevenlabs";

export const maxDuration = 60;

const AUDIO = /^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a|aac)(;.*)?$/i;

/**
 * A voice note's words (owner request, 7 November 2026: "When I send voice note on to Brenda, should reply me
 * instantly", the server option chosen over on-device): the recording as the body (audio/webm, mp4, ogg …, at most 10 MB),
 * its words back as `{ text }`, by ElevenLabs' Scribe with Boredroom's key. Signed-in people only; 60 notes in 10 minutes.
 * The audio is passed straight on and never kept or logged. 503 STT_UNAVAILABLE when the key isn't set or ElevenLabs
 * can't be used, so dictation carries on on the device instead.
 */
export const POST = route(async (req) => {
  const user = await requireAuth();
  const type = req.headers.get("content-type") ?? "";
  if (!AUDIO.test(type)) throw invalid("Send the recording as audio.");
  if (Number(req.headers.get("content-length") ?? 0) > STT_MAX_BYTES) throw invalid("That recording is too long.");
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new AppError(503, "STT_UNAVAILABLE", "Dictation on the server isn't set up.");
  await rateLimitCommitted(`stt:${user.profileId}`, 60, 600, "That's a lot of voice notes at once. Wait a few minutes, or type instead.");
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw invalid("The recording was empty.");
  if (bytes.byteLength > STT_MAX_BYTES) throw invalid("That recording is too long.");
  try {
    const { text } = await transcribeSpeech(key, new Blob([bytes], { type: type.split(";")[0] }), req.signal);
    const res = ok({ text });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      console.warn(`[transcribe] ${err.kind}`);
      throw new AppError(503, "STT_UNAVAILABLE", "Dictation on the server couldn't be used just now.");
    }
    throw err;
  }
});
