/**
 * Her voice on the web (owner decision, 7 October 2026: her voice, personal assistants phase 2): the one voice on the
 * page. Every Listen button, the chat's auto-speak, the Settings sample and every face of hers go through this module,
 * so there is one utterance at a time, and every face talks while it plays.
 *
 * - On-device voices only: the browser's speech synthesis, with a voice whose `localService` is true (assistant-speech/
 *   voices). A network voice would send the reply to a third party's speech service, so one is never assigned; with no
 *   local voice `supported` is false and the voice controls hide. The voice and speed come from this device's choice
 *   (assistant-speech/prefs), else the best local voice for the page's language.
 * - What is said is `speakable(reply)` (assistant-speech/speakable), queued one sentence per utterance: Chrome cuts long
 *   utterances off, and sentence breaks give natural pauses. Every queued utterance is referenced until it ends (Chrome
 *   garbage-collects unreferenced ones and their end event never fires).
 * - It stops on Stop, on a new utterance, when a microphone on the page opens (she never talks over a recording or
 *   dictation; use-voice-recorder `subscribeMicrophone`), on pagehide and on a synthesis error. The chat stops it on
 *   typing, sending, New chat and leaving (components/app/brenda-chat).
 * - The level her faces follow is made up from word boundary events (assistant-speech/envelope), read once per animation
 *   frame while she speaks and handed to `subscribeLevel` listeners, then 0 once at the end.
 *
 * Browser quirks handled here: Chrome loads voices late (`voiceschanged`, which can fire again later; after 1.5 s with
 * no local voice `supported` is false until one appears); Chrome can drop a speak() in the same tick as cancel() (a
 * 60 ms gap); iOS Safari only speaks after it spoke inside a user gesture (`prime()`, a silent utterance); a blocked
 * start (no `start` event in 3 s) goes idle and says so (`blocked`); Chrome sometimes never sends the last `end` event (idle synthesiser for
 * half a second while she seems to speak ends it).
 *
 * Touches `window` only inside functions, so importing it while server rendering is safe. Not unit-tested itself (it
 * needs a browser); its pure parts are (tests/unit/assistant-speech.test.ts). `rehearse()` drives the faces with no
 * audio for the gallery (/dev/brenda) and for browsers with no voices.
 */
import { microphoneOpen, subscribeMicrophone, subscribeMicrophoneAsked } from "@/hooks/use-voice-recorder";
import { createEnvelope, type SpeechEnvelope } from "./envelope";
import { readVoicePrefs, SPEEDS } from "./prefs";
import { speakable } from "./speakable";
import { localVoices, normaliseLang, pickVoice, voiceKey, type LocalVoice } from "./voices";

export type SpeechSnapshot = {
  supported: boolean | null;
  /** From speak() until she stops: the Listen button shows Stop at once (the press registered). */
  speaking: boolean;
  /**
   * Only once the audio has started (the first `start` event; a rehearsal at once): her faces talk on this, not on
   * `speaking`, so they never hold a squint while the browser has not begun (review, 7 October 2026).
   */
  talking: boolean;
  id: string | null;
  /** The id of the last utterance the browser accepted but never started (no `start` in 3 s), until the next speak. */
  blocked: string | null;
  voices: readonly LocalVoice[];
};
export type SpeakOptions = {
  /** Who is speaking it (a reply's id, "sample"); Listen buttons compare against it. */
  id?: string;
  /** Default: this device's choice (readVoicePrefs().voiceURI); null is Automatic. */
  voiceURI?: string | null;
  /** Default: this device's speed (SPEEDS[readVoicePrefs().speed].rate). */
  rate?: number;
  /** true: speak the text as given (a sample); default false: speakable(text) first. */
  raw?: boolean;
};

const VOICES_WAIT_MS = 1500;
const START_WAIT_MS = 3000;
const AFTER_CANCEL_MS = 60;
const STALLED_MS = 500;

type Utterance = {
  id: string | null;
  env: SpeechEnvelope;
  /** Queued utterances not yet ended (kept referenced, see the header). */
  queue: SpeechSynthesisUtterance[];
  started: boolean;
  timers: ReturnType<typeof setTimeout>[];
  /** A silent rehearsal (no speech synthesis at all). */
  rehearsal: boolean;
  /** Since when the synthesiser has looked idle while this one seems to speak (Chrome's lost end event). */
  idleSince: number | null;
};

