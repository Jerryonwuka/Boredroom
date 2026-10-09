/**
 * The natural voice's player on the web (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F.1). Only
 * the speech controller (assistant-speech/controller) uses it, so there is still one voice on the page.
 *
 * - One audio element for the page, reused for every utterance and sample (iOS Safari and Safari only let a page play
 *   without a press on an element that has played inside one: `primeNatural()`, called inside Send, Listen or a sample's
 *   press, plays a 50 ms silent WAV made in memory on it once). One page-wide AudioContext, made lazily, and the element
 *   routed `createMediaElementSource → AnalyserNode (fftSize 1024) → destination` once the context runs (an element can
 *   only be connected once, and a suspended context would play it silently), so the controller can measure the real audio
 *   (`rms()`) for her faces. If Web Audio cannot run, the element plays on its own and `rms()` is null: the controller
 *   makes the level up instead.
 * - Speech: POST the reply's offer (`{ token, text, speed }`) to our own speech route, same origin only (the path is
 *   checked; the browser never talks to ElevenLabs). The answer streams into a MediaSource (ManagedMediaSource on iOS)
 *   where `audio/mpeg` is supported, so she starts talking as the first bytes arrive; elsewhere it is read whole into a
 *   Blob. Both are `blob:` URLs, which the CSP's `media-src 'self' blob:` allows. Samples: the element plays our own
 *   sample route's URL (`media-src 'self'`).
 * - Failures before any audio say why (`onFailed`: the server's `details.reason` on a refusal, "upstream" when our server
 *   gave no headers within 15 s, null for this browser's own trouble: no network, `play()` refused, a media or decode
 *   error, no `playing` within 4 s of the audio being handed over), so the controller can fall back to the computer voice
 *   at once. A failure after the audio began ends it (`onEnded`; what was heard stands).
 * - `stop()` aborts the request, cancels the stream, pauses and empties the element, ends the MediaSource and revokes
 *   its URL; no event comes after it. Nothing is stored on disk or on the server.
 * - Listen again (review, 9 October 2026): each utterance heard to its end stays in this page's memory (the last
 *   REPLAY_KEEP, keyed by the offer's token), so a second Listen on the same reply plays it from here and does not spend
 *   the workspace's characters again. Gone when the page goes.
 * - The AudioContext (review, 9 October 2026): made or resumed inside a press only once this page has a natural voice to
 *   play (`primeNatural(true)`, or after one played), and suspended IDLE_MS after each natural utterance or sample, so a
 *   page on the computer voice keeps no audio thread running (as the chimes in lib/brenda-sound do).
 *
 * Touches `window` only inside functions, so importing it while server rendering is safe. Unit-tested through the
 * controller with stubbed browser objects (tests/unit/assistant-speech-natural.test.ts).
 */
import { rmsLevel } from "./level";
import { SPEECH_SPEEDS, type NaturalVoiceReason, type SpeechOffer, type SpeechSpeed } from "@/lib/natural-voices";

export type NaturalEvents = {
  /** The audio began (the element's `playing`). */
  onPlaying(): void;
  /** It played to the end, or stopped for good after it began. */
  onEnded(): void;
  /** It failed before any audio: why (see the header), so the computer voice can say it instead. */
  onFailed(reason: NaturalVoiceReason | null): void;
};

export type NaturalPlayback = {
  /** Stops it and lets go of everything it held; no event comes after. */
  stop(): void;
  /** This frame's loudness (0 to 1) from the analyser, or null when the audio does not go through Web Audio. */
  rms(): number | null;
};

/**
 * No response headers from our speech route within this: fall back. 15 s (review, 9 October 2026: the natural voice's
 * latency on a slow link): over a phone's hotspot the route took more than 6 s, so every Listen fell back while the
 * audio was on its way. The route itself gives ElevenLabs 10 s for its headers and answers 502 (the characters given
 * back) when that passes, so this only covers a link that is slower still. Meanwhile her face shows she is getting ready
 * (speaking, not yet talking), Stop aborts the request at once, and a refusal (409, 429, 502) still falls back the moment
 * it arrives.
 */
