// Her natural voice on the notch (owner decision, 9 October 2026: natural voice (ElevenLabs), contract G and H). Loads
// desktop/src/natural-voice.js as Node sees it (module.exports), a fresh copy for each test so its one audio context is
// new, and checks the player's promises with a fake Web Audio: base64 decoding, the level maths (the web's, contract F.1),
// and play() running, suspended (onFail, never a sound), a decode error (onFail), stop() (silent, the source stopped) and
// a failure once heard (onEnd, never a restart). Nothing here reaches ElevenLabs or Boredroom: the audio is bytes made here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as web from "@/lib/assistant-speech/level";

type PlayOptions = { audioBase64?: unknown; onStart?: () => void; onLevel?: (l: number) => void; onEnd?: () => void; onFail?: (why: string) => void };
type NaturalVoiceApi = {
  T: { RESUME_MS: number; REFUSE_MS: number; IDLE_MS: number; FFT: number; GAIN: number; ATTACK_MS: number; DECAY_MS: number; FLOOR: number; MAX_BYTES: number };
  readonly supported: boolean;
  disable(): void;
  release(): void;
  base64ToArrayBuffer(b64: unknown): ArrayBuffer;
  rmsLevel(samples: ArrayLike<number> | null | undefined): number;
  speakingLevel(prev: number, rms: number, dtMs: number): number;
  warm(): Promise<boolean>;
  play(o?: PlayOptions): () => void;
  playing(): boolean;
  stop(): void;
};

const file = fileURLToPath(new URL("../../desktop/src/natural-voice.js", import.meta.url));
const require = createRequire(import.meta.url);
/** A fresh copy of the script (its context, analyser and `supported` start over). */
function load(): NaturalVoiceApi {
  delete require.cache[file];
  return require(file) as NaturalVoiceApi;
}

// ---- a fake Web Audio ------------------------------------------------------------------------------------------------

type Source = { buffer: unknown; onended: (() => void) | null; started: boolean; stopped: boolean; connectedTo: unknown; connect(n: unknown): void; disconnect(): void; start(): void; stop(): void };
const audio = {
  initial: "running" as "running" | "suspended",
  resumable: true,
  decodeFails: false,
  duration: 1.5,
  amplitude: 0.12, // what the analyser hears: a constant frame of this value, so its RMS is exactly this
  contexts: [] as FakeContext[],
  sources: [] as Source[],
};

class FakeContext {
  state: "running" | "suspended" | "closed";
  destination = { node: "speakers" };
  resumes = 0;
  constructor() { this.state = audio.initial; audio.contexts.push(this); }
  resume() {
    this.resumes++;
    if (!audio.resumable) return new Promise<void>(() => {}); // a webview that wants a press first: never settles
    this.state = "running";
    return Promise.resolve();
  }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  createAnalyser() {
    return {
      fftSize: 2048,
      connected: null as unknown,
      connect(n: unknown) { this.connected = n; },
      getFloatTimeDomainData(buf: Float32Array) { buf.fill(audio.amplitude); },
    };
  }
  decodeAudioData(buf: ArrayBuffer) {
    if (audio.decodeFails || !(buf instanceof ArrayBuffer)) return Promise.reject(new Error("EncodingError"));
    return Promise.resolve({ duration: audio.duration });
  }
  createBufferSource(): Source {
    const s: Source = {
      buffer: null, onended: null, started: false, stopped: false, connectedTo: null,
      connect(n) { s.connectedTo = n; }, disconnect() {}, start() { s.started = true; }, stop() { s.stopped = true; },
    };
    audio.sources.push(s);
    return s;
  }
}

// Animation frames run when the test says so, 16.7 ms apart (their timestamps on performance.now()'s clock, as a browser's).
let frames: ((t: number) => void)[] = [];
let frameNo = 0;
const flushFrames = (n = 1) => { for (let i = 0; i < n; i++) { const f = frames; frames = []; const t = performance.now() + 16.7 * ++frameNo; for (const fn of f) fn(t); } };

