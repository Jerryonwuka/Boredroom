/**
 * The ElevenLabs client (owner decision, 9 October 2026: natural voice (ElevenLabs), contract B.5). Server only: the key
 * never leaves this process except in the `xi-api-key` header to api.elevenlabs.io, and the browser never talks to
 * ElevenLabs (or to Google's storage, where some previews live) at all.
 *
 * Four calls:
 * - `getSubscription`: GET /v1/user/subscription, free, for the caps (characters used of the month's allowance and when
 *   it resets) and to test a key in Settings;
 * - `getVoicePreviewUrl`: GET /v1/voices/{id}, free, for a voice's public preview MP3;
 * - `fetchPreview`: the preview MP3 itself, public (no key sent), from an allowlisted host only, checked to be MP3;
 * - `streamSpeech`: POST /v1/text-to-speech/{id}/stream, which COSTS the key's characters. Only the speech route calls
 *   it, after the speech token, the caps and a reservation (services/natural-voice).
 * - `findHistoryItem` and `deleteHistoryItem`: GET /v1/history and DELETE /v1/history/{id}, free. ElevenLabs keeps every
 *   generation, its words included, in the History of the account that owns the key (`enable_logging=false`, "zero
 *   retention mode", is for enterprise customers only: docs, 9 October 2026), so the key's holder (a workspace's owner or
 *   HR, or Boredroom) could read what everyone's assistant said. The speech route deletes each utterance from there once
 *   it has been said (review, 9 October 2026), and ONLY by an id ElevenLabs gave for that very request (its
 *   `history-item-id`, else the item whose `request_id` is the request's own `request-id`): never by matching words,
 *   which could delete the key holder's own generations (fix review, 9 October 2026).
 *
 * Model: `eleven_flash_v2_5` (~75 ms, half the price per character of the multilingual models; ElevenLabs' docs, 9
 * October 2026: Flash is recommended over Turbo, and v2.5 is not deprecated). Output: `mp3_44100_64`, small and plenty for
 * speech, allowed on every tier.
 *
 * Nothing in this file logs. Errors carry a status and a kind only, never the response body (it can echo the text) and
 * never the key. Under NODE_ENV=test the default fetch throws, so a test that forgot to mock (tests/setup.ts loads
 * .env.local, so ELEVENLABS_API_KEY is present there) can never spend the owner's allowance.
 */
import { isNaturalVoiceId } from "@/lib/natural-voices";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
/** ~75 ms, half the price per character of multilingual (docs, 9 Oct 2026). */
export const TTS_MODEL = "eleven_flash_v2_5";
/** Small, good enough for speech; every tier allows it. */
export const TTS_FORMAT = "mp3_44100_64";
/**
 * What one character of TTS_MODEL costs of the subscription's allowance (`character_count`/`character_limit` are
 * credits, not characters): Flash v2.5 is half the price per character (ElevenLabs' models page, 9 October 2026). The
 * one live Flash generation on Boredroom's key moved the counter by 6 for 28 characters, so 0.5 errs on the safe side:
 * the caps pace the allowance a little more slowly than it is really spent, never faster (fix review, 9 October 2026).
 */
export const TTS_CREDITS_PER_CHARACTER = 0.5;

export type ElevenLabsErrorKind = "key_rejected" | "missing_permissions" | "quota" | "busy" | "upstream" | "timeout" | "network" | "bad_request";