export const HEADERS_MS = 15_000;
/** No `playing` within this of the audio being handed to the element: fall back. */
export const PLAYING_MS = 4000;
/** A sample's first play fetches the preview from ElevenLabs on the server: a little longer. */
export const SAMPLE_PLAYING_MS = 10000;
/** Reading a whole reply (no MediaSource) takes at most this. */
export const BODY_MS = 15000;
/** No utterance is longer than this (the server stops a stream at 60 s). */
export const MAX_MS = 120000;
/** How long a suspended AudioContext gets to resume before playing. */
const RESUME_MS = 300;
/** The context is suspended this long after the last natural utterance or sample (lib/brenda-sound's chimes do the same). */
export const IDLE_MS = 1800;
/** Utterances kept in memory for Listen again, and the most bytes they may hold together. */
export const REPLAY_KEEP = 4;
const REPLAY_MAX_BYTES = 4_000_000;

const SPEECH_PATH = /^\/api\/orgs\/[^/?#\s]+\/assistant\/speech$/;
const SAMPLE_PATH = /^\/api\/orgs\/[^/?#\s]+\/assistant\/voice\/samples\/[A-Za-z0-9]{16,40}$/;
const REASONS: ReadonlySet<string> = new Set(["not_ready", "no_voice", "voice_off", "no_key", "key_rejected", "person_cap", "workspace_cap", "shared_cap", "allowance_low", "upstream"]);

/** Our own speech route (never anywhere else). */
export const isSpeechPath = (p: unknown): p is string => typeof p === "string" && SPEECH_PATH.test(p);
/** Our own sample route for a voice. */
export const isSamplePath = (p: unknown): p is string => typeof p === "string" && SAMPLE_PATH.test(p);
/** A reply's offer, if it is one this page may play. */
export function usableOffer(o: SpeechOffer | null | undefined): SpeechOffer | null {
  return o && isSpeechPath(o.path) && typeof o.token === "string" && o.token.length > 0 && typeof o.text === "string" && o.text.trim() ? o : null;
}

type MediaSourceCtor = { new (): MediaSource; isTypeSupported(type: string): boolean };
type BrowserBits = {
  Audio?: { new (): HTMLAudioElement };
  AudioContext?: { new (): AudioContext };
  webkitAudioContext?: { new (): AudioContext };
  MediaSource?: MediaSourceCtor;
  ManagedMediaSource?: MediaSourceCtor;
};
const bits = (): BrowserBits | null => (typeof window === "undefined" ? null : (window as unknown as BrowserBits));

type Run = {
  done: boolean;
  started: boolean;
  ev: NaturalEvents;
  /** Removes this run's listeners on the element and the MediaSource. */
  listeners: AbortController;
  timers: ReturnType<typeof setTimeout>[];
  /** Undone first on stop: the request, the stream, the MediaSource. */
  cleanups: (() => void)[];
  /** blob: URLs to revoke once the element has let go of them. */
  urls: string[];
  /** What this run put on the element (so a later run's src is never cleared). */
  src: string | null;
};

let el: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
/** The element goes through the AudioContext (for good: an element is connected once). */
let routed = false;
/** Routing failed once: the element plays on its own from now on. */
let unroutable = false;
let unlocked = false;
let silentUrl: string | null = null;
let active: Run | null = null;
/** This page has (had) a natural voice to play: the context is made inside presses from now on. */
let wanted = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Heard utterances, by their offer's token (oldest first), for Listen again. */
const replays = new Map<string, Blob>();

function keepReplay(token: string, blob: Blob): void {
  if (!token || !(blob.size > 0) || blob.size > REPLAY_MAX_BYTES) return;
  replays.delete(token);
  replays.set(token, blob);
  let total = 0;
  for (const b of replays.values()) total += b.size;
  for (const [k, b] of replays) {
    if (replays.size <= REPLAY_KEEP && total <= REPLAY_MAX_BYTES) break;
    replays.delete(k); total -= b.size;
  }
}

/** Puts the context to sleep a moment after the last natural sound, unless something plays by then. */
function idleSoon(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (active || !ctx || ctx.state !== "running") return;
    try { void Promise.resolve(ctx.suspend()).catch(() => undefined); } catch { /* resumed at play time */ }
  }, IDLE_MS);
}
const stayAwake = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };

