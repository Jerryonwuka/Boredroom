/**
 * The ElevenLabs client (owner decision, 9 October 2026: natural voice (ElevenLabs), contract B.5 and H). fetch is
 * ALWAYS mocked: text-to-speech costs the owner's allowance, and tests/setup.ts loads .env.local, so a real key is
 * present here. The last test proves the client's own default fetch refuses to run under NODE_ENV=test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ELEVENLABS_API, ElevenLabsError, HISTORY_PAGES, TTS_FORMAT, TTS_MODEL, TIMEOUTS,
  deleteHistoryItem, fetchPreview, findHistoryItem, getSubscription, getVoicePreviewUrl, looksLikeMp3, previewUrlAllowed,
  setElevenLabsFetchForTests, speechRefOf, streamSpeech, type SpeechRef,
} from "@/server/services/elevenlabs";

const KEY = "sk_test_key_never_real_0123456789abcdef";
const LILY = "pFZP5JQG7iQjIQuC4Bku";
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 1, 2, 3, 4]);
const FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);

type Call = { url: string; init: RequestInit };
let calls: Call[];
let logs: ReturnType<typeof vi.spyOn>[];

function mock(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  setElevenLabsFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch);
}

/** A fetch that never answers until its signal aborts (then rejects as fetch does). */
function hang(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stream = (...chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });

async function readAll(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const r = s.getReader();
  const parts: number[] = [];
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(...value); }
  return new Uint8Array(parts);
}

