/**
 * Her speaking level from real audio (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F.1). A
 * natural voice plays through Web Audio, so the page can measure what she actually says: each animation frame the
 * controller reads the analyser's waveform, takes its loudness (`rmsLevel`) and smooths it into the 0 to 1 level her
 * faces follow (`speakingLevel`), in place of the made-up envelope the on-device voices need (assistant-speech/envelope).
 *
 * The smoothing is a one-pole follower: it rises fast (a ~30 ms time constant, so a syllable opens her eyes at once) and
 * falls slower (~120 ms, so they do not flutter between syllables). Ordinary speech (an RMS of roughly 0.1 to 0.2 for the
 * mp3s ElevenLabs sends) peaks near 0.8 to 1. While she speaks the level never drops below FLOOR, like the envelope's,
 * so her eyes never shut mid-sentence. Pure, unit-tested (tests/unit/assistant-speech-natural.test.ts); the notch has
 * the same maths in desktop/src/natural-voice.js.
 */

/** While she speaks her eyes never fully shut (the envelope's floor too). */
export const LEVEL_FLOOR = 0.08;
/** Loudness to level: an RMS of 0.15 (ordinary speech) is 0.9. */
export const LEVEL_GAIN = 6;
export const ATTACK_TAU_MS = 30;
export const DECAY_TAU_MS = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The root mean square of a waveform (samples from -1 to 1), from 0 to 1; 0 for none or for nonsense. */
export function rmsLevel(samples: ArrayLike<number>): number {
  const n = samples?.length ?? 0;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    if (Number.isFinite(s)) sum += s * s;
  }
  const rms = Math.sqrt(sum / n);
  return Number.isFinite(rms) ? clamp(rms, 0, 1) : 0;
}

/**
 * The next level from the last one, this frame's loudness and the time since the last frame: up towards the loudness
 * (times LEVEL_GAIN, at most 1) with the attack time constant, down with the decay one, never under LEVEL_FLOOR.
 */
export function speakingLevel(prev: number, rms: number, dtMs: number): number {
  const from = Number.isFinite(prev) ? clamp(prev, 0, 1) : LEVEL_FLOOR;
  const target = Number.isFinite(rms) ? clamp(rms * LEVEL_GAIN, 0, 1) : 0;
  const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, 1000)) : 0;
  const tau = target > from ? ATTACK_TAU_MS : DECAY_TAU_MS;
  const next = from + (target - from) * (1 - Math.exp(-dt / tau));
  return clamp(Math.max(LEVEL_FLOOR, next), 0, 1);
}
