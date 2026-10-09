import { route, orgContext } from "@/server/lib/api";
import { voiceSample } from "@/server/services/natural-voice";

/**
 * "Play a sample" (owner decision, 9 October 2026: natural voice (ElevenLabs), contract E.2). Any member; one of the
 * eight voices only (else 404). Costs no characters: the voice's public preview MP3, fetched by this server (the browser
 * never talks to ElevenLabs or Google) and kept in memory for a day. 409 VOICE_UNAVAILABLE `no_key` without any key;
 * 502 when ElevenLabs does not answer. Honours a single byte range, which Safari needs to play audio from a URL (as the
 * voice notes' route does).
 */
export const GET = route<{ org: string; voiceId: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const bytes = await voiceSample(ctx, params.voiceId);
  const headers: Record<string, string> = {
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = bytes.byteLength;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const part = bytes.subarray(start, end + 1);
    return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(part.byteLength) } });
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { ...headers, "content-length": String(bytes.byteLength) } });
});