const sound = Buffer.from("ID3 a few bytes standing in for an MP3").toString("base64");
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  Object.assign(audio, { initial: "running", resumable: true, decodeFails: false, duration: 1.5, amplitude: 0.12, contexts: [], sources: [] });
  frames = [];
  frameNo = 0;
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => { frames.push(fn); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- the script --------------------------------------------------------------------------------------------------------

describe("the script", () => {
  it("parses as plain JavaScript (node --check), as the notch loads it, and so does main.js", () => {
    for (const f of ["desktop/src/natural-voice.js", "desktop/src/main.js"]) expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
  });
  it("declares one frozen global with the player and its maths", () => {
    const NV = load();
    expect(Object.isFrozen(NV)).toBe(true);
    expect(Object.keys(NV).sort()).toEqual(["T", "base64ToArrayBuffer", "disable", "play", "playing", "release", "rmsLevel", "speakingLevel", "stop", "supported", "warm"]);
    expect(NV.T.FLOOR).toBe(0.08);
    expect(NV.T.RESUME_MS).toBe(300);
    expect(NV.T.REFUSE_MS).toBe(2000);
  });
  it("is supported until disabled, for the rest of the run", async () => {
    const NV = load();
    expect(NV.supported).toBe(true);
    NV.disable();
    expect(NV.supported).toBe(false);
    expect(await NV.warm()).toBe(false); // and asks for no context at all
    expect(audio.contexts).toHaveLength(0);
  });
  it("is loaded before main.js on the notch and in the preview", async () => {
    const { readFileSync } = await import("node:fs");
    const order = (html: string) => [...html.matchAll(/<script src="(?:src\/)?([a-z-]+)\.js"><\/script>/g)].map((m) => m[1]);
    for (const page of ["desktop/src/index.html", "desktop/preview.html"]) {
      const scripts = order(readFileSync(page, "utf8"));
      expect(scripts.indexOf("natural-voice")).toBeGreaterThan(-1);
      expect(scripts.indexOf("natural-voice")).toBeLessThan(scripts.indexOf("main"));
    }
  });
});

// ---- base64 --------------------------------------------------------------------------------------------------------------

describe("base64ToArrayBuffer", () => {
  const NV = load();
  const bytes = (b: ArrayBuffer) => [...new Uint8Array(b)];
  it("decodes standard base64 to the same bytes", () => {
    const raw = Uint8Array.from([0, 1, 2, 127, 128, 254, 255, 73, 68, 51]);
    expect(bytes(NV.base64ToArrayBuffer(Buffer.from(raw).toString("base64")))).toEqual([...raw]);
    expect(bytes(NV.base64ToArrayBuffer("SUQz"))).toEqual([73, 68, 51]); // "ID3"
    expect(bytes(NV.base64ToArrayBuffer("SQ=="))).toEqual([73]);
    expect(bytes(NV.base64ToArrayBuffer("SUQ="))).toEqual([73, 68]);
  });
  it("ignores whitespace (line-wrapped base64)", () => {
    expect(bytes(NV.base64ToArrayBuffer(" SU\nQz \t"))).toEqual([73, 68, 51]);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "   ", "S", "SUQ$", "SU-_", "data:audio/mpeg;base64,SUQz", null, undefined, 42, {}, ["SUQz"]]) {
      expect(() => NV.base64ToArrayBuffer(bad)).toThrow();
    }
  });
  it("refuses more than an utterance can be (4 MB)", () => {
    expect(() => NV.base64ToArrayBuffer("A".repeat(Math.ceil((NV.T.MAX_BYTES / 3) * 4) + 8))).toThrow();
  });
});

// ---- the level maths -------------------------------------------------------------------------------------------------

describe("rmsLevel", () => {
  const NV = load();
  it("is 0 for nothing", () => {
    expect(NV.rmsLevel(new Float32Array(0))).toBe(0);
    expect(NV.rmsLevel(null)).toBe(0);
    expect(NV.rmsLevel(undefined)).toBe(0);
    expect(NV.rmsLevel(new Float32Array(1024))).toBe(0);
  });
  it("is the root mean square", () => {
    expect(NV.rmsLevel(new Float32Array(512).fill(0.5))).toBeCloseTo(0.5, 6);
    expect(NV.rmsLevel(Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? -0.25 : 0.25)))).toBeCloseTo(0.25, 6);
    // A full sine of amplitude a: a / √2.
    const sine = Float32Array.from({ length: 1024 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 8 * i) / 1024));
    expect(NV.rmsLevel(sine)).toBeCloseTo(0.8 / Math.SQRT2, 4);
  });
  it("skips samples that are not numbers", () => {
    expect(NV.rmsLevel([0.5, Number.NaN, 0.5, Number.POSITIVE_INFINITY])).toBeCloseTo(Math.sqrt(0.5 / 4), 6);
  });
});

