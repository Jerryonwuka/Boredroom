/**
 * Brenda's sounds in the web app (owner decision, 4 October 2026): the same synthesised set as the desktop notch
 * (`desktop/src/sound.js`), so she sounds the same everywhere. No audio files: short sine and triangle notes with quick
 * envelopes, played quietly through one shared context that is suspended a moment after the last sound. Muting is a
 * per-browser choice, remembered locally.
 */

type Note = { f: number; to?: number; at?: number; dur?: number; type?: OscillatorType; gain?: number };

const MUTE_KEY = "brenda-sounds-muted";
const VOLUME = 0.14;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

export function soundsMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
const MUTE_EVENT = "brenda:sounds";
export function setSoundsMuted(muted: boolean) {
  try { if (muted) localStorage.setItem(MUTE_KEY, "1"); else localStorage.removeItem(MUTE_KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(MUTE_EVENT));
}
/** For useSyncExternalStore: the mute switch, shared by every Brenda on the page. */
export function subscribeSounds(cb: () => void) {
  window.addEventListener(MUTE_EVENT, cb);
  return () => window.removeEventListener(MUTE_EVENT, cb);
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => { if (ctx?.state === "running") void ctx.suspend(); }, 1800);
  return ctx;
}

function note({ f, to = f, at = 0, dur = 0.12, type = "sine", gain = 1 }: Note) {
  const c = audio(); if (!c || !master) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to !== f) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.85);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const SOUNDS = {
  open: () => { note({ f: 520, to: 660, dur: 0.11, gain: 0.5 }); note({ f: 780, at: 0.06, dur: 0.14, gain: 0.35 }); },
  close: () => note({ f: 640, to: 470, dur: 0.12, gain: 0.4 }),
  send: () => note({ f: 700, to: 1100, dur: 0.1, gain: 0.3 }),
  reply: () => { note({ f: 784, dur: 0.1, gain: 0.35 }); note({ f: 1047, at: 0.07, dur: 0.16, gain: 0.3 }); },
  success: () => [523, 659, 784, 1047].forEach((f, i) => note({ f, at: i * 0.055, dur: 0.18, type: "triangle", gain: 0.42 })),
  attention: () => { note({ f: 880, dur: 0.1, type: "triangle", gain: 0.45 }); note({ f: 880, at: 0.14, dur: 0.12, type: "triangle", gain: 0.4 }); },
  error: () => { note({ f: 330, dur: 0.13, type: "triangle", gain: 0.5 }); note({ f: 247, at: 0.1, dur: 0.2, type: "triangle", gain: 0.45 }); },
  listen: () => note({ f: 440, to: 880, dur: 0.16, gain: 0.45 }),
  poke: () => note({ f: 260, to: 200, dur: 0.09, type: "triangle", gain: 0.5 }),
  dizzy: () => [0, 0.09, 0.18, 0.27].forEach((at, i) => note({ f: 700 - i * 90, to: 640 - i * 90, at, dur: 0.12, gain: 0.3 })),
  love: () => { note({ f: 659, dur: 0.16, gain: 0.35 }); note({ f: 988, at: 0.1, dur: 0.24, gain: 0.3 }); },
  // Calls (owner decisions, 8 October 2026: phase 8): a soft two-tone phone ring of about 1.2 s, played every 2.5 s
  // while someone is calling (at most 30 s), and the short falling tone when a call ends. They are the call's sounds,
  // not Brenda's chimes: play them with playCallSound (below).
  ring: () => [0, 0.4].forEach((at) => { note({ f: 660, at, dur: 0.18, type: "triangle", gain: 0.45 }); note({ f: 880, at: at + 0.2, dur: 0.18, type: "triangle", gain: 0.4 }); }),
  hangup: () => note({ f: 520, to: 360, dur: 0.22, type: "triangle", gain: 0.4 }),
} as const;

export type BrendaSound = keyof typeof SOUNDS;

/** One of Brenda's chimes, unless the person turned her chimes off in this browser. */
export function playSound(name: BrendaSound) {
  if (soundsMuted()) return;
  try { SOUNDS[name](); } catch { /* a sound never breaks the page */ }
}

/**
 * A call's own sound: the ring, the soft note of a second call while on one, the hang-up (fix review, 10 October 2026:
 * turning Brenda's chimes off also silenced incoming calls, with no warning). Brenda's chime switch does not cover them;
 * incoming calls have their own switch (owner decision, 10 October 2026: "incoming calls get their own sound setting,
 * separate from Brenda's sound effects, default on"), `callRingOff`, in Settings → Your assistant → Calls, remembered
 * per browser like her chimes. It covers the ring and the soft note; the hang-up is the call's own answer to a press and
 * always plays. What else stops a ring: Do not disturb or quiet hours (the server then rings nobody), Esc or the card's
 * Silence button for one ring, and the notch ringing instead (one ringer).
 */
export function playCallSound(name: "ring" | "attention" | "hangup") {
  if (name !== "hangup" && callRingOff()) return;
  try { SOUNDS[name](); } catch { /* a sound never breaks the page */ }
}

const CALL_RING_KEY = "boredroom-call-ring-off";
const CALL_RING_EVENT = "boredroom:call-ring";
/** The person turned the incoming-call sound off in this browser (on unless they did). */
export function callRingOff(): boolean {
  try { return localStorage.getItem(CALL_RING_KEY) === "1"; } catch { return false; }
}
export function setCallRingOff(off: boolean) {
  try { if (off) localStorage.setItem(CALL_RING_KEY, "1"); else localStorage.removeItem(CALL_RING_KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(CALL_RING_EVENT));
}
/** For useSyncExternalStore: the incoming-call sound switch (also changed in another tab). */
export function subscribeCallRing(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === CALL_RING_KEY) cb(); };
  window.addEventListener(CALL_RING_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CALL_RING_EVENT, cb); window.removeEventListener("storage", onStorage); };
}
/** Plays the ring once, so the person hears what they turned on. */
export function previewCallRing() {
  try { SOUNDS.ring(); } catch { /* a sound never breaks the page */ }
}