export class ElevenLabsError extends Error {
  readonly status: number;
  readonly kind: ElevenLabsErrorKind;
  constructor(kind: ElevenLabsErrorKind, status = 0) {
    // Fixed words: never the body, the text or the key.
    super(`ElevenLabs: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "ElevenLabsError";
    this.kind = kind;
    this.status = status;
  }
}

/** Timeouts (contract B.5). */
export const TIMEOUTS = { subscription: 5_000, voice: 5_000, preview: 8_000, speechHeaders: 10_000, speechWhole: 60_000 } as const;
/** A preview MP3 is ~28 KB; anything past this is not one. */
export const PREVIEW_MAX_BYTES = 1_000_000;

const TEST_MODE_MESSAGE = "ElevenLabs is not reachable from tests: mock it with setElevenLabsFetchForTests";
class TestModeError extends Error {}

let fetchForTests: typeof fetch | null = null;

/** Replaces fetch for this module (tests only); null restores the default. */
export function setElevenLabsFetchForTests(fn: typeof fetch | null): void {
  fetchForTests = fn;
}

function send(url: string, init: RequestInit): Promise<Response> {
  if (fetchForTests) return fetchForTests(url, init);
  if (process.env.NODE_ENV === "test") return Promise.reject(new TestModeError(TEST_MODE_MESSAGE));
  return fetch(url, init);
}

/**
 * One AbortController for a call: aborted by our timer (then `timedOut()` is true) or by the caller's signal (given now,
 * or later with `follow`). `clear()` stops the timer; `restart(ms)` starts a new one (the speech stream: headers first,
 * then the whole stream).
 */
function deadline(ms: number, outer?: AbortSignal) {
  const ctl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (t: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; ctl.abort(); }, t);
  };
  const onOuter = () => ctl.abort();
  const followed: AbortSignal[] = [];
  const follow = (signal?: AbortSignal) => {
    if (!signal) return;
    if (signal.aborted) { ctl.abort(); return; }
    signal.addEventListener("abort", onOuter, { once: true });
    followed.push(signal);
  };
  follow(outer);
  arm(ms);
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    restart: arm,
    /** From now on, `signal` aborts this call too. */
    follow,
    clear: () => { if (timer) clearTimeout(timer); timer = null; for (const s of followed.splice(0)) s.removeEventListener("abort", onOuter); },
    abort: () => ctl.abort(),
  };
}

/** A failed fetch as one of ours: our timer → timeout; the caller's abort is passed on as it is; anything else → network. */
function fromThrown(err: unknown, timedOut: boolean, outer?: AbortSignal): unknown {
  if (err instanceof ElevenLabsError || err instanceof TestModeError) return err;
  if (timedOut) return new ElevenLabsError("timeout");
  if (outer?.aborted) return abortError();
  return new ElevenLabsError("network");
}

function abortError(): Error {
  const e = new Error("The request was aborted.");
  e.name = "AbortError";
  return e;
}

/** True for the caller's own abort (the person pressed Stop, or went away), which is not ElevenLabs' failure. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Maps a non-2xx answer (contract B.5), reading only `detail.status` from a JSON body. */
export async function errorFromResponse(res: Response): Promise<ElevenLabsError> {
  let detail: string | null = null;
  try {
    const text = await readText(res, 16_384);
    const body = JSON.parse(text) as { detail?: unknown };
    const d = body?.detail;
    if (d && typeof d === "object" && !Array.isArray(d) && typeof (d as { status?: unknown }).status === "string") detail = (d as { status: string }).status;
  } catch { /* not JSON, or unreadable: the status code decides */ }
  const s = res.status;
  if (detail === "quota_exceeded") return new ElevenLabsError("quota", s);
  if ((s === 401 || s === 403) && detail === "missing_permissions") return new ElevenLabsError("missing_permissions", s);
  if (s === 401 || s === 403) return new ElevenLabsError("key_rejected", s);
  if (s === 429) return new ElevenLabsError("busy", s);
  if (s === 400 || s === 422) return new ElevenLabsError("bad_request", s);
  return new ElevenLabsError("upstream", s);
}

async function readText(res: Response, max: number): Promise<string> {
  return new TextDecoder().decode(await readCapped(res, max, () => new ElevenLabsError("upstream", res.status)));
}

async function readCapped(res: Response, max: number, tooBig: () => Error): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw tooBig(); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

async function getJson(path: string, apiKey: string, ms: number, outer?: AbortSignal): Promise<unknown> {
  const t = deadline(ms, outer);
  try {
    let res: Response;
    try {
      res = await send(`${ELEVENLABS_API}${path}`, { method: "GET", headers: { "xi-api-key": apiKey, accept: "application/json" }, signal: t.signal, cache: "no-store", redirect: "error" });
    } catch (err) { throw fromThrown(err, t.timedOut(), outer); }
    if (!res.ok) throw await errorFromResponse(res);
    let text: string;
    try { text = await readText(res, 1_000_000); } catch (err) { throw fromThrown(err, t.timedOut(), outer); }
    try { return JSON.parse(text); } catch { throw new ElevenLabsError("upstream", res.status); }
  } finally { t.clear(); }
}

export type Subscription = { used: number; limit: number; resetAt: string | null; tier: string | null };

/** GET /v1/user/subscription (free): characters used of this month's allowance, and when it resets. */
export async function getSubscription(apiKey: string, signal?: AbortSignal): Promise<Subscription> {
  const j = (await getJson("/v1/user/subscription", apiKey, TIMEOUTS.subscription, signal)) as Record<string, unknown> | null;
  const used = Number(j?.character_count);
  const limit = Number(j?.character_limit);
  if (!j || !Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit < 0) throw new ElevenLabsError("upstream", 200);
  const reset = Number(j.next_character_count_reset_unix);
  return {
    used: Math.floor(used),
    limit: Math.floor(limit),
    resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
    tier: typeof j.tier === "string" ? j.tier.slice(0, 40) : null,
  };
}

/** GET /v1/voices/{id} (free): the voice's public preview MP3. Catalogue ids only. */
export async function getVoicePreviewUrl(apiKey: string, voiceId: string): Promise<string> {
  if (!isNaturalVoiceId(voiceId)) throw new ElevenLabsError("bad_request");
  const j = (await getJson(`/v1/voices/${voiceId}`, apiKey, TIMEOUTS.voice)) as { preview_url?: unknown } | null;
  const url = j?.preview_url;
  if (typeof url !== "string" || !previewUrlAllowed(url)) throw new ElevenLabsError("upstream", 200);
  return url;
}

/**
 * Where a preview may come from (https only): ElevenLabs' public bucket on Google storage, and ElevenLabs' own hosts
 * (checked 9 October 2026: the premade voices' previews are on `storage.googleapis.com/eleven-public-prod/…` and
 * `api.us.elevenlabs.io/v1/voices/{id}/previews/…`, public, no key).
 */
export function previewUrlAllowed(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  if (host === "storage.googleapis.com") return u.pathname.startsWith("/eleven-public-prod/");
  return host === "api.elevenlabs.io" || host === "api.us.elevenlabs.io" || host.endsWith(".elevenlabs.io");
}

/** An MP3: an ID3 tag, or an MPEG audio frame sync (11 set bits). */
export function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}

/** A voice's public preview MP3 (no key sent; allowlisted hosts only, redirects included; at most 1 MB; MP3 only). */
export async function fetchPreview(url: string): Promise<Uint8Array> {
  const t = deadline(TIMEOUTS.preview);
  try {
    let at = url;
    for (let hop = 0; hop < 4; hop++) {
      if (!previewUrlAllowed(at)) throw new ElevenLabsError("bad_request");
      let res: Response;
      try {
        res = await send(at, { method: "GET", headers: { accept: "audio/mpeg" }, signal: t.signal, cache: "no-store", redirect: "manual", credentials: "omit" });
      } catch (err) { throw fromThrown(err, t.timedOut()); }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!next) throw new ElevenLabsError("upstream", res.status);
        at = new URL(next, at).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ElevenLabsError(res.status === 429 ? "busy" : "upstream", res.status);
      }
      let bytes: Uint8Array;
      try { bytes = await readCapped(res, PREVIEW_MAX_BYTES, () => new ElevenLabsError("upstream", res.status)); }
      catch (err) { throw fromThrown(err, t.timedOut()); }
      if (!looksLikeMp3(bytes)) throw new ElevenLabsError("upstream", res.status);
      return bytes;
    }
    throw new ElevenLabsError("upstream");
  } finally { t.clear(); }
}

/** ElevenLabs' range for voice_settings.speed. */
const clampSpeed = (s: number) => (Number.isFinite(s) ? Math.min(1.2, Math.max(0.7, s)) : 1);

/**
 * POST /v1/text-to-speech/{voiceId}/stream: the audio as it is made (MP3). COSTS the key's characters: only the speech
 * route calls it, after a reservation. Waits up to 10 seconds for the answer's headers, then gives the whole stream 60
 * seconds.
 *
 * `signal` (the request's own: the person stopped or went away) does NOT cut the request short before its headers: they
 * carry ElevenLabs' only ids for the generation (`history-item-id`, `request-id`), and without them it could never be
 * deleted from the key's History (fix review, 9 October 2026). So once sent, the request waits for its headers (still
 * within the 10 seconds); if `signal` was aborted meanwhile, the audio is cancelled at once, `onEnd` gets the ids, and
 * this throws an AbortError. After the headers, `signal` aborts the stream as it plays. The caller checks `signal`
 * before calling: nothing in here looks at it before the request is sent, so a request is never reserved and not sent
 * without the caller knowing (it refunds those).
 */
export async function streamSpeech(o: { apiKey: string; voiceId: string; text: string; speed: number; signal: AbortSignal; /** Once, when the stream is over (read to its end, failed, cancelled, or stopped before it started): ElevenLabs' ids for it, to delete it from the key's History. */ onEnd?: (ref: SpeechRef) => void }): Promise<ReadableStream<Uint8Array>> {
  // Never a client value straight into a URL: catalogue ids only.
  if (!isNaturalVoiceId(o.voiceId)) throw new ElevenLabsError("bad_request");
  if (typeof o.text !== "string" || !o.text.trim()) throw new ElevenLabsError("bad_request");
  // Our own timer only, until the headers (see above).
  const t = deadline(TIMEOUTS.speechHeaders);
  let res: Response;
  try {
    res = await send(`${ELEVENLABS_API}/v1/text-to-speech/${o.voiceId}/stream?output_format=${TTS_FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": o.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: o.text, model_id: TTS_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: clampSpeed(o.speed) } }),
      signal: t.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch (err) {
    t.clear();
    throw fromThrown(err, t.timedOut());
  }
  if (!res.ok || !res.body) {
    // The error's body is read under the same 10-second timer.
    try { throw res.ok ? new ElevenLabsError("upstream", res.status) : await errorFromResponse(res); }
    finally { t.clear(); }
  }
  const ref = speechRefOf(res.headers);
  let told = false;
  const over = () => { if (told) return; told = true; try { o.onEnd?.(ref); } catch { /* the caller's own trouble */ } };
  const reader = res.body.getReader();
  if (o.signal.aborted) {
    // Stopped while the headers were on their way: no audio for anyone, but its ids, so it can be deleted.
    t.clear();
    t.abort();
    await reader.cancel().catch(() => undefined);
    over();
    throw abortError();
  }
  // The headers are here: the whole stream now has 60 seconds, and the person's Stop cuts it short.
  t.restart(TIMEOUTS.speechWhole);
  t.follow(o.signal);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { t.clear(); controller.close(); over(); return; }
        controller.enqueue(value);
      } catch (err) {
        t.clear();
        controller.error(fromThrown(err, t.timedOut(), o.signal));
        over();
      }
    },
    async cancel() {
      t.clear();
      t.abort();
      await reader.cancel().catch(() => undefined);
      over();
    },
  });
}

