/**
 * Her speaking level on the web (owner decision, 7 October 2026: her voice, personal assistants phase 2). She has no
 * mouth, so her eyes squash and open with each syllable while she talks; this is the 0 to 1 level they follow. The
 * browser's speech synthesis gives a page no audio to measure, so the level is made up from what it does give: a
 * boundary event as each word starts. Each one is a pulse (a 35 ms rise, then a decay with a 90 ms time constant), a
 * long word adds a second, smaller pulse 170 ms later (a second syllable), and wherever boundary events do not come
 * (some voices never send them, or they stop for a while) syllables are made up at 4 to 6 a second. While she speaks the
 * level never drops below 0.08, so her eyes never shut mid-sentence.
 *
 * Made-up syllables are generated lazily when the level is read, so the envelope needs no timer, and the level at a time
 * depends only on the events before it. `random` is injectable so the tests are repeatable
 * (tests/unit/assistant-speech.test.ts). The notch does not use this: it measures the real audio `say` renders.
 */

export type SpeechEnvelope = {
  /** Speaking began (ms timestamp, performance.now()). Later calls are ignored. */
  start(t: number): void;
  /** A word (or sentence) boundary event, with the word's length when known. */
  boundary(t: number, wordLength?: number): void;
  /** The level is 0 from now on. */
  stop(): void;
  /** 0 to 1 at time t (pure in t for a given history). */
  level(t: number): number;
};

const ATTACK_MS = 35;
const DECAY_TAU_MS = 90;
/** While she speaks her eyes never fully shut. */
const FLOOR = 0.08;
/** The level is the loudest of the last few pulses (older ones have long decayed). */
const RECENT = 4;
/** Made-up syllables start when no word has arrived this long after the start... */
const FIRST_WORD_MS = 350;
/** ...or this long after the last word. */
const QUIET_MS = 600;
const SECOND_SYLLABLE_MS = 170;
/** A long speech keeps at most this many pulses (the oldest half goes); only the last few ever matter. */
const KEEP = 512;

type Pulse = { at: number; peak: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createEnvelope(random: () => number = Math.random): SpeechEnvelope {
  const pulses: Pulse[] = [];
  let startedAt: number | null = null;
  let stopped = false;
  let lastWord: number | null = null;
  let nextSyllable: number | null = null;

  const add = (at: number, peak: number) => {
    let i = pulses.length;
    while (i > 0 && pulses[i - 1].at > at) i--;
    pulses.splice(i, 0, { at, peak: clamp(peak, 0, 1) });
    if (pulses.length > KEEP) pulses.splice(0, KEEP / 2);
  };

  // Made-up syllables, 4 to 6 a second, wherever no word has been heard for a while, up to time t.
  const catchUp = (t: number) => {
    if (startedAt === null || stopped) return;
    for (;;) {
      const from = lastWord === null ? startedAt + FIRST_WORD_MS : lastWord + QUIET_MS;
      if (nextSyllable === null || nextSyllable < from) nextSyllable = from;
      if (nextSyllable > t) return;
      add(nextSyllable, 0.45 + 0.4 * random());
      nextSyllable += 1000 / (4 + 2 * random());
    }
  };

  const at = (p: Pulse, t: number) => {
    const dt = t - p.at;
    if (dt < 0) return 0;
    return dt < ATTACK_MS ? p.peak * (dt / ATTACK_MS) : p.peak * Math.exp(-(dt - ATTACK_MS) / DECAY_TAU_MS);
  };

  return {
    start(t) {
      if (startedAt !== null || stopped) return;
      startedAt = t;
    },
    boundary(t, wordLength) {
      if (stopped) return;
      if (startedAt === null) startedAt = t;
      catchUp(t); // the made-up syllables before this word, with the history as it was
      lastWord = lastWord === null ? t : Math.max(lastWord, t);
      const length = wordLength !== undefined && Number.isFinite(wordLength) && wordLength > 0 ? wordLength : 5;
      const peak = clamp(Math.min(1, 0.6 + 0.05 * Math.min(length, 8)) + (random() - 0.5) * 0.15, 0.35, 1);
      add(t, peak);
      if (length >= 6) add(t + SECOND_SYLLABLE_MS, peak * 0.7);
    },
    stop() {
      stopped = true;
    },
    level(t) {
      if (startedAt === null || stopped || t < startedAt) return 0;
      catchUp(t);
      let best = 0;
      let seen = 0;
      for (let i = pulses.length - 1; i >= 0 && seen < RECENT; i--) {
        if (pulses[i].at > t) continue;
        seen++;
        best = Math.max(best, at(pulses[i], t));
      }
      return clamp(Math.max(FLOOR, best), 0, 1);
    },
  };
}
