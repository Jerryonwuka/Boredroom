import { describe, it, expect, vi } from "vitest";

// The on-device transcriber's pure parts (owner decisions, 8 October 2026: phase 8, Brenda's notes on calls; contract
// E.3): where speech starts and stops (150 ms to start, 900 ms of silence to end once 2 s long, cut at 25 s, under 0.8 s
// dropped), the filter for what Whisper makes up, a line's seq and time on the server's clock, and the sender (batches,
// retries, stopping for good). No audio anywhere: these are numbers and text.

import { cleanLine, collapseRepeats, MADE_UP_LINES } from "@/lib/call-transcriber/filter";
import { createSegmenter, lineAt, lineSeq, pushBounded, rmsOf, serverSkew, type SegmentEvent } from "@/lib/call-transcriber/segmenter";
import { createLineSender, stopReasonOf, type Line, type PostResult } from "@/lib/call-transcriber/runner";

/** Feeds a level every 50 ms: `pattern` is [level, ms] pieces. Answers every event with its time. */
function run(pattern: [number, number][], from = 0): (SegmentEvent & { t: number })[] {
  const seg = createSegmenter();
  const out: (SegmentEvent & { t: number })[] = [];
  let t = from;
  for (const [level, ms] of pattern) {
    for (let k = 0; k < ms; k += 50) { for (const e of seg.push(level, t)) out.push({ ...e, t }); t += 50; }
  }
  return out;
}
const LOUD = 0.1, QUIET = 0.001;