async function caught(p: Promise<unknown>): Promise<ElevenLabsError> {
  try { await p; } catch (e) { return e as ElevenLabsError; }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  calls = [];
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(() => {
  // Nothing in the client logs, whatever happened.
  for (const l of logs) expect(l).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setElevenLabsFetchForTests(null);
});

describe("streamSpeech (mocked: never a real text-to-speech call)", () => {
  it("POSTs to the stream endpoint with the key, Flash v2.5, MP3 64 kbps and the speed", async () => {
    mock(() => new Response(stream(MP3), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const s = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hello there.", speed: 1.1, signal: new AbortController().signal });
    expect(await readAll(s)).toEqual(MP3);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(`${ELEVENLABS_API}/v1/text-to-speech/${LILY}/stream?output_format=mp3_44100_64`);
    expect(init.method).toBe("POST");
    const h = new Headers(init.headers);
    expect(h.get("xi-api-key")).toBe(KEY);
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("accept")).toBe("audio/mpeg");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hello there.", model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.1 } });
    expect(TTS_MODEL).toBe("eleven_flash_v2_5");
    expect(TTS_FORMAT).toBe("mp3_44100_64");
  });

  it("keeps the speed inside 0.7 to 1.2", async () => {
    mock(() => new Response(stream(MP3), { status: 200 }));
    await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 3, signal: new AbortController().signal });
    await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 0.1, signal: new AbortController().signal });
    expect(calls.map((c) => JSON.parse(String(c.init.body)).voice_settings.speed)).toEqual([1.2, 0.7]);
  });

  it("never puts a voice outside the catalogue in a URL, and never sends empty words", async () => {
    mock(() => new Response(stream(MP3), { status: 200 }));
    for (const voiceId of ["../../v1/user", "EXAVITQu4vr4xnSDxMaL", ""]) {
      expect(await caught(streamSpeech({ apiKey: KEY, voiceId, text: "Hi.", speed: 1, signal: new AbortController().signal }))).toMatchObject({ kind: "bad_request" });
    }
    expect(await caught(streamSpeech({ apiKey: KEY, voiceId: LILY, text: "  ", speed: 1, signal: new AbortController().signal }))).toMatchObject({ kind: "bad_request" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota of 38373." } }, "quota"],
    [401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission text_to_speech." } }, "missing_permissions"],
    [403, { detail: { status: "missing_permissions" } }, "missing_permissions"],
    [401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }, "key_rejected"],
    [401, "Unauthorized", "key_rejected"],
    [403, { detail: "forbidden" }, "key_rejected"],
    [429, { detail: { status: "too_many_concurrent_requests" } }, "busy"],
    [400, { detail: { status: "invalid_text" } }, "bad_request"],
    [422, { detail: [{ loc: ["body", "text"], msg: "field required", type: "missing" }] }, "bad_request"],
    [500, "Internal error", "upstream"],
    [503, { detail: { status: "system_busy" } }, "upstream"],
  ])("maps %i %j to %s, with no body words in the error", async (status, body, kind) => {
    mock(() => typeof body === "string" ? new Response(body, { status }) : json(status, body));
    const e = await caught(streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Secret plans for Friday.", speed: 1, signal: new AbortController().signal }));
    expect(e).toBeInstanceOf(ElevenLabsError);
    expect(e).toMatchObject({ kind, status });
    expect(e.message).not.toMatch(/quota of|Invalid API key|the permission|Secret|field required|Internal error/);
    expect(e.message).not.toContain(KEY);
  });

  it("a fetch TypeError is the network", async () => {
    mock(() => { throw new TypeError("fetch failed"); });
    expect(await caught(streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: new AbortController().signal }))).toMatchObject({ kind: "network" });
  });

  it("no answer within 10 seconds is a timeout", async () => {
    vi.useFakeTimers();
    mock(hang);
    const p = caught(streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: new AbortController().signal }));
    await vi.advanceTimersByTimeAsync(TIMEOUTS.speechHeaders - 1);
    expect(calls[0].init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ kind: "timeout" });
  });

  it("the caller's abort (Stop) before the headers waits for them, cancels the audio, gives onEnd the ids and is an AbortError (fix review, 9 October 2026)", async () => {
    let upstream: AbortSignal | undefined;
    let answer!: (r: Response) => void;
    let cancelled = false;
    mock((_u, init) => { upstream = init.signal ?? undefined; return new Promise<Response>((r) => { answer = r; }); });
    const ctl = new AbortController();
    const ends: SpeechRef[] = [];
    const p = streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: ctl.signal, onEnd: (r) => ends.push(r) });
    ctl.abort();
    await new Promise((r) => setTimeout(r, 10));
    // Still waiting: the headers carry the only ids the generation can be deleted by.
    expect(upstream?.aborted).toBe(false);
    answer(new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(FRAME); }, cancel() { cancelled = true; } }), { status: 200, headers: { "history-item-id": "HIST_stop01", "request-id": "reqStop01" } }));
    const e = await caught(p);
    expect(e).not.toBeInstanceOf(ElevenLabsError);
    expect(e.name).toBe("AbortError");
    expect(cancelled).toBe(true);
    expect(ends).toEqual([{ historyItemId: "HIST_stop01", requestId: "reqStop01" }]);
  });

  it("stopped before the headers and none come: a timeout after 10 seconds, with no ids", async () => {
    vi.useFakeTimers();
    mock(hang);
    const ctl = new AbortController();
    const ends: SpeechRef[] = [];
    const p = caught(streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: ctl.signal, onEnd: (r) => ends.push(r) }));
    ctl.abort();
    await vi.advanceTimersByTimeAsync(TIMEOUTS.speechHeaders + 1);
    expect(await p).toMatchObject({ kind: "timeout" });
    expect(ends).toEqual([]);
  });

  it("the caller's abort while the audio plays errors the stream and tells onEnd", async () => {
    mock((_u, init) => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(FRAME);
        init.signal?.addEventListener("abort", () => c.error(new DOMException("This operation was aborted", "AbortError")));
      },
    }), { status: 200, headers: { "history-item-id": "HIST_mid01" } }));
    const ctl = new AbortController();
    const ends: SpeechRef[] = [];
    const s = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: ctl.signal, onEnd: (r) => ends.push(r) });
    const r = s.getReader();
    expect((await r.read()).value).toEqual(FRAME);
    ctl.abort();
    const e = await r.read().then(() => null, (x) => x as Error);
    expect(e?.name).toBe("AbortError");
    expect(ends).toEqual([{ historyItemId: "HIST_mid01", requestId: null }]);
  });

  it("the whole stream gets 60 seconds after the headers", async () => {
    vi.useFakeTimers();
    mock((_u, init) => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(FRAME);
        init.signal?.addEventListener("abort", () => c.error(new DOMException("This operation was aborted", "AbortError")));
      },
    }), { status: 200 }));
    const s = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: new AbortController().signal });
    const r = s.getReader();
    expect((await r.read()).value).toEqual(FRAME);
    const next = r.read().then(() => null, (e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUTS.speechWhole + 1);
    expect(await next).toMatchObject({ kind: "timeout" });
  });

  it("cancelling the stream aborts the upstream request", async () => {
    let upstream: AbortSignal | undefined;
    mock((_u, init) => { upstream = init.signal ?? undefined; return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(FRAME); } }), { status: 200 }); });
    const s = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: new AbortController().signal });
    await s.cancel();
    expect(upstream?.aborted).toBe(true);
  });
});