const SERVER: SpeechSnapshot = { supported: null, speaking: false, talking: false, id: null, blocked: null, voices: [] };
let snapshot: SpeechSnapshot = SERVER;
const listeners = new Set<() => void>();
const levelListeners = new Set<(level: number) => void>();
let current: Utterance | null = null;
let wired = false;
let voicesAsked = false;
let primed = false;
let looping = false;
/** voiceURI to the browser's own voice object (Chrome only accepts the real object on an utterance). */
const native = new Map<string, SpeechSynthesisVoice>();

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;
/** The length of the word starting at `i` (Safari's boundary events carry no charLength). */
const wordAt = (text: string, i: number) => /^[\p{L}\p{N}'’-]+/u.exec(text.slice(Math.max(0, i || 0)))?.[0].length ?? 5;

function set(patch: Partial<SpeechSnapshot>) {
  const next = { ...snapshot, ...patch };
  if (next.supported === snapshot.supported && next.speaking === snapshot.speaking && next.talking === snapshot.talking && next.id === snapshot.id
    && next.blocked === snapshot.blocked && next.voices === snapshot.voices) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function emit(level: number) {
  levelListeners.forEach((fn) => { try { fn(level); } catch { /* one face's error never stops the others */ } });
}

/**
 * The page's languages for Automatic, in order of preference: the browser's languages that the page is written in, then
 * the page's own (`<html lang>`). Her replies are in the page's language (British English), so a German browser still
 * gets an English voice rather than a German one reading English.
 */
export function pageLangs(): string[] {
  if (typeof navigator === "undefined" || typeof document === "undefined") return [];
  const page = document.documentElement.lang || "";
  const browser = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
  const base = normaliseLang(page).split("-")[0];
  const fitting = base ? browser.filter((l) => normaliseLang(l).split("-")[0] === base) : browser;
  return [...fitting, page].filter(Boolean);
}

/**
 * Stops on pagehide, when a recording asks for the microphone (before the browser's permission prompt, so she never
 * talks over it, and stops even if it is refused) and when one opens. Once per page.
 */
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("pagehide", () => stop());
  subscribeMicrophoneAsked(() => stop());
  subscribeMicrophone(() => { if (microphoneOpen()) stop(); });
}

/** Finds this device's voices (once per page; keeps listening, as Chrome reports them late and again on changes). */
function init() {
  if (typeof window === "undefined") return;
  wire();
  if (voicesAsked) return;
  voicesAsked = true;
  const s = synth();
  if (!s) { set({ supported: false }); return; }
  let waited = false;
  const read = () => {
    let all: SpeechSynthesisVoice[] = [];
    try { all = s.getVoices(); } catch { /* none */ }
    native.clear();
    for (const v of all) native.set(voiceKey(v), v);
    const voices = localVoices(all);
    const old = snapshot.voices;
    const same = voices.length === old.length && voices.every((v, i) => v.voiceURI === old[i].voiceURI && v.name === old[i].name && v.lang === old[i].lang && v.isDefault === old[i].isDefault);
    if (voices.length) set({ supported: true, voices: same ? old : voices });
    else if (waited || snapshot.supported === true) set({ supported: false, voices: [] });
  };
  if (typeof s.addEventListener === "function") s.addEventListener("voiceschanged", read);
  else s.onvoiceschanged = read;
  read();
  if (snapshot.supported === null) {
    setTimeout(() => { waited = true; if (snapshot.supported === null) set({ supported: false }); }, VOICES_WAIT_MS);
  }
}

/** Ends this utterance (if it is still the current one); `cancel` also silences the synthesiser. */
function end(me: Utterance, cancel: boolean) {
  if (current !== me) return;
  current = null;
  me.env.stop();
  me.timers.forEach(clearTimeout);
  me.queue = [];
  if (cancel && !me.rehearsal) { try { synth()?.cancel(); } catch { /* already silent */ } }
  set({ speaking: false, talking: false, id: null });
}

/** One queued sentence finished (or was cancelled from outside): the last one ends the utterance. */
function finished(me: Utterance, u: SpeechSynthesisUtterance) {
  if (current !== me) return;
  const at = me.queue.indexOf(u);
  if (at >= 0) me.queue.splice(at, 1);
  if (!me.queue.length) end(me, false);
}

function frame() {
  const me = current;
  if (me && !me.rehearsal && me.started) {
    const s = synth();
    const t = now();
    if (s && !s.speaking && !s.pending) {
      if (me.idleSince === null) me.idleSince = t;
      // Cancelled too: if the synthesiser only seemed idle (a slow engine between queued sentences), the rest of the
      // queue must not play on with nothing tracking it, where Stop and an opening microphone could not reach it.
      else if (t - me.idleSince > STALLED_MS) end(me, true);
    } else me.idleSince = null;
  }
  if (!current) { looping = false; emit(0); return; }
  emit(current.env.level(now()));
  requestAnimationFrame(frame);
}

function run() {
  if (looping || typeof requestAnimationFrame === "undefined") return;
  looping = true;
  requestAnimationFrame(frame);
}

/**
 * Stops her; with a prefix, only when what she is saying has an id starting with it (a chat stops only its own). With
 * no prefix it also silences the synthesiser when nothing is tracked but it still plays (audio that outlived its
 * utterance), so Stop, typing and an opening microphone always reach it.
 */
function stop(idPrefix?: string): void {
  const me = current;
  if (!me) {
    if (idPrefix !== undefined) return;
    const s = synth();
    if (s && (s.speaking || s.pending)) { try { s.cancel(); } catch { /* already silent */ } }
    return;
  }
  if (idPrefix !== undefined && !(me.id ?? "").startsWith(idPrefix)) return;
  end(me, true);
}

/** Says `text` (a reply: its speakable version) in this device's local voice. false when it cannot be said now. */
function speak(text: string, opts: SpeakOptions = {}): boolean {
  init();
  const s = synth();
  const busy = !!current || (!!s && (s.speaking || s.pending));
  stop();
  if (!s || snapshot.supported !== true || microphoneOpen()) return false;
  const said = opts.raw ? text.replace(/\s+/g, " ").trim() : speakable(text);
  if (!said) return false;
  const prefs = readVoicePrefs();
  const chosen = pickVoice(snapshot.voices, { voiceURI: opts.voiceURI !== undefined ? opts.voiceURI : prefs.voiceURI, langs: pageLangs() });
  const voice = chosen ? native.get(chosen.voiceURI) : undefined;
  if (!voice || voice.localService !== true) return false; // never a voice that sends the words away
  const rate = clamp(opts.rate ?? SPEEDS[prefs.speed].rate, 0.5, 2);
  const sentences = said.split(/(?<=[.!?…])\s+/).filter(Boolean);

  const me: Utterance = { id: opts.id ?? null, env: createEnvelope(), queue: [], started: false, timers: [], rehearsal: false, idleSince: null };
  current = me;
  set({ speaking: true, talking: false, id: me.id, blocked: null });
  const go = () => {
    if (current !== me) return;
    try {
      for (const sentence of sentences) {
        const u = new SpeechSynthesisUtterance(sentence);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = rate;
        u.onstart = () => {
          if (current !== me || me.started) return;
          me.started = true;
          me.env.start(now());
          set({ talking: true });
        };
        u.onboundary = (e) => { if (current === me) me.env.boundary(now(), e.charLength || wordAt(sentence, e.charIndex)); };
        u.onend = () => finished(me, u);
        // "interrupted" and "canceled" are a cancel, not a failure: that sentence is simply over.
        u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? finished(me, u) : end(me, true));
        me.queue.push(u);
        s.speak(u);
      }
    } catch { end(me, true); }
  };
  if (busy) {
    try { s.cancel(); } catch { /* already silent */ }
    me.timers.push(setTimeout(go, AFTER_CANCEL_MS));
  } else go();
  // No start event at all (the browser refused to speak without a gesture): idle again rather than a Stop that hangs.
  // It says so (`blocked`), so the Listen button or the sample can tell the person rather than go quiet with no word.
  me.timers.push(setTimeout(() => {
    if (current !== me || me.started) return;
    end(me, true);
    set({ blocked: me.id ?? "" });
  }, START_WAIT_MS + (busy ? AFTER_CANCEL_MS : 0)));
  run();
  return true;
}

