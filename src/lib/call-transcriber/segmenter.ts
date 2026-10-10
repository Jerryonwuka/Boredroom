/**
 * Where speech starts and stops on a person's own microphone, for the on-device Whisper engine (owner decisions,
 * 8 October 2026: phase 8, Brenda's notes on calls; contract E.3). Pure and unit-tested: the runner feeds it the track's
 * loudness (RMS from an AnalyserNode) every 50 ms and starts or stops a MediaRecorder on what it says.
 *
 * - A segment starts when the level rises above the start level (the recorder starts at once, so nothing is cut off) and
 *   is confirmed once it stays up for 150 ms; a shorter blip is cancelled.
 * - It ends after 900 ms of silence once the segment is at least 2 s long (a short "Yes." followed by silence ends at
 *   2 s), or is cut at 25 s (and a new one starts at once when the person is still talking).
 * - A segment whose speech (start to the last loud moment) is under 0.8 s is dropped, not transcribed.
 *
 * Also the pure helpers the runner needs: the server's clock (`skew`), a line's `seq` and `at`, and the bounded queue.
 */
import { NOTES_LIMITS } from "@/lib/call-notes";

export const SEGMENT = {
  sampleMs: 50,
  confirmMs: 150,
  silenceEndMs: NOTES_LIMITS.silenceEndMs,
  minSegmentMs: 2_000,
  maxSegmentMs: NOTES_LIMITS.segmentMaxMs,
  minSpeechMs: NOTES_LIMITS.segmentMinMs,
  /** RMS of a float time-domain buffer (−1…1): speech on an echo-cancelled, gain-controlled track sits well above this. */
  startLevel: 0.02,
  /** Once speaking, a little quieter still counts as speech (hysteresis), so a soft word does not end the segment. */
  keepLevel: 0.012,
} as const;

export type SegmentEvent =
  | { type: "start"; at: number }
  | { type: "cancel" }
  | { type: "end"; startMs: number; endMs: number; speechMs: number; keep: boolean; cut: boolean };

export type SegmenterOptions = Partial<Pick<typeof SEGMENT, "confirmMs" | "silenceEndMs" | "minSegmentMs" | "maxSegmentMs" | "minSpeechMs" | "startLevel" | "keepLevel">>;

export type Segmenter = {
  /** One loudness sample at time `t` (ms, any clock that only goes forward). */
  push(rms: number, t: number): SegmentEvent[];
  /** Forget any segment in progress without an event (muted, notes off, disconnected: it is discarded, never sent). */
  reset(): void;
  /** Whether a segment is being recorded now. */
  readonly active: boolean;
};

export function createSegmenter(o: SegmenterOptions = {}): Segmenter {
  const c = { ...SEGMENT, ...o };
  let start: number | null = null;     // when the current segment began
  let confirmed = false;
  let lastLoud = 0;                    // the last moment above the keep level

  const end = (t: number, cut: boolean): SegmentEvent => {
    const s = start as number;
    const speechMs = Math.max(0, lastLoud - s);
    start = null;
    confirmed = false;
    return { type: "end", startMs: s, endMs: t, speechMs, keep: speechMs >= c.minSpeechMs, cut };
  };

  return {
    get active() { return start !== null; },
    reset() { start = null; confirmed = false; },
    push(rms: number, t: number): SegmentEvent[] {
      const level = Number.isFinite(rms) ? rms : 0;
      const out: SegmentEvent[] = [];
      if (start === null) {
        if (level >= c.startLevel) {
          start = t;
          lastLoud = t;
          confirmed = false;
          out.push({ type: "start", at: t });
        }
        return out;
      }
      const loud = level >= (confirmed ? c.keepLevel : c.startLevel);
      if (loud) lastLoud = t;
      if (!confirmed) {
        if (!loud) { start = null; out.push({ type: "cancel" }); return out; }
        if (t - start >= c.confirmMs) confirmed = true;
        return out;
      }
      if (t - start >= c.maxSegmentMs) {
        out.push(end(t, true));
        // Still talking: the next segment starts now.
        if (loud) { start = t; lastLoud = t; confirmed = true; out.push({ type: "start", at: t }); }
        return out;
      }
      if (t - lastLoud >= c.silenceEndMs && t - start >= c.minSegmentMs) out.push(end(t, false));
      return out;
    },
  };
}

/** The root mean square of a float time-domain buffer (an AnalyserNode's getFloatTimeDomainData). */
export function rmsOf(buf: ArrayLike<number>): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// ---- Times on the server's clock -------------------------------------------------------------------------------------------

/** How far the server's clock is ahead of this device's: `serverNow` (the call view's) minus the moment it arrived here. */
export function serverSkew(serverNow: string, localNowMs: number): number {
  const s = Date.parse(serverNow);
  return Number.isFinite(s) ? s - localNowMs : 0;
}

/**
 * A line's `seq`: whole tenths of a second from the call's start to the moment the speech started (server clock). Unique
 * per person (two segments never start in the same tenth), stable across a reload; the server ignores a repeat.
 */
export function lineSeq(startMs: number, skew: number, callStartedAt: string): number {
  const started = Date.parse(callStartedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.min(10_000_000, Math.max(0, Math.floor((startMs + skew - started) / 100)));
}

/** A line's `at`: when the speech started, on the server's clock, in epoch milliseconds. */
export const lineAt = (startMs: number, skew: number): number => Math.round(startMs + skew);

/**
 * Adds a waiting segment, dropping the oldest when more than `max` would wait (the device is falling behind). Answers
 * how many were dropped (the status line then says "Falling behind").
 */
export function pushBounded<T>(queue: T[], item: T, max: number = NOTES_LIMITS.queueMax): number {
  queue.push(item);
  let dropped = 0;
  while (queue.length > max) { queue.shift(); dropped++; }
  return dropped;
}