describe("the segmenter", () => {
  it("cancels a blip under 150 ms and confirms speech that stays up", () => {
    const blip = run([[QUIET, 200], [LOUD, 100], [QUIET, 3000]]);
    expect(blip.map((e) => e.type)).toEqual(["start", "cancel"]);
    const said = run([[QUIET, 200], [LOUD, 3000], [QUIET, 2000]]);
    expect(said.map((e) => e.type)).toEqual(["start", "end"]);
  });

  it("ends after 900 ms of silence once 2 s long, keeps 0.8 s or more of speech", () => {
    const ev = run([[LOUD, 3000], [QUIET, 2000]]);
    const end = ev.find((e) => e.type === "end")!;
    expect(end).toMatchObject({ type: "end", startMs: 0, keep: true, cut: false });
    // The last loud sample is at 2950 ms; the end comes 900 ms after it.
    expect(end.t).toBe(2950 + 900);
    expect((end as { speechMs: number }).speechMs).toBe(2950);
  });

  it("holds a short word until the segment is 2 s long, then drops it (under 0.8 s)", () => {
    const ev = run([[LOUD, 500], [QUIET, 3000]]);
    const end = ev.find((e) => e.type === "end") as Extract<SegmentEvent, { type: "end" }> & { t: number };
    expect(end.t).toBe(2000);
    expect(end.keep).toBe(false);
    expect(end.speechMs).toBeLessThan(800);
  });

  it("keeps speech of exactly 0.8 s and more", () => {
    const ev = run([[LOUD, 850], [QUIET, 3000]]);
    expect(ev.find((e) => e.type === "end")).toMatchObject({ keep: true });
  });

  it("cuts at 25 s and starts the next segment at once while the person talks on", () => {
    const ev = run([[LOUD, 30_000], [QUIET, 3000]]);
    expect(ev.map((e) => e.type)).toEqual(["start", "end", "start", "end"]);
    expect(ev[1]).toMatchObject({ cut: true, startMs: 0, keep: true });
    expect(ev[1].t).toBe(25_000);
    expect(ev[2].t).toBe(25_000);
  });

  it("does not end on a short pause in the middle of speech", () => {
    const ev = run([[LOUD, 1500], [QUIET, 600], [LOUD, 1500], [QUIET, 2000]]);
    expect(ev.filter((e) => e.type === "end")).toHaveLength(1);
  });

  it("forgets a segment on reset without an event", () => {
    const seg = createSegmenter();
    expect(seg.push(LOUD, 0)).toEqual([{ type: "start", at: 0 }]);
    seg.reset();
    expect(seg.active).toBe(false);
    expect(seg.push(QUIET, 50)).toEqual([]);
  });

  it("measures loudness", () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe("the filter", () => {
  it("drops what Whisper makes up from silence", () => {
    for (const s of MADE_UP_LINES) expect(cleanLine(s), s).toBeNull();
    for (const s of ["", "   ", "...", "[BLANK_AUDIO]", "(music)", "[Music] (applause)", " - ", "♪"]) expect(cleanLine(s), s).toBeNull();
    // Only when it is the whole line.
    expect(cleanLine("Thank you. I'll send the deck.")).toBe("Thank you. I'll send the deck.");
    expect(cleanLine("you know what")).toBe("you know what");
  });

  it("makes one line of at most 1000 characters", () => {
    expect(cleanLine("one\ntwo\u0000three four")).toBe("one two three four");
    expect(cleanLine("  lots   of   space  ")).toBe("lots of space");
    expect(cleanLine("a".repeat(1500))).toHaveLength(1000);
    expect(cleanLine(42)).toBeNull();
  });

  it("collapses a phrase said three or more times in a row", () => {
    expect(collapseRepeats("I think I think I think we should ship")).toBe("I think we should ship");
    expect(collapseRepeats("go go go")).toBe("go");
    expect(collapseRepeats("yes yes, fine")).toBe("yes yes, fine");
    expect(cleanLine("Okay. Okay. Okay. Okay. Let's start.")).toBe("Okay. Let's start.");
  });
});

describe("times on the server's clock", () => {
  const started = "2026-10-10T14:00:00.000Z";
  it("seq is whole tenths of a second from the call's start, never negative, stable across a reload", () => {
    const skew = serverSkew("2026-10-10T14:00:10.000Z", Date.parse("2026-10-10T14:00:08.000Z"));
    expect(skew).toBe(2000);
    const local = Date.parse("2026-10-10T14:01:00.000Z");    // the device is 2 s behind the server
    expect(lineSeq(local, skew, started)).toBe(620);
    expect(lineAt(local, skew)).toBe(Date.parse("2026-10-10T14:01:02.000Z"));
    expect(lineSeq(local + 99, skew, started)).toBe(620);
    expect(lineSeq(local + 100, skew, started)).toBe(621);
    expect(lineSeq(Date.parse("2026-10-10T13:59:00.000Z"), 0, started)).toBe(0);
    expect(serverSkew("not a date", 5)).toBe(0);
  });

  it("drops the oldest segments when more than three wait", () => {
    const q: number[] = [1, 2, 3];
    expect(pushBounded(q, 4)).toBe(1);
    expect(q).toEqual([2, 3, 4]);
    expect(pushBounded(q, 5, 5)).toBe(0);
  });
});

describe("the sender", () => {
  const line = (seq: number): Line => ({ seq, at: 1_760_104_800_000 + seq * 100, text: `line ${seq}` });
  function timers() {
    const pending: { fn: () => void; ms: number }[] = [];
    return {
      setTimer: (fn: () => void, ms: number) => { const t = { fn, ms }; pending.push(t); return t; },
      clearTimer: (t: unknown) => { const i = pending.indexOf(t as never); if (i >= 0) pending.splice(i, 1); },
      fire: async () => { const t = pending.shift(); t?.fn(); await new Promise((r) => setTimeout(r, 0)); },
      pending,
    };
  }

  it("waits up to 5 s, sends sooner at five lines, at most 10 a request", async () => {
    const posts: Line[][] = [];
    const t = timers();
    const s = createLineSender({ post: async (l) => { posts.push(l); return { ok: true }; }, onStop: () => undefined, setTimer: t.setTimer, clearTimer: t.clearTimer });
    s.add(line(1));
    expect(posts).toHaveLength(0);
    expect(t.pending[0].ms).toBe(5000);
    await t.fire();
    expect(posts).toEqual([[line(1)]]);
    for (let i = 2; i <= 6; i++) s.add(line(i));
    await new Promise((r) => setTimeout(r, 0));
    expect(posts[1].map((l) => l.seq)).toEqual([2, 3, 4, 5, 6]);
    for (let i = 10; i < 22; i++) s.add(line(i));
    await s.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(posts.every((p) => p.length <= 10)).toBe(true);
    expect(posts.flat().map((l) => l.seq)).toEqual([1, 2, 3, 4, 5, 6, ...Array.from({ length: 12 }, (_, i) => 10 + i)]);
  });

  it("retries network errors, 429 and 503 three times, then gives up", async () => {
    const t = timers();
    const results: PostResult[] = [{ ok: false, retry: true }, { ok: false, retry: true }, { ok: true }];
    const post = vi.fn(async (): Promise<PostResult> => results.shift() ?? { ok: true });
    const s = createLineSender({ post, onStop: () => undefined, setTimer: (fn) => { fn(); return null; }, clearTimer: t.clearTimer });
    s.add(line(1));
    await s.flush();
    expect(post).toHaveBeenCalledTimes(3);
    expect(s.stopped).toBeNull();
    const stops: string[] = [];
    const s2 = createLineSender({ post: async () => { throw new Error("offline"); }, onStop: (r) => stops.push(r), setTimer: (fn) => { fn(); return null; }, clearTimer: () => undefined });
    s2.add(line(1));
    await s2.flush();
    expect(stops).toEqual(["failed"]);
  });

  it("stops for good on no consent, notes off, not in the call and not found", async () => {
    for (const [code, status, reason] of [["NO_CONSENT", 403, "no_consent"], ["NOTES_OFF", 409, "notes_off"], ["NOT_IN_CALL", 409, "not_in_call"], ["NOT_FOUND", 404, "not_found"]] as const) {
      expect(stopReasonOf(status, code)).toBe(reason);
      const stops: string[] = [];
      const post = vi.fn(async (): Promise<PostResult> => ({ ok: false, stop: reason }));
      const s = createLineSender({ post, onStop: (r) => stops.push(r), setTimer: (fn) => { fn(); return null; }, clearTimer: () => undefined });
      s.add(line(1));
      await s.flush();
      s.add(line(2));
      await s.flush();
      expect(stops).toEqual([reason]);
      expect(post).toHaveBeenCalledTimes(1);
      expect(s.waiting).toBe(0);
    }
    // 429 and 503 are retried before this is asked (postLinesTo); any other refusal stops it.
    expect(stopReasonOf(429, "RATE_LIMITED")).toBeNull();
    expect(stopReasonOf(422, "INVALID_INPUT")).toBe("failed");
    expect(stopReasonOf(404, undefined)).toBe("not_found");
  });
});