/** Forgets the heard utterances and the "wanted" mark (tests only). */
export function resetNaturalForTests(): void {
  replays.clear();
  wanted = false;
  stayAwake();
}

/** Whether this browser can play a natural voice at all (an audio element and fetch). */
export function naturalAvailable(): boolean {
  const w = bits();
  return !!w && typeof w.Audio === "function" && typeof fetch === "function";
}

function element(): HTMLAudioElement | null {
  if (el) return el;
  const w = bits();
  if (!w?.Audio) return null;
  try {
    el = new w.Audio();
    el.preload = "auto";
  } catch { el = null; }
  return el;
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  const w = bits();
  const Ctor = w?.AudioContext ?? w?.webkitAudioContext;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

/** Routes the element through the analyser, once, and only while the context runs (see the header). */
function route(): void {
  if (routed || unroutable || !ctx || ctx.state !== "running" || !el) return;
  try {
    const source = ctx.createMediaElementSource(el);
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    source.connect(a);
    a.connect(ctx.destination);
    analyser = a;
    samples = new Float32Array(a.fftSize);
    routed = true;
  } catch { unroutable = true; }
}

/**
 * Gets Web Audio ready to play: resumes the context (briefly), then routes the element if it can. false only when the
 * element is already routed through a context that will not run: it would play silently, so the caller falls back.
 */
async function settle(): Promise<boolean> {
  wanted = true;
  stayAwake();
  const c = context();
  if (c && c.state !== "running") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.resolve().then(() => c.resume()).catch(() => undefined),
      new Promise<void>((r) => { timer = setTimeout(r, RESUME_MS); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  if (c?.state === "running") route();
  return !routed || ctx?.state === "running";
}

function measure(): number | null {
  if (!routed || !analyser || !samples) return null;
  try {
    analyser.getFloatTimeDomainData(samples);
    return rmsLevel(samples);
  } catch { return null; }
}

/** A 50 ms silent mono WAV (16-bit PCM at 8 kHz), for unlocking the element inside a press. */
export function silentWav(ms = 50, rate = 8000): Uint8Array<ArrayBuffer> {
  const count = Math.max(1, Math.round((rate * ms) / 1000));
  const data = count * 2;
  const bytes = new Uint8Array(44 + data);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, "RIFF"); v.setUint32(4, 36 + data, true); text(8, "WAVE");
  text(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, "data"); v.setUint32(40, data, true);
  return bytes;
}

/**
 * Call synchronously inside a press (Send, Listen, a sample): once per page, plays the silent WAV on the element so later
 * `play()` calls are allowed without a press (iOS Safari, Safari); and, when a natural voice may play (`natural`: the
 * press is for one, or one played on this page already), makes or resumes the AudioContext, which goes back to sleep
 * IDLE_MS later if nothing plays. A page on the computer voice never starts one.
 */
export function primeNatural(natural = false): void {
  if (!naturalAvailable()) return;
  if (natural) wanted = true;
  const c = wanted ? context() : null;
  if (c && c.state !== "running") { try { void c.resume().catch(() => undefined); } catch { /* resumed at play time */ } }
  if (c && !active) idleSoon();
  if (unlocked || active) return;
  const a = element();
  if (!a) return;
  try { silentUrl ??= URL.createObjectURL(new Blob([silentWav()], { type: "audio/wav" })); } catch { return; }
  const url = silentUrl;
  unlocked = true;
  // Only ever clears its own silent clip: a reply that started meanwhile keeps the element.
  const clear = () => { if (!active && a.getAttribute("src") === url) { a.removeAttribute("src"); try { a.load(); } catch { /* emptied */ } } };
  try {
    a.src = url;
    const p = a.play();
    if (p && typeof p.then === "function") p.then(() => { setTimeout(clear, 100); }, () => { unlocked = false; clear(); });
  } catch { unlocked = false; clear(); }
}

// ---- one run ----------------------------------------------------------------------------------------------------

function begin(ev: NaturalEvents): Run {
  if (active) halt(active);
  const run: Run = { done: false, started: false, ev, listeners: new AbortController(), timers: [], cleanups: [], urls: [], src: null };
  active = run;
  run.timers.push(setTimeout(() => (run.started ? ended(run) : failed(run, null)), MAX_MS));
  return run;
}

/** Lets go of everything the run holds: request, stream, MediaSource, then the element, then its URLs. */
function release(run: Run): void {
  run.done = true;
  if (active === run) { active = null; idleSoon(); }
  run.timers.forEach(clearTimeout);
  run.timers = [];
  run.listeners.abort();
  for (const fn of run.cleanups.splice(0)) { try { fn(); } catch { /* already gone */ } }
  if (el && run.src !== null && el.getAttribute("src") === run.src) {
    try { el.pause(); } catch { /* not playing */ }
    el.removeAttribute("src");
    try { el.load(); } catch { /* emptied */ }
  }
  for (const url of run.urls.splice(0)) { try { URL.revokeObjectURL(url); } catch { /* gone */ } }
}

/** Clears one of the run's timers once what it waited for came (review, 9 October 2026: a waiting timer left running cut a reply that was playing). */
function cancelTimer(run: Run, timer: ReturnType<typeof setTimeout>): void {
  clearTimeout(timer);
  run.timers = run.timers.filter((t) => t !== timer);
}

function halt(run: Run): void { if (!run.done) release(run); }
function ended(run: Run): void {
  if (run.done) return;
  release(run);
  run.ev.onEnded();
}
function failed(run: Run, reason: NaturalVoiceReason | null): void {
  if (run.done) return;
  if (run.started) { ended(run); return; }
  release(run);
  run.ev.onFailed(reason);
}

function handle(run: Run): NaturalPlayback {
  return { stop: () => halt(run), rms: () => (active === run && run.started ? measure() : null) };
}

/** Hands `url` to the element and plays it, following its events for this run. */
function play(run: Run, url: string, waitMs: number): void {
  const a = element();
  if (!a || run.done) { failed(run, null); return; }
  const on = { signal: run.listeners.signal };
  a.addEventListener("playing", () => {
    if (run.done || run.started) return;
    run.started = true;
    run.ev.onPlaying();
  }, on);
  a.addEventListener("ended", () => ended(run), on);
  // Paused by something else once playing (the keyboard's media keys, the system): over, never a hanging Stop.
  a.addEventListener("pause", () => { if (run.started && !a.ended) ended(run); }, on);
  a.addEventListener("error", () => failed(run, null), on);
  run.src = url;
  a.src = url;
  run.timers.push(setTimeout(() => { if (!run.started) failed(run, null); }, waitMs));
  try {
    const p = a.play();
    // AbortError is our own stop (or the next run) taking the element: nothing to do.
    if (p && typeof p.then === "function") p.catch((e: unknown) => { if ((e as { name?: string })?.name !== "AbortError") failed(run, null); });
  } catch { failed(run, null); }
}

function mediaSource(): { Ctor: MediaSourceCtor; managed: boolean } | null {
  const w = bits();
  if (!w) return null;
  const options: [MediaSourceCtor | undefined, boolean][] = [[w.MediaSource, false], [w.ManagedMediaSource, true]];
  for (const [Ctor, managed] of options) {
    try { if (Ctor && typeof Ctor.isTypeSupported === "function" && Ctor.isTypeSupported("audio/mpeg")) return { Ctor, managed }; } catch { /* not this one */ }
  }
  return null;
}

/** Appends one chunk and waits for the buffer to take it. */
function append(sb: SourceBuffer, chunk: Uint8Array<ArrayBuffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { sb.removeEventListener("updateend", done); sb.removeEventListener("error", bad); resolve(); };
    const bad = () => { sb.removeEventListener("updateend", done); sb.removeEventListener("error", bad); reject(new Error("append")); };
    sb.addEventListener("updateend", done);
    sb.addEventListener("error", bad);
    try { sb.appendBuffer(chunk); } catch (e) { sb.removeEventListener("updateend", done); sb.removeEventListener("error", bad); reject(e); }
  });
}