describe("speakingLevel", () => {
  const NV = load();
  it("never drops under the floor while she plays, and never goes over 1", () => {
    expect(NV.speakingLevel(0, 0, 16)).toBe(0.08);
    expect(NV.speakingLevel(1, 0, 10_000)).toBe(0.08);
    expect(NV.speakingLevel(1, 5, 10_000)).toBe(1);
    for (const [p, r, dt] of [[0.5, 0.2, 16], [0.2, 0.001, 33], [-3, 0.1, 16], [9, 0.1, 16], [Number.NaN, Number.NaN, Number.NaN], [0.4, -1, -5]]) {
      const v = NV.speakingLevel(p, r, dt);
      expect(v).toBeGreaterThanOrEqual(0.08);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("opens her eyes wide for ordinary speech (an RMS of 0.15 is 0.9)", () => {
    expect(NV.speakingLevel(0, 0.15, 10_000)).toBeCloseTo(0.9, 6);
    expect(NV.speakingLevel(0, 0.25, 10_000)).toBeCloseTo(1, 6);
    expect(NV.speakingLevel(0, 0.005, 10_000)).toBe(0.08); // room noise: no more than the floor
  });
  it("rises fast and falls slower (30 ms attack, 120 ms decay)", () => {
    const up = NV.speakingLevel(0.1, 1, 30) - 0.1;  // towards 1 for one attack time constant
    const down = 1 - NV.speakingLevel(1, 0, 30);    // towards 0 for the same time
    expect(up).toBeCloseTo(0.9 * (1 - Math.exp(-1)), 6);
    expect(down).toBeCloseTo(1 - Math.exp(-30 / 120), 6);
    expect(up).toBeGreaterThan(down * 2);
  });
  it("does not move without time passing", () => {
    expect(NV.speakingLevel(0.6, 1, 0)).toBeCloseTo(0.6, 6);
    expect(NV.speakingLevel(0.6, 0, 0)).toBeCloseTo(0.6, 6);
  });
  it("follows syllables: open on a loud frame, closing in a pause", () => {
    let level = 0;
    const seen: number[] = [];
    for (const rms of [0.15, 0.15, 0.15, 0, 0, 0, 0, 0, 0.1, 0.1]) { level = NV.speakingLevel(level, rms, 16.7); seen.push(level); }
    expect(seen[2]).toBeGreaterThan(0.7);
    expect(seen[7]).toBeLessThan(seen[2]);
    expect(seen[9]).toBeGreaterThan(seen[7]);
  });
  it("is the web's maths exactly (src/lib/assistant-speech/level.ts), so her face moves alike on both", () => {
    expect([NV.T.GAIN, NV.T.ATTACK_MS, NV.T.DECAY_MS, NV.T.FLOOR]).toEqual([web.LEVEL_GAIN, web.ATTACK_TAU_MS, web.DECAY_TAU_MS, web.LEVEL_FLOOR]);
    const values = [Number.NaN, -1, 0, 0.004, 0.05, 0.1, 0.15, 0.3, 1, 2];
    for (const prev of values) for (const rms of values) for (const dt of [Number.NaN, -5, 0, 8, 16.7, 33, 120, 5_000]) {
      expect(NV.speakingLevel(prev, rms, dt)).toBe(web.speakingLevel(prev, rms, dt));
    }
    for (const frame of [[], [0.5, -0.5], [2, 2], [Number.NaN, 0.2], Array.from({ length: 1024 }, (_, i) => Math.sin(i / 7) * 0.3)]) {
      expect(NV.rmsLevel(frame)).toBe(web.rmsLevel(frame));
    }
  });
});

// ---- the player ---------------------------------------------------------------------------------------------------------

describe("play", () => {
  it("decodes, plays through the analyser, sends levels every frame and ends on its own", async () => {
    const NV = load();
    const calls: string[] = [];
    const levels: number[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onLevel: (l) => levels.push(l), onEnd: () => calls.push("end"), onFail: (w) => calls.push(`fail:${w}`) });
    expect(calls).toEqual([]); // never from inside play()
    await settle();
    expect(calls).toEqual(["start"]);
    expect(NV.playing()).toBe(true);
    const [ctx] = audio.contexts, [src] = audio.sources;
    expect(audio.contexts).toHaveLength(1);
    expect(src.started).toBe(true);
    expect(src.buffer).toEqual({ duration: 1.5 });
    expect(src.connectedTo).toMatchObject({ fftSize: 1024, connected: ctx.destination }); // source → analyser → speakers
    flushFrames(5);
    expect(levels).toHaveLength(5);
    expect(levels.every((l) => l >= 0.08 && l <= 1)).toBe(true);
    expect(levels[4]).toBeGreaterThan(levels[0]); // rising towards the level of what plays (0.12 RMS: wide open)
    src.onended?.();
    expect(calls).toEqual(["start", "end"]);
    expect(NV.playing()).toBe(false);
    flushFrames(3);
    expect(levels).toHaveLength(5); // no level after the end
  });

  it("measures the real level: louder audio opens her eyes wider", async () => {
    const at = async (amplitude: number) => {
      audio.amplitude = amplitude;
      const NV = load();
      let last = 0;
      NV.play({ audioBase64: sound, onLevel: (l) => { last = l; } });
      await settle();
      flushFrames(30);
      NV.stop();
      return last;
    };
    const quiet = await at(0.03), loud = await at(0.12), silent = await at(0.001);
    expect(loud).toBeGreaterThan(quiet);
    expect(quiet).toBeGreaterThan(silent);
    expect(silent).toBe(0.08);
  });

  it("resumes a suspended context that may run, and plays", async () => {
    audio.initial = "suspended";
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    expect(audio.contexts[0].resumes).toBe(1);
    expect(calls).toEqual(["start"]);
  });

  it("fails with `suspended` when the context will not run within 300 ms, and plays nothing", async () => {
    vi.useFakeTimers();
    audio.initial = "suspended";
    audio.resumable = false;
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onEnd: () => calls.push("end"), onFail: (w) => calls.push(`fail:${w}`) });
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(["fail:suspended"]);
    expect(audio.sources).toHaveLength(0);
    expect(NV.playing()).toBe(false);
  });

  it("warm() says whether the context runs, before anything is fetched", async () => {
    vi.useFakeTimers();
    audio.initial = "suspended";
    audio.resumable = false;
    const NV = load();
    const w = NV.warm();
    await vi.advanceTimersByTimeAsync(300);
    expect(await w).toBe(false);
    audio.resumable = true;
    expect(await NV.warm()).toBe(true);
  });

  it("fails with `decode` for audio Web Audio cannot read, and for what is not base64", async () => {
    audio.decodeFails = true;
    let NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    expect(calls).toEqual(["fail:decode"]);
    expect(audio.sources).toHaveLength(0);

    audio.decodeFails = false;
    NV = load();
    for (const bad of ["", "not base64!", null, 42]) {
      NV.play({ audioBase64: bad, onStart: () => calls.push("start"), onFail: (w) => calls.push(`fail:${w}`) });
      await settle(); // one at a time: the next play would stop this one before it says anything
    }
    expect(calls).toEqual(["fail:decode", "fail:decode", "fail:decode", "fail:decode", "fail:decode"]);
  });

  it("fails with `decode` for empty audio (no duration)", async () => {
    audio.duration = 0;
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    expect(calls).toEqual(["fail:decode"]);
  });

  it("fails with `unsupported` without Web Audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    expect(calls).toEqual(["fail:unsupported"]);
    expect(await NV.warm()).toBe(false);
  });

  it("stop() stops the source at once and says nothing more", async () => {
    const NV = load();
    const calls: string[] = [];
    const levels: number[] = [];
    const stop = NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onLevel: (l) => levels.push(l), onEnd: () => calls.push("end"), onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    flushFrames(2);
    stop();
    const [src] = audio.sources;
    expect(src.stopped).toBe(true);
    expect(src.onended).toBeNull();
    expect(NV.playing()).toBe(false);
    flushFrames(3);
    expect(levels).toHaveLength(2);
    expect(calls).toEqual(["start"]);
    stop(); // twice is fine
  });

  it("stop() before the audio is decoded: nothing plays and nothing is said", async () => {
    const NV = load();
    const calls: string[] = [];
    const stop = NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onEnd: () => calls.push("end"), onFail: (w) => calls.push(`fail:${w}`) });
    stop();
    await settle();
    expect(calls).toEqual([]);
    expect(audio.sources).toHaveLength(0);
  });

  it("one at a time: a new play stops the last, silently", async () => {
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("first"), onEnd: () => calls.push("first end"), onFail: () => calls.push("first fail") });
    await settle();
    NV.play({ audioBase64: sound, onStart: () => calls.push("second") });
    await settle();
    expect(calls).toEqual(["first", "second"]);
    expect(audio.sources[0].stopped).toBe(true);
    expect(audio.sources[1].started).toBe(true);
    expect(audio.contexts).toHaveLength(1); // the one context, reused
  });

  it("a failure once heard ends it (onEnd), never onFail, so the computer voice does not start it again", async () => {
    vi.stubGlobal("requestAnimationFrame", () => { throw new Error("no frames"); });
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start"), onEnd: () => calls.push("end"), onFail: (w) => calls.push(`fail:${w}`) });
    await settle();
    expect(calls).toEqual(["start", "end"]);
    expect(audio.sources[0].stopped).toBe(true);
    expect(NV.playing()).toBe(false);
  });

  it("a callback that throws never breaks the player", async () => {
    const NV = load();
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => { calls.push("start"); throw new Error("the page's own trouble"); }, onLevel: () => { throw new Error("again"); }, onEnd: () => calls.push("end") });
    await settle();
    flushFrames(3);
    expect(NV.playing()).toBe(true);
    audio.sources[0].onended?.();
    expect(calls).toEqual(["start", "end"]);
  });

  it("a slow wake-up costs one utterance only: the natural voice stays on, and the context sleeps again (review, 9 October 2026)", async () => {
    vi.useFakeTimers();
    audio.initial = "suspended";
    audio.resumable = false;
    const NV = load();
    const w = NV.warm();
    await vi.advanceTimersByTimeAsync(300);
    expect(await w).toBe(false); // this utterance: the computer voice
    // The output wakes a second later (AirPods): still supported, and back to sleep after IDLE_MS as nothing plays.
    audio.contexts[0].state = "running";
    await vi.advanceTimersByTimeAsync(1_700);
    expect(NV.supported).toBe(true);
    await vi.advanceTimersByTimeAsync(NV.T.IDLE_MS);
    expect(audio.contexts[0].state).toBe("suspended");
  });

  it("a context that never runs (or refuses) turns the natural voice off for the run", async () => {
    vi.useFakeTimers();
    audio.initial = "suspended";
    audio.resumable = false;
    let NV = load();
    void NV.warm();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(NV.supported).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(NV.supported).toBe(false);

    NV = load();
    const Ctx = FakeContext.prototype.resume;
    FakeContext.prototype.resume = function () { return Promise.reject(new Error("NotAllowedError")); };
    try {
      expect(await NV.warm()).toBe(false);
      expect(NV.supported).toBe(false);
    } finally { FakeContext.prototype.resume = Ctx; }
  });

  it("release() lets a warmed context sleep when nothing is going to play (a refusal, a hush)", async () => {
    vi.useFakeTimers();
    const NV = load();
    expect(await NV.warm()).toBe(true);
    await vi.advanceTimersByTimeAsync(NV.T.IDLE_MS * 3);
    expect(audio.contexts[0].state).toBe("running"); // warmed for an answer on its way
    NV.release();
    await vi.advanceTimersByTimeAsync(NV.T.IDLE_MS);
    expect(audio.contexts[0].state).toBe("suspended");
  });

  it("goes quiet a moment after the last utterance (the context is suspended), and wakes for the next", async () => {
    vi.useFakeTimers();
    const NV = load();
    NV.play({ audioBase64: sound });
    await vi.advanceTimersByTimeAsync(0);
    audio.sources[0].onended?.();
    await vi.advanceTimersByTimeAsync(NV.T.IDLE_MS);
    expect(audio.contexts[0].state).toBe("suspended");
    const calls: string[] = [];
    NV.play({ audioBase64: sound, onStart: () => calls.push("start") });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["start"]);
    expect(audio.contexts[0].state).toBe("running");
  });
});
