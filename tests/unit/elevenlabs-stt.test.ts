/**
 * Voice notes written out on the server (owner request, 7 November 2026: "When I send voice note on to Brenda, should
 * reply me instantly"): ElevenLabs' Scribe, fetch ALWAYS mocked (tests/setup.ts loads .env.local, so a real key is here).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ELEVENLABS_API, ElevenLabsError, STT_MODEL, setElevenLabsFetchForTests, transcribeSpeech } from "@/server/services/elevenlabs";

const KEY = "sk_test_key_never_real_0123456789abcdef";
const note = () => new Blob([new Uint8Array(4_000)], { type: "audio/webm" });

afterEach(() => setElevenLabsFetchForTests(null));

describe("transcribeSpeech", () => {
  it("sends the recording to Scribe with the key in its header only, and answers the words", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    setElevenLabsFetchForTests((async (url: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ text: "  Find   my last order ", language_code: "eng" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);
    expect(await transcribeSpeech(KEY, note())).toEqual({ text: "Find my last order", language: "eng" });
    expect(seen!.url).toBe(`${ELEVENLABS_API}/v1/speech-to-text`);
    expect((seen!.init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    const form = seen!.init.body as FormData;
    expect(form.get("model_id")).toBe(STT_MODEL);
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(seen!.url).not.toContain(KEY);
  });

  it("a rejected key, a busy service or an unreadable answer is an ElevenLabsError (never the body)", async () => {
    setElevenLabsFetchForTests((async () => new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "secret words" } }), { status: 401 })) as typeof fetch);
    await expect(transcribeSpeech(KEY, note())).rejects.toBeInstanceOf(ElevenLabsError);
    setElevenLabsFetchForTests((async () => new Response("{}", { status: 200 })) as typeof fetch);
    await expect(transcribeSpeech(KEY, note())).rejects.toMatchObject({ kind: "upstream" });
    setElevenLabsFetchForTests((async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    await expect(transcribeSpeech(KEY, note())).rejects.toMatchObject({ kind: "network" });
  });
});