/** Streams the answer into a MediaSource on the element: she starts as the first bytes arrive. */
function stream(run: Run, body: ReadableStream<Uint8Array<ArrayBuffer>>, { Ctor, managed }: { Ctor: MediaSourceCtor; managed: boolean }, token: string): void {
  let ms: MediaSource;
  let url: string;
  try {
    ms = new Ctor();
    url = URL.createObjectURL(ms);
  } catch { failed(run, null); return; }
  run.urls.push(url);
  const reader = body.getReader();
  run.cleanups.push(() => { void reader.cancel().catch(() => undefined); });
  run.cleanups.push(() => { if (ms.readyState === "open") ms.endOfStream(); });
  // ManagedMediaSource (iOS) only opens on an element that offers no AirPlay of it.
  if (managed && el) { try { el.disableRemotePlayback = true; } catch { /* older Safari */ } }
  const pump = async () => {
    let sb: SourceBuffer;
    try { sb = ms.addSourceBuffer("audio/mpeg"); } catch { failed(run, null); return; }
    // What arrives, kept for Listen again once the whole utterance is here (never a part of one).
    const got: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (run.done) return;
        if (done) break;
        if (value?.byteLength) {
          size += value.byteLength;
          if (size <= REPLAY_MAX_BYTES) got.push(value);
          await append(sb, value);
        }
        if (run.done) return;
      }
    } catch {
      if (run.done) return;
      // Cut off before a sound: the computer voice says it. After: what arrived plays to its end.
      if (!run.started) { failed(run, "upstream"); return; }
      size = Infinity; // not whole: not kept
    }
    if (size <= REPLAY_MAX_BYTES) { try { keepReplay(token, new Blob(got, { type: "audio/mpeg" })); } catch { /* not kept */ } }
    try { if (ms.readyState === "open" && !sb.updating) ms.endOfStream(); } catch { /* closed */ }
  };
  ms.addEventListener("sourceopen", () => { void pump(); }, { once: true, signal: run.listeners.signal });
  play(run, url, PLAYING_MS);
}