// ---- History (free): what was said, deleted from the key's account ---------------------------------------------------------

/** ElevenLabs' ids for one generation, from its answer's headers (either may be missing). */
export type SpeechRef = { historyItemId: string | null; requestId: string | null };

const ID = /^[A-Za-z0-9_-]{6,80}$/;
const idOr = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

export function speechRefOf(h: Headers): SpeechRef {
  return { historyItemId: idOr(h.get("history-item-id")), requestId: idOr(h.get("request-id")) };
}

/** At most this many pages of 100 are read looking for one request's item. */
export const HISTORY_PAGES = 5;

/**
 * The History item ElevenLabs made for the request `requestId` (its `request-id` header) in `voiceId`, or null when it is
 * not there (yet). Only an item whose `request_id` is exactly that id and whose voice is that voice: never one matched
 * by its words, which could be the key holder's own (fix review, 9 October 2026). Reads this voice's text-to-speech items
 * since `sinceUnix`, newest first, following the pages while there are more (at most HISTORY_PAGES).
 */
export async function findHistoryItem(apiKey: string, o: { voiceId: string; requestId: string; sinceUnix: number }): Promise<string | null> {
  if (!isNaturalVoiceId(o.voiceId)) throw new ElevenLabsError("bad_request");
  const requestId = idOr(o.requestId);
  if (!requestId) throw new ElevenLabsError("bad_request");
  let after: string | null = null;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const q = new URLSearchParams({ page_size: "100", voice_id: o.voiceId, source: "TTS", date_after_unix: String(Math.max(0, Math.floor(o.sinceUnix))) });
    if (after) q.set("start_after_history_item_id", after);
    const j = (await getJson(`/v1/history?${q}`, apiKey, TIMEOUTS.voice)) as { history?: unknown; has_more?: unknown; last_history_item_id?: unknown } | null;
    const items = Array.isArray(j?.history) ? (j.history as (Record<string, unknown> | null)[]) : [];
    const hit = items.find((i) => !!i && i.request_id === requestId && i.voice_id === o.voiceId);
    if (hit) return idOr(hit.history_item_id);
    const next = idOr(j?.last_history_item_id);
    if (j?.has_more !== true || !next || next === after || !items.length) return null;
    after = next;
  }
  return null;
}

/**
 * DELETE /v1/history/{id}: the item, its words and its audio, gone from the key's account. "missing" when ElevenLabs
 * does not know the id (404, or 400 `invalid_id`): not there yet, or already deleted.
 */
export async function deleteHistoryItem(apiKey: string, historyItemId: string): Promise<"deleted" | "missing"> {
  const id = idOr(historyItemId);
  if (!id) throw new ElevenLabsError("bad_request");
  const t = deadline(TIMEOUTS.voice);
  try {
    let res: Response;
    try {
      res = await send(`${ELEVENLABS_API}/v1/history/${id}`, { method: "DELETE", headers: { "xi-api-key": apiKey, accept: "application/json" }, signal: t.signal, cache: "no-store", redirect: "error" });
    } catch (err) { throw fromThrown(err, t.timedOut()); }
    if (res.ok) { await res.body?.cancel().catch(() => undefined); return "deleted"; }
    if (res.status === 404) { await res.body?.cancel().catch(() => undefined); return "missing"; }
    const err = await errorFromResponse(res);
    if (err.kind === "bad_request") return "missing";
    throw err;
  } finally { t.clear(); }
}
