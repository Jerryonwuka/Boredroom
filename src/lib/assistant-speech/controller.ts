/**
 * Her voice on the web (owner decision, 7 October 2026: her voice, personal assistants phase 2): the one voice on the
 * page. Every Listen button, the chat's auto-speak, the Settings sample and every face of hers go through this module,
 * so there is one utterance at a time, and every face talks while it plays.
 *
 * - Only her ElevenLabs voice speaks (owner request, 27 October 2026: "I want everything to be ElevenLabs voice and no
 *   local voice at all"). The browser's own speech synthesis is never used to say anything: the computer voice used to
 *   say replies with no offer and stand in when the natural voice failed, so her voice alternated. A reply without an
 *   offer this page can play is not said (`speak` answers false); a natural voice that fails before a sound ends quietly
 *   as `blocked`, its reason kept in `naturalFailed`, and the words stay on the page. (`supported` and `voices` still
 *   report this device's voices for older callers; nothing speaks with them.)
 * - It stops on Stop, on a new utterance, when a microphone on the page opens (she never talks over a recording or
 *   dictation; use-voice-recorder `subscribeMicrophone`) and on pagehide. The chat stops it on typing, sending, New chat
 *   and leaving (components/app/brenda-chat).
 *
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F.1). Each reply carries an offer
 * (`speech`: our own route, a short-lived token bound to the person and to these words, and the words);
 * `speak(text, { natural: offer })` plays it through the natural player (assistant-speech/natural). Listen shows Stop at
 * once, `talking` comes with the audio's `playing`, Stop and everything that stops her stop it (the request is aborted
 * and nothing is kept), it never plays while a microphone is open, and her faces follow the level measured from the real
 * audio each frame (assistant-speech/level) through `subscribeLevel` (made up from the envelope where the audio does not
 * go through Web Audio). `playSample()` plays a natural voice's sample the same way.
 *
 * Touches `window` only inside functions, so importing it while server rendering is safe. The on-device path needs a
 * browser and is not unit-tested itself (its pure parts are: tests/unit/assistant-speech.test.ts); the natural path and
 * its quiet failure are, with stubbed browser objects (tests/unit/assistant-speech-natural.test.ts). `rehearse()` drives the
 * faces with no audio for the gallery (/dev/brenda) and for browsers with no voices.
 */
import { microphoneOpen, subscribeMicrophone, subscribeMicrophoneAsked } from "@/hooks/use-voice-recorder";
import type { NaturalVoiceReason, SpeechOffer } from "@/lib/natural-voices";
import { createEnvelope, type SpeechEnvelope } from "./envelope";
import { LEVEL_FLOOR, speakingLevel } from "./level";
import { haltNatural, isSamplePath, naturalAvailable, playNaturalSample, playNaturalSpeech, primeNatural, usableOffer, type NaturalPlayback } from "./natural";
import { readVoicePrefs, type VoiceSpeed } from "./prefs";
import { localVoices, normaliseLang, voiceKey, type LocalVoice } from "./voices";

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
  /**
   * Why the last natural utterance fell back to the computer voice (the server's reason; "upstream" when it did not
   * answer in time), or null: it played, none was tried yet, or the browser itself could not play it.
   */
  naturalFailed: NaturalVoiceReason | null;
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
  /** The reply's natural voice offer (contract F.1): played in the person's natural voice, else the computer voice. */
  natural?: SpeechOffer | null;
  /** The natural voice's speed. Default: this device's speed (readVoicePrefs().speed). */
  speed?: VoiceSpeed;
};

const VOICES_WAIT_MS = 1500;
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
  /**
   * A natural voice (or a natural sample) while it plays: its playback and the level measured from it; null for the
   * computer voice and rehearsals (a fallback turns it to null and goes on with the computer voice).
   */
  natural: { playback: NaturalPlayback | null; level: number; at: number; real: boolean } | null;
};

const SERVER: SpeechSnapshot = { supported: null, speaking: false, talking: false, id: null, blocked: null, voices: [], naturalFailed: null };
let snapshot: SpeechSnapshot = SERVER;
const listeners = new Set<() => void>();
const levelListeners = new Set<(level: number) => void>();
let current: Utterance | null = null;
let wired = false;
let voicesAsked = false;
let looping = false;
/** voiceURI to the browser's own voice object (Chrome only accepts the real object on an utterance). */
const native = new Map<string, SpeechSynthesisVoice>();

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null;