/** Reads the whole answer, then plays it (no MediaSource for mp3 in this browser). */
async function whole(run: Run, res: Response, token: string): Promise<void> {
  const bodyTimer = setTimeout(() => failed(run, "upstream"), BODY_MS);
  run.timers.push(bodyTimer);
  let bytes: ArrayBuffer;
  try { bytes = await res.arrayBuffer(); } catch { failed(run, null); return; }
  if (run.done) return;
  // The whole body is here: from now on PLAYING_MS and MAX_MS watch it, not this (it would cut a reply still playing).
  cancelTimer(run, bodyTimer);
  let blob: Blob;
  try { blob = new Blob([bytes], { type: "audio/mpeg" }); } catch { failed(run, null); return; }
  keepReplay(token, blob);
  playBlob(run, blob);
}

/** Plays audio held in memory (a whole answer, or one heard before) from a blob: URL. */
function playBlob(run: Run, blob: Blob): void {
  let url: string;
  try { url = URL.createObjectURL(blob); } catch { failed(run, null); return; }
  run.urls.push(url);
  play(run, url, PLAYING_MS);
}

/** Why our route refused: its `details.reason` when it is one of ours, else null. */
async function reasonOf(res: Response): Promise<NaturalVoiceReason | null> {
  try {
    const data = (await res.json()) as { details?: { reason?: unknown } } | null;
    const r = data?.details?.reason;
    return typeof r === "string" && REASONS.has(r) ? (r as NaturalVoiceReason) : null;
  } catch { return null; }
}