describe("the key's History (free; review, 9 October 2026)", () => {
  it("streamSpeech says once, when the stream is over, ElevenLabs' ids for it (read to the end, or cancelled)", async () => {
    mock(() => new Response(stream(MP3), { status: 200, headers: { "history-item-id": "HIST_abc123", "request-id": "req-7f3e2a" } }));
    const ends: SpeechRef[] = [];
    const s = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hello.", speed: 1, signal: new AbortController().signal, onEnd: (r) => ends.push(r) });
    expect(ends).toEqual([]);
    await readAll(s);
    expect(ends).toEqual([{ historyItemId: "HIST_abc123", requestId: "req-7f3e2a" }]);

    mock(() => new Response(stream(MP3, MP3), { status: 200, headers: { "request-id": "req-2b9c1" } }));
    const s2 = await streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hello.", speed: 1, signal: new AbortController().signal, onEnd: (r) => ends.push(r) });
    await s2.cancel();
    await s2.cancel().catch(() => undefined);
    expect(ends.at(-1)).toEqual({ historyItemId: null, requestId: "req-2b9c1" });
    expect(ends).toHaveLength(2);
  });

  it("ignores ids that are not plain ids", () => {
    expect(speechRefOf(new Headers({ "history-item-id": "../x", "request-id": "a b" }))).toEqual({ historyItemId: null, requestId: null });
  });

  it("finds our item by its request id and voice only, never by its words (fix review, 9 October 2026)", async () => {
    const items = [
      // The key holder typed the same words into ElevenLabs' playground with the same voice and model, after ours.
      { history_item_id: "holder1", request_id: "reqHolder99", voice_id: LILY, text: "Hello.", model_id: TTS_MODEL },
      { history_item_id: "nullreq2", request_id: null, voice_id: LILY, text: "Hello.", model_id: TTS_MODEL },
      { history_item_id: "ours22", request_id: "req-1abc", voice_id: LILY, text: "Hello.", model_id: TTS_MODEL },
    ];
    mock(() => json(200, { history: items, has_more: false, last_history_item_id: "ours22" }));
    expect(await findHistoryItem(KEY, { voiceId: LILY, requestId: "req-1abc", sinceUnix: 1_760_000_000 })).toBe("ours22");
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe(`${ELEVENLABS_API}/v1/history`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ page_size: "100", voice_id: LILY, source: "TTS", date_after_unix: "1760000000" });
    expect(new Headers(calls[0].init.headers).get("xi-api-key")).toBe(KEY);
    expect(calls[0].init.method).toBe("GET");
    // Another request id, or none: nothing, whatever the words.
    expect(await findHistoryItem(KEY, { voiceId: LILY, requestId: "req-404x", sinceUnix: 1 })).toBeNull();
    // The same request id in another voice is not ours either.
    mock(() => json(200, { history: [{ history_item_id: "other3", request_id: "req-1abc", voice_id: "JBFqnCBsd6RMkjVDRZzb", text: "Hello." }], has_more: false }));
    expect(await findHistoryItem(KEY, { voiceId: LILY, requestId: "req-1abc", sinceUnix: 1 })).toBeNull();
    await expect(findHistoryItem(KEY, { voiceId: "../../v1/user", requestId: "req-1abc", sinceUnix: 1 })).rejects.toMatchObject({ kind: "bad_request" });
    await expect(findHistoryItem(KEY, { voiceId: LILY, requestId: "a b", sinceUnix: 1 })).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("follows the pages while there are more (at most five), from the last item each gave", async () => {
    let page = 0;
    mock(() => {
      page++;
      const items = Array.from({ length: 100 }, (_, i) => ({ history_item_id: `p${page}i${i}xx`, request_id: `r${page}i${i}xx`, voice_id: LILY }));
      if (page === 3) items[40] = { history_item_id: "found33", request_id: "reqDeep01", voice_id: LILY };
      return json(200, { history: items, has_more: true, last_history_item_id: `p${page}i99xx` });
    });
    expect(await findHistoryItem(KEY, { voiceId: LILY, requestId: "reqDeep01", sinceUnix: 1 })).toBe("found33");
    expect(calls.map((c) => new URL(c.url).searchParams.get("start_after_history_item_id"))).toEqual([null, "p1i99xx", "p2i99xx"]);
    calls = []; page = 0;
    expect(await findHistoryItem(KEY, { voiceId: LILY, requestId: "reqNowhere", sinceUnix: 1 })).toBeNull();
    expect(calls).toHaveLength(HISTORY_PAGES);
  });

  it("deletes an item; a missing one (404, or 400 invalid_id) is 'missing'; maps a key without History access", async () => {
    mock(() => json(200, { status: "ok" }));
    expect(await deleteHistoryItem(KEY, "ours22")).toBe("deleted");
    expect(calls[0].url).toBe(`${ELEVENLABS_API}/v1/history/ours22`);
    expect(calls[0].init.method).toBe("DELETE");
    mock(() => json(404, { detail: { status: "not_found" } }));
    expect(await deleteHistoryItem(KEY, "gone11")).toBe("missing");
    mock(() => json(400, { detail: { status: "invalid_id" } }));
    expect(await deleteHistoryItem(KEY, "gone11")).toBe("missing");
    mock(() => json(401, { detail: { status: "missing_permissions" } }));
    expect((await caught(deleteHistoryItem(KEY, "ours22"))).kind).toBe("missing_permissions");
    await expect(deleteHistoryItem(KEY, "../user")).rejects.toMatchObject({ kind: "bad_request" });
  });
});

describe("getSubscription (free)", () => {
  it("GETs the subscription with the key and reads used, limit, reset and tier", async () => {
    mock(() => json(200, { tier: "starter", character_count: 1234, character_limit: 38_373, next_character_count_reset_unix: 1_794_210_420, status: "active" }));
    expect(await getSubscription(KEY)).toEqual({ used: 1234, limit: 38_373, resetAt: new Date(1_794_210_420 * 1000).toISOString(), tier: "starter" });
    expect(calls[0].url).toBe(`${ELEVENLABS_API}/v1/user/subscription`);
    expect(calls[0].init.method).toBe("GET");
    expect(new Headers(calls[0].init.headers).get("xi-api-key")).toBe(KEY);
  });

  it("no reset date reads as null; a body without the numbers is upstream", async () => {
    mock(() => json(200, { character_count: 0, character_limit: 10_000, next_character_count_reset_unix: null }));
    expect((await getSubscription(KEY)).resetAt).toBeNull();
    mock(() => json(200, { tier: "free" }));
    expect(await caught(getSubscription(KEY))).toMatchObject({ kind: "upstream" });
    mock(() => new Response("<html>", { status: 200 }));
    expect(await caught(getSubscription(KEY))).toMatchObject({ kind: "upstream" });
  });

  it("maps a rejected key and missing permissions", async () => {
    mock(() => json(401, { detail: { status: "invalid_api_key" } }));
    expect(await caught(getSubscription(KEY))).toMatchObject({ kind: "key_rejected", status: 401 });
    mock(() => json(401, { detail: { status: "missing_permissions" } }));
    expect(await caught(getSubscription(KEY))).toMatchObject({ kind: "missing_permissions" });
  });

  it("times out after 5 seconds", async () => {
    vi.useFakeTimers();
    mock(hang);
    const p = caught(getSubscription(KEY));
    await vi.advanceTimersByTimeAsync(TIMEOUTS.subscription + 1);
    expect(await p).toMatchObject({ kind: "timeout" });
  });
});

describe("previews (free, public)", () => {
  it("allows ElevenLabs' public hosts only, over https", () => {
    expect(previewUrlAllowed("https://storage.googleapis.com/eleven-public-prod/premade/voices/x/y.mp3")).toBe(true);
    expect(previewUrlAllowed("https://api.us.elevenlabs.io/v1/voices/JBFqnCBsd6RMkjVDRZzb/previews/a.mp3")).toBe(true);
    expect(previewUrlAllowed("https://api.elevenlabs.io/v1/voices/x/previews/a.mp3")).toBe(true);
    expect(previewUrlAllowed("https://cdn.elevenlabs.io/a.mp3")).toBe(true);
    expect(previewUrlAllowed("http://storage.googleapis.com/eleven-public-prod/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://storage.googleapis.com/someone-else/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://elevenlabs.io.evil.test/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://evilelevenlabs.io/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://user:pw@api.elevenlabs.io/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://api.elevenlabs.io:8443/a.mp3")).toBe(false);
    expect(previewUrlAllowed("https://169.254.169.254/latest")).toBe(false);
    expect(previewUrlAllowed("not a url")).toBe(false);
  });

  it("sniffs MP3: an ID3 tag or a frame sync", () => {
    expect(looksLikeMp3(MP3)).toBe(true);
    expect(looksLikeMp3(FRAME)).toBe(true);
    expect(looksLikeMp3(new TextEncoder().encode("<html><body>"))).toBe(false);
    expect(looksLikeMp3(new Uint8Array([0xff]))).toBe(false);
  });

  it("fetches the bytes with no key, whatever type Google says", async () => {
    mock(() => new Response(stream(MP3), { status: 200, headers: { "content-type": "text/plain" } }));
    expect(await fetchPreview("https://storage.googleapis.com/eleven-public-prod/premade/voices/x/y.mp3")).toEqual(MP3);
    expect(new Headers(calls[0].init.headers).get("xi-api-key")).toBeNull();
    expect(calls[0].init.redirect).toBe("manual");
  });

  it("refuses a host outside the list (before any request), a redirect off it, too much, and not-MP3", async () => {
    mock(() => new Response(stream(MP3), { status: 200 }));
    expect(await caught(fetchPreview("https://example.test/a.mp3"))).toMatchObject({ kind: "bad_request" });
    expect(calls).toHaveLength(0);
    mock(() => new Response(null, { status: 302, headers: { location: "https://example.test/a.mp3" } }));
    expect(await caught(fetchPreview("https://api.us.elevenlabs.io/v1/voices/x/previews/a.mp3"))).toMatchObject({ kind: "bad_request" });
    mock(() => new Response(stream(MP3, new Uint8Array(1_000_001)), { status: 200 }));
    expect(await caught(fetchPreview("https://api.us.elevenlabs.io/v1/voices/x/previews/a.mp3"))).toMatchObject({ kind: "upstream" });
    mock(() => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    expect(await caught(fetchPreview("https://api.us.elevenlabs.io/v1/voices/x/previews/a.mp3"))).toMatchObject({ kind: "upstream" });
  });

  it("follows a redirect within the list", async () => {
    let n = 0;
    mock(() => (n++ === 0 ? new Response(null, { status: 302, headers: { location: "https://storage.googleapis.com/eleven-public-prod/a.mp3" } }) : new Response(stream(FRAME), { status: 200 })));
    expect(await fetchPreview("https://api.us.elevenlabs.io/v1/voices/x/previews/a.mp3")).toEqual(FRAME);
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.us.elevenlabs.io", "storage.googleapis.com"]);
  });

  it("looks a catalogue voice's preview up with the key (free), refusing other ids and other hosts", async () => {
    mock(() => json(200, { voice_id: LILY, preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/l/p.mp3" }));
    expect(await getVoicePreviewUrl(KEY, LILY)).toBe("https://storage.googleapis.com/eleven-public-prod/premade/voices/l/p.mp3");
    expect(calls[0].url).toBe(`${ELEVENLABS_API}/v1/voices/${LILY}`);
    expect(await caught(getVoicePreviewUrl(KEY, "../user/subscription"))).toMatchObject({ kind: "bad_request" });
    expect(calls).toHaveLength(1);
    mock(() => json(200, { preview_url: "https://example.test/x.mp3" }));
    expect(await caught(getVoicePreviewUrl(KEY, LILY))).toMatchObject({ kind: "upstream" });
  });
});

describe("in tests the default fetch refuses", () => {
  it("throws instead of reaching ElevenLabs when nothing is mocked", async () => {
    setElevenLabsFetchForTests(null);
    const real = vi.spyOn(globalThis, "fetch");
    for (const p of [
      streamSpeech({ apiKey: KEY, voiceId: LILY, text: "Hi.", speed: 1, signal: new AbortController().signal }),
      getSubscription(KEY),
      fetchPreview("https://storage.googleapis.com/eleven-public-prod/a.mp3"),
    ]) {
      const e = await caught(p);
      expect(e).not.toBeInstanceOf(ElevenLabsError);
      expect(e.message).toBe("ElevenLabs is not reachable from tests: mock it with setElevenLabsFetchForTests");
    }
    expect(real).not.toHaveBeenCalled();
  });
});