/**
 * Call synchronously inside a user gesture (Send, Listen): iOS Safari only lets a page speak after it has spoken inside
 * one, so this speaks a silent space once, in a local voice (never a network one, not even for a space).
 */
function prime(): void {
  init();
  const s = synth();
  // Never with the microphone open (Send while dictating): on iOS Safari even a silent utterance can switch the audio
  // session in the middle of a recording.
  if (primed || current || !s || snapshot.supported !== true || microphoneOpen()) return;
  const local = pickVoice(snapshot.voices, { voiceURI: readVoicePrefs().voiceURI, langs: pageLangs() });
  const voice = local ? native.get(local.voiceURI) : undefined;
  if (!voice || voice.localService !== true) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.voice = voice;
    u.lang = voice.lang;
    u.volume = 0;
    s.speak(u);
    primed = true;
  } catch { /* the real speak will try anyway */ }
}

/** The current 0 to 1 level (0 when she is not speaking); cheap, call every frame. */
function level(): number {
  return current ? current.env.level(now()) : 0;
}

/** `fn` gets the level every animation frame while she speaks, then 0 once when she stops. */
function subscribeLevel(fn: (level: number) => void): () => void {
  levelListeners.add(fn);
  if (current) run();
  return () => { levelListeners.delete(fn); };
}

/** Dev and tests: "speaks" silently for `ms` with made-up syllables (no audio; works with no voices at all). */
function rehearse(ms: number, id?: string): void {
  wire();
  stop();
  const me: Utterance = { id: id ?? null, env: createEnvelope(), queue: [], started: true, timers: [], rehearsal: true, idleSince: null };
  me.env.start(now());
  current = me;
  me.timers.push(setTimeout(() => end(me, false), Math.max(0, ms)));
  set({ speaking: true, talking: true, id: me.id, blocked: null });
  run();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  init();
  return () => { listeners.delete(listener); };
}

export const speech = {
  /** The same object until something changes (useSyncExternalStore). */
  getSnapshot: (): SpeechSnapshot => snapshot,
  /** Nothing is known while server rendering (a constant). */
  getServerSnapshot: (): SpeechSnapshot => SERVER,
  subscribe,
  /** false when unsupported, the microphone is open, or nothing in it is speakable. */
  speak,
  stop,
  prime,
  level,
  subscribeLevel,
  rehearse,
};