/** Says a reply's offer in the person's natural voice (see the header). Events come later, never during this call. */
export function playNaturalSpeech(offer: SpeechOffer, speed: SpeechSpeed, ev: NaturalEvents): NaturalPlayback {
  const run = begin(ev);
  const ok = usableOffer(offer);
  if (!ok || !naturalAvailable() || !element()) {
    queueMicrotask(() => failed(run, null));
    return handle(run);
  }
  // Heard before on this page (at this speed): played from memory, without asking (or paying) again.
  const replayKey = `${ok.token}\n${speed}`;
  const kept = replays.get(replayKey);
  if (kept) {
    void (async () => {
      const ready = await settle();
      if (run.done) return;
      if (!ready) { failed(run, null); return; }
      playBlob(run, kept);
    })();
    return handle(run);
  }
  const request = new AbortController();
  run.cleanups.push(() => request.abort());
  let late = false;
  const headersTimer = setTimeout(() => { late = true; request.abort(); failed(run, "upstream"); }, HEADERS_MS);
  run.timers.push(headersTimer);
  const ready = settle(); // resumes the context while the request is on its way
  const body = JSON.stringify({ token: ok.token, text: ok.text, speed: Object.prototype.hasOwnProperty.call(SPEECH_SPEEDS, speed) ? speed : "normal" });
  void (async () => {
    let res: Response;
    try {
      res = await fetch(ok.path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", accept: "audio/mpeg" }, body, signal: request.signal });
    } catch {
      if (!late) failed(run, null);
      return;
    }
    // The headers came: this wait is over. Left running, it cut every reply still playing 15 s after Listen (its
    // characters reserved and billed, and not kept for Listen again: review, 9 October 2026). PLAYING_MS, BODY_MS and
    // MAX_MS watch what follows.
    cancelTimer(run, headersTimer);
    if (run.done) { void res.body?.cancel().catch(() => undefined); return; }
    if (!res.ok) { failed(run, await reasonOf(res)); return; }
    if (!(await ready)) { void res.body?.cancel().catch(() => undefined); failed(run, null); return; }
    if (run.done) return;
    const ms = res.body ? mediaSource() : null;
    if (ms && res.body) stream(run, res.body as ReadableStream<Uint8Array<ArrayBuffer>>, ms, replayKey);
    else await whole(run, res, replayKey);
  })();
  return handle(run);
}

/** Plays a voice's sample from our own sample route (it costs no characters). Events come later. */
export function playNaturalSample(path: string, ev: NaturalEvents): NaturalPlayback {
  const run = begin(ev);
  if (!isSamplePath(path) || !naturalAvailable() || !element()) {
    queueMicrotask(() => failed(run, null));
    return handle(run);
  }
  void (async () => {
    const ok = await settle();
    if (run.done) return;
    if (!ok) { failed(run, null); return; }
    play(run, path, SAMPLE_PLAYING_MS);
  })();
  return handle(run);
}

/** Stops whatever the element is playing, tracked or not (the controller's Stop with nothing tracked). */
export function haltNatural(): void {
  if (active) { halt(active); return; }
  if (el && !el.paused && el.getAttribute("src") !== silentUrl) { try { el.pause(); } catch { /* not playing */ } }
}