function set(patch: Partial<SpeechSnapshot>) {
  const next = { ...snapshot, ...patch };
  if (next.supported === snapshot.supported && next.speaking === snapshot.speaking && next.talking === snapshot.talking && next.id === snapshot.id
    && next.blocked === snapshot.blocked && next.voices === snapshot.voices && next.naturalFailed === snapshot.naturalFailed) return;
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

const utterance = (id: string | undefined, natural = false): Utterance => ({
  id: id ?? null, env: createEnvelope(), queue: [], started: false, timers: [], rehearsal: false, idleSince: null,
  natural: natural ? { playback: null, level: LEVEL_FLOOR, at: now(), real: false } : null,
});

/**
 * Ends this utterance (if it is still the current one); `cancel` also silences the synthesiser. A natural one's
 * playback is always let go of (its request aborted, its element emptied, its URL revoked).
 */
function end(me: Utterance, cancel: boolean) {
  if (current !== me) return;
  current = null;
  me.env.stop();
  me.timers.forEach(clearTimeout);
  me.queue = [];
  if (me.natural) { me.natural.playback?.stop(); me.natural = null; }
  else if (cancel && !me.rehearsal) { try { synth()?.cancel(); } catch { /* already silent */ } }
  set({ speaking: false, talking: false, id: null });
}

/**
 * The level at `t`: the made-up envelope for the computer voice; for a natural voice the real audio's, measured and
 * smoothed (`advance`: once per frame, by the loop), 0 until it plays, and made up too where the audio does not go
 * through Web Audio.
 */
function levelOf(me: Utterance, t: number, advance: boolean): number {
  const n = me.natural;
  if (!n) return me.env.level(t);
  if (!me.started) return 0;
  if (!advance) return n.real ? n.level : me.env.level(t);
  const rms = n.playback?.rms() ?? null;
  n.real = rms !== null;
  if (rms === null) return me.env.level(t);
  n.level = speakingLevel(n.level, rms, t - n.at);
  n.at = t;
  return n.level;
}

function frame() {
  const me = current;
  if (me && !me.rehearsal && !me.natural && me.started) {
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
  emit(levelOf(current, now(), true));
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
    haltNatural();
    const s = synth();
    if (s && (s.speaking || s.pending)) { try { s.cancel(); } catch { /* already silent */ } }
    return;
  }
  if (idPrefix !== undefined && !(me.id ?? "").startsWith(idPrefix)) return;
  end(me, true);
}

/**
 * The natural voice failed before a sound (contract F.1): she stays quiet and the reply's words stay on the page (owner
 * request, 27 October 2026: "I want everything to be ElevenLabs voice and no local voice at all"; the computer voice
 * used to take over here, so her voice alternated). It ends as `blocked`, so the Listen button can say so quietly.
 */
function quiet(me: Utterance): void {
  if (current !== me) return;
  end(me, false);
  set({ blocked: me.id ?? "" });
}

/** Her faces start on the natural voice's first sound (never over an open microphone). */
function naturalPlaying(me: Utterance): void {
  if (current !== me || !me.natural) return;
  if (microphoneOpen()) { end(me, true); return; }
  me.started = true;
  me.env.start(now());
  me.natural.at = now();
  me.natural.level = LEVEL_FLOOR;
  set({ talking: true });
}

/**
 * Says a reply in the person's natural voice (ElevenLabs), from the offer it carries. Never in this device's own voice
 * (owner request, 27 October 2026): without an offer this page can play, nothing is said and it answers false.
 */
function speak(text: string, opts: SpeakOptions = {}): boolean {
  init();
  stop();
  if (microphoneOpen()) return false;
  void text;
  const offer = usableOffer(opts.natural);
  if (offer && naturalAvailable()) {
    const me = utterance(opts.id, true);
    current = me;
    set({ speaking: true, talking: false, id: me.id, blocked: null });
    const playback = playNaturalSpeech(offer, opts.speed ?? readVoicePrefs().speed, {
      onPlaying: () => { naturalPlaying(me); if (current === me) set({ naturalFailed: null }); },
      onEnded: () => end(me, false),
      onFailed: (reason) => {
        if (current !== me) return;
        set({ naturalFailed: reason });
        quiet(me);
      },
    });
    if (me.natural) me.natural.playback = playback;
    else playback.stop(); // already over (stopped meanwhile)
    run();
    return true;
  }
  return false;
}

/**
 * Plays a natural voice's sample (our own sample route, `path`) as an utterance with `opts.id`, so the faces follow it
 * and Stop reaches it. false when it cannot start (no audio here, a microphone open, not a sample path). A sample that
 * fails ends as `blocked` (no computer voice stands in for a sample of another voice).
 */
function playSample(path: string, opts: { id?: string } = {}): boolean {
  init();
  stop();
  if (microphoneOpen() || !naturalAvailable() || !isSamplePath(path)) return false;
  const me = utterance(opts.id, true);
  current = me;
  set({ speaking: true, talking: false, id: me.id, blocked: null });
  const playback = playNaturalSample(path, {
    onPlaying: () => naturalPlaying(me),
    onEnded: () => end(me, false),
    onFailed: () => {
      if (current !== me) return;
      end(me, false);
      set({ blocked: me.id ?? "" });
    },
  });
  if (me.natural) me.natural.playback = playback;
  else playback.stop();
  run();
  return true;
}

/**
 * Call synchronously inside a user gesture (Send, Listen): iOS Safari only lets a page speak after it has spoken inside
 * one, so this speaks a silent space once, in a local voice (never a network one, not even for a space). `natural`: the
 * press is for a natural voice (Listen on a reply that offers one, a sample), so its AudioContext is started too; a
 * page that has played a natural voice starts it on every press anyway (review, 9 October 2026: a page on the computer
 * voice never runs one).
 */
function prime(opts: { natural?: boolean } = {}): void {
  init();
  // Never with the microphone open (Send while dictating): on iOS Safari it can switch the audio session mid-recording.
  if (microphoneOpen()) return;
  // Only the natural voice's player (contract F.1): its element unlocked once, and its AudioContext when wanted. No
  // silent utterance in this device's voice any more: nothing is ever said in it (27 October 2026).
  primeNatural(opts.natural === true);
}

/** The current 0 to 1 level (0 when she is not speaking); cheap, call every frame. */
function level(): number {
  return current ? levelOf(current, now(), false) : 0;
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
  const me: Utterance = { ...utterance(id), started: true, rehearsal: true };
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
  /** A natural voice's sample (Settings); false when it cannot start. */
  playSample,
  stop,
  prime,
  level,
  subscribeLevel,
  rehearse,
};
