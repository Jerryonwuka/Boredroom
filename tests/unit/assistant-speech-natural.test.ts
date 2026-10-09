import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LEVEL_FLOOR, rmsLevel, speakingLevel } from "@/lib/assistant-speech/level";
import { NATURAL_WORDS, formatResetDate, naturalVoiceNote } from "@/lib/assistant-speech/natural-words";
import type { NaturalVoiceReason, SpeechOffer } from "@/lib/natural-voices";

// Natural voice on the web (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F and H): the level
// maths her faces follow, the words that say why the computer voice speaks instead, and the controller's natural path
// with stubbed browser objects (fetch, Audio, AudioContext, MediaSource, requestAnimationFrame, speech synthesis). Nothing
// here reaches ElevenLabs or our server: fetch is always a fake.

describe("level: the loudness of the real audio", () => {
  it("is the root mean square of the waveform, from 0 to 1", () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array(1024))).toBe(0);
    expect(rmsLevel(new Float32Array(1024).fill(0.5))).toBeCloseTo(0.5, 6);
    const sine = Float32Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * i) / 64));
    expect(rmsLevel(sine)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(rmsLevel(new Float32Array(16).fill(2))).toBe(1);
    expect(rmsLevel([0.5, Number.NaN, 0.5, Number.NaN])).toBeCloseTo(Math.sqrt(0.125), 6);
  });

  it("rises fast and falls slower, so ordinary speech peaks near 0.8 to 1", () => {
    // A steady RMS of 0.15 (ordinary speech) settles at 0.9.
    let level = LEVEL_FLOOR;
    for (let t = 0; t < 300; t += 16) level = speakingLevel(level, 0.15, 16);
    expect(level).toBeGreaterThan(0.85);
    expect(level).toBeLessThanOrEqual(1);
    // Attack: 30 ms covers about 63% of the way up.
    const up = speakingLevel(LEVEL_FLOOR, 0.15, 30);
    expect(up).toBeCloseTo(LEVEL_FLOOR + (0.9 - LEVEL_FLOOR) * (1 - Math.exp(-1)), 6);
    // Decay: 30 ms of silence after a peak takes off much less than an attack puts on.
    const down = speakingLevel(0.9, 0, 30);
    expect(0.9 - down).toBeLessThan(up - LEVEL_FLOOR);
    expect(down).toBeGreaterThan(0.6);
  });

  it("never drops under the floor while she speaks, never goes over 1, and holds still with no time passing", () => {
    expect(speakingLevel(0.9, 0, 5000)).toBe(LEVEL_FLOOR);
    expect(speakingLevel(0, 0, 16)).toBe(LEVEL_FLOOR);
    expect(speakingLevel(0.5, 1, 10000)).toBeCloseTo(1, 6);
    expect(speakingLevel(1, 1, 16)).toBe(1);
    expect(speakingLevel(0.5, 0.15, 0)).toBe(0.5);
    expect(speakingLevel(Number.NaN, Number.NaN, Number.NaN)).toBe(LEVEL_FLOOR);
  });
});

describe("naturalVoiceNote: why the computer voice speaks instead", () => {
  const cases: [NaturalVoiceReason, string][] = [
    ["not_ready", "Natural voices need a database update first. Max uses the computer voice until then."],
    ["no_key", "Natural voices aren't set up for this workspace yet, so Max uses the computer voice."],
    ["key_rejected", "ElevenLabs refused the workspace's key, so Max uses the computer voice. An owner or HR can check it in Settings."],
    ["person_cap", "You've used today's natural voice, so Max uses the computer voice until tomorrow."],
    ["workspace_cap", "Your workspace has used today's natural voice, so Max uses the computer voice until tomorrow."],
    ["shared_cap", "Today's natural voice allowance, shared by the workspaces on Boredroom's key, is used up, so Max uses the computer voice until tomorrow."],
    ["upstream", "ElevenLabs didn't answer just now, so Max used the computer voice."],
  ];
  it.each(cases)("%s", (reason, words) => {
    expect(naturalVoiceNote(reason, "Max")).toBe(words);
  });

  it("allowance_low names the reset date when it has one", () => {
    expect(naturalVoiceNote("allowance_low", "Max", "2026-11-09T07:47:00Z", "UTC"))
      .toBe("This month's natural voice allowance is nearly used up, so Max uses the computer voice until it resets on 9 November 2026.");
    expect(naturalVoiceNote("allowance_low", "Max", null)).toBe("This month's natural voice allowance is nearly used up, so Max uses the computer voice until it resets.");
    expect(naturalVoiceNote("allowance_low", "Max", "not a date")).toBe("This month's natural voice allowance is nearly used up, so Max uses the computer voice until it resets.");
  });

  it("says nothing for Voice off, no voice chosen or none at all", () => {
    expect(naturalVoiceNote("voice_off", "Max")).toBeNull();
    expect(naturalVoiceNote("no_voice", "Max")).toBeNull();
    expect(naturalVoiceNote(null, "Max")).toBeNull();
  });

  it("keeps the owner's privacy line and the usage words exact", () => {
    expect(NATURAL_WORDS.privacy).toBe("Natural voices are made by ElevenLabs: the words your assistant says are sent to ElevenLabs to turn into speech.");
    expect(formatResetDate("2026-11-09T07:47:00Z", "UTC")).toBe("9 November 2026");
    expect(NATURAL_WORDS.connection.usedValue(1234, 38373)).toBe("1,234 of 38,373");
    expect(NATURAL_WORDS.connection.workspaceValue(312, 1237, 4560)).toBe("312 today of a 1,237 share; 4,560 this month");
    expect(NATURAL_WORDS.connection.personValue(2000)).toBe("Up to 2,000 characters a day");
    expect(NATURAL_WORDS.connection.organisationLine("…ab12", "9 October 2026")).toBe("Your workspace's key, ending …ab12, connected 9 October 2026");
  });

  it("calls ElevenLabs' allowance credits, and counts what couldn't be deleted from the key's history (fix review, 9 October 2026)", () => {
    expect(NATURAL_WORDS.connection.used).toBe("Credits used");
    expect(NATURAL_WORDS.connection.usedText(1234, 38373)).toBe("1,234 of 38,373 credits");
    expect(NATURAL_WORDS.connection.historyLeft(1)).toMatch(/^One thing said aloud in the last 30 days couldn't be deleted .* You can delete it in ElevenLabs, under History\.$/);
    expect(NATURAL_WORDS.connection.historyLeft(1200)).toMatch(/^1,200 things said aloud .* can read them there\. You can delete them in ElevenLabs, under History\.$/);
    expect(NATURAL_WORDS.connection.keyHint).toContain("History (read and write)");
    expect(NATURAL_WORDS.connection.historyBlocked).toContain("History (read and write)");
  });
});

// ---- the controller's natural path, with stubbed browser objects -------------------------------------------------

type Controller = typeof import("@/lib/assistant-speech/controller");
type Natural = typeof import("@/lib/assistant-speech/natural");
type Recorder = typeof import("@/hooks/use-voice-recorder");

const objects = new Map<string, unknown>();
let urlCount = 0;
let revoked: string[] = [];

class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  /** What the next play() does. */
  static next: "resolve" | "reject" = "resolve";
  attrs = new Map<string, string>();
  paused = true;
  ended = false;
  preload = "";
  disableRemotePlayback = false;
  plays: string[] = [];
  pauses = 0;
  loads = 0;
  constructor() { super(); FakeAudio.all.push(this); }
  get src() { return this.attrs.get("src") ?? ""; }
  set src(v: string) {
    this.attrs.set("src", v);
    const ms = objects.get(v);
    if (ms instanceof FakeMediaSource) queueMicrotask(() => ms.open());
  }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  removeAttribute(n: string) { this.attrs.delete(n); }
  play() {
    this.plays.push(this.src);
    if (FakeAudio.next === "reject") return Promise.reject(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.pauses++; this.paused = true; }
  load() { this.loads++; }
  fire(type: string) {
    if (type === "ended") { this.ended = true; this.paused = true; }
    this.dispatchEvent(new Event(type));
  }
}

class FakeSourceBuffer extends EventTarget {
  updating = false;
  chunks: Uint8Array[] = [];
  appendBuffer(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.updating = true;
    queueMicrotask(() => { this.updating = false; this.dispatchEvent(new Event("updateend")); });
  }
}

class FakeMediaSource extends EventTarget {
  static all: FakeMediaSource[] = [];
  static supported = true;
  static isTypeSupported(type: string) { return FakeMediaSource.supported && type === "audio/mpeg"; }
  readyState: "closed" | "open" | "ended" = "closed";
  buffers: FakeSourceBuffer[] = [];
  endings = 0;
  constructor() { super(); FakeMediaSource.all.push(this); }
  open() { this.readyState = "open"; this.dispatchEvent(new Event("sourceopen")); }
  addSourceBuffer(type: string) {
    if (type !== "audio/mpeg") throw new Error("type");
    const sb = new FakeSourceBuffer();
    this.buffers.push(sb);
    return sb;
  }
  endOfStream() { this.endings++; this.readyState = "ended"; }
}

class FakeAnalyser {
  static amplitude = 0;
  fftSize = 2048;
  connect() { return this; }
  getFloatTimeDomainData(buf: Float32Array) { buf.fill(FakeAnalyser.amplitude); }
}

class FakeAudioContext {
  static all: FakeAudioContext[] = [];
  static initial: AudioContextState = "running";
  state: AudioContextState = FakeAudioContext.initial;
  sources = 0;
  destination = {};
  constructor() { FakeAudioContext.all.push(this); }
  suspends = 0;
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.suspends++; this.state = "suspended"; return Promise.resolve(); }
  createMediaElementSource() { this.sources++; return { connect: (n: unknown) => n }; }
  createAnalyser() { return new FakeAnalyser(); }
}

class FakeUtterance {
  voice: unknown = null; lang = ""; rate = 1; volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: ((e: { charIndex: number; charLength: number }) => void) | null = null;
  constructor(public text: string) {}
}

class FakeSynth {
  spoken: FakeUtterance[] = [];
  cancels = 0;
  speaking = false;
  pending = false;
  voices = [{ voiceURI: "Daniel", name: "Daniel", lang: "en-GB", localService: true, default: true }];
  getVoices() { return this.voices; }
  addEventListener() {}
  speak(u: FakeUtterance) { this.spoken.push(u); }
  cancel() { this.cancels++; }
}

const OFFER: SpeechOffer = { path: "/api/orgs/company-a/assistant/speech", token: "signed.token.value", text: "Hello there. All done." };
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 1, 2, 3, 4]);
const audio = () => FakeAudio.all[0];

let speech: Controller["speech"];
let natural: Natural;
let recorder: Recorder;
let synth: FakeSynth | null;
let frames: FrameRequestCallback[] = [];
let clock = 0;
let levels: number[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** Lets every pending promise and microtask run (real timers). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
/** Runs `n` animation frames, 16 ms apart. */
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    clock += 16;
    const due = frames;
    frames = [];
    due.forEach((f) => f(clock));
  }
}

function install({ voices = true }: { voices?: boolean } = {}) {
  FakeAudio.all = []; FakeAudio.next = "resolve";
  FakeMediaSource.all = []; FakeMediaSource.supported = true;
  FakeAudioContext.all = []; FakeAudioContext.initial = "running";
  FakeAnalyser.amplitude = 0;
  objects.clear(); urlCount = 0; revoked = [];
  frames = []; clock = 1000; levels = [];
  synth = voices ? new FakeSynth() : null;
  const win: Record<string, unknown> = {
    Audio: FakeAudio, AudioContext: FakeAudioContext, MediaSource: FakeMediaSource,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
  if (synth) win.speechSynthesis = synth;
  vi.stubGlobal("window", win);
  if (synth) vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(URL, "createObjectURL").mockImplementation((o: Blob | MediaSource) => { const url = `blob:test/${++urlCount}`; objects.set(url, o); return url; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => { revoked.push(url); });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
}

const audioAnswer = () => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
const refusal = (status: number, reason: string) => new Response(JSON.stringify({ code: "VOICE_UNAVAILABLE", message: "No.", details: { reason } }), { status, headers: { "content-type": "application/json" } });

/** Every snapshot from now on, for checking that Listen never flickers back to idle during a fallback. */
function watch() {
  const seen: ReturnType<Controller["speech"]["getSnapshot"]>[] = [];
  speech.subscribe(() => seen.push(speech.getSnapshot()));
  return seen;
}

describe("the controller's natural voice", () => {
  beforeEach(async () => {
    vi.resetModules();
    install();
    ({ speech } = await import("@/lib/assistant-speech/controller"));
    natural = await import("@/lib/assistant-speech/natural");
    recorder = await import("@/hooks/use-voice-recorder");
    speech.subscribeLevel((l) => levels.push(l));
  });
  afterEach(() => {
    speech.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams the reply from our own route, plays it, follows the real audio and ends", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    expect(speech.speak("Hello there. **All** done.", { id: "r1", natural: OFFER })).toBe(true);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, talking: false, id: "r1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(OFFER.path);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init.body))).toEqual({ token: OFFER.token, text: OFFER.text, speed: "normal" });

    await settle();
    const ms = FakeMediaSource.all[0];
    expect(ms).toBeDefined();
    expect(ms.buffers[0].chunks.map((c) => c.byteLength).reduce((a, b) => a + b, 0)).toBe(MP3.byteLength);
    expect(ms.endings).toBe(1);
    const url = audio().plays.at(-1)!;
    expect(objects.get(url)).toBe(ms);
    // Routed through the analyser once the context runs.
    expect(FakeAudioContext.all[0].sources).toBe(1);

    // Nothing on her faces until the audio starts.
    tick(2);
    expect(levels.at(-1)).toBe(0);
    audio().fire("playing");
    expect(speech.getSnapshot().talking).toBe(true);
    FakeAnalyser.amplitude = 0.15;
    levels = [];
    tick(12);
    expect(levels.length).toBe(12);
    expect(levels[0]).toBeGreaterThan(LEVEL_FLOOR);
    expect(levels.at(-1)).toBeGreaterThan(0.8);
    expect(speech.level()).toBeCloseTo(levels.at(-1)!, 6);
    FakeAnalyser.amplitude = 0;
    tick(40);
    expect(levels.at(-1)).toBe(LEVEL_FLOOR);

    audio().fire("ended");
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, talking: false, id: null, naturalFailed: null });
    tick();
    expect(levels.at(-1)).toBe(0);
    expect(revoked).toContain(url);
    expect(synth!.spoken).toHaveLength(0);
  });

  it("sends the chosen speed", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello.", { id: "r1", natural: OFFER, speed: "faster" });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).speed).toBe("faster");
  });

  it.each([
    [409, "person_cap"],
    [409, "workspace_cap"],
    [409, "shared_cap"],
    [409, "allowance_low"],
    [502, "upstream"],
    [502, "key_rejected"],
  ])("falls back to the computer voice in place on a %i (%s), keeping the reason", async (status, reason) => {
    const seen = watch();
    fetchMock.mockResolvedValue(refusal(status, reason));
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    await settle();
    expect(synth!.spoken.map((u) => u.text)).toEqual(["Hello there.", "All done."]);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1", naturalFailed: reason });
    // Listen never went back to idle in between (the same utterance went on).
    const after = seen.slice(seen.findIndex((s) => s.speaking));
    expect(after.every((s) => s.speaking && s.id === "r1")).toBe(true);
    synth!.spoken[0].onstart!();
    expect(speech.getSnapshot().talking).toBe(true);
    synth!.spoken[0].onend!();
    synth!.spoken[1].onend!();
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null, naturalFailed: reason });
    expect(audio()?.plays ?? []).toHaveLength(0);
  });

  it("falls back when a refusal carries no reason we know, with no reason kept", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "SPEECH_TOKEN", message: "This reply can't be said aloud any more." }), { status: 400 }));
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1", naturalFailed: null });
  });

  it("falls back when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1" });
  });

  it("falls back when our route sends no headers within 15 seconds, and aborts the request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_: string, init: RequestInit) => new Promise((_, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    // A slow link (review, 9 October 2026): at 6 and 8 seconds she is still getting ready, not falling back.
    await vi.advanceTimersByTimeAsync(8000);
    expect(signal?.aborted).toBe(false);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, talking: false, id: "r1", naturalFailed: null });
    await vi.advanceTimersByTimeAsync(6900);
    expect(synth!.spoken).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(signal?.aborted).toBe(true);
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1", naturalFailed: "upstream" });
  });

  it("Stop while the audio is still on its way aborts the request at once, and nothing speaks", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_: string, init: RequestInit) => new Promise((_, reject) => {
      signal = init.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await vi.advanceTimersByTimeAsync(10_000);
    speech.stop();
    expect(signal?.aborted).toBe(true);
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(synth!.spoken).toHaveLength(0);
  });

  it("keeps playing a reply past 15 seconds once its headers came (review, 9 October 2026)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_: string, init: RequestInit) => { signal = init.signal ?? undefined; return Promise.resolve(audioAnswer()); });
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await vi.advanceTimersByTimeAsync(50);
    audio().fire("playing");
    const pauses = audio().pauses;
    // Long after HEADERS_MS: still talking, the request not aborted, the element not paused, nothing else speaking.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, talking: true, id: "r1", naturalFailed: null });
    expect(signal?.aborted).toBe(false);
    expect(audio().pauses).toBe(pauses);
    expect(synth!.spoken).toHaveLength(0);
    audio().fire("ended");
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null });
  });

  it("keeps playing a whole-body reply past 15 seconds once the body was read (review, 9 October 2026)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeMediaSource.supported = false;
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await vi.advanceTimersByTimeAsync(50);
    audio().fire("playing");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, talking: true, id: "r1", naturalFailed: null });
    expect(synth!.spoken).toHaveLength(0);
  });

  it("falls back when no audio starts within 4 seconds of the answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await vi.advanceTimersByTimeAsync(10);
    expect(audio().plays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4100);
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1" });
    expect(audio().getAttribute("src")).toBeNull();
  });

  it("falls back when the browser refuses to play", async () => {
    FakeAudio.next = "reject";
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r1", naturalFailed: null });
    expect(revoked.length).toBeGreaterThan(0);
  });

  it("ends (no restart) when the audio fails after it began", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    audio().fire("playing");
    audio().fire("error");
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null });
    expect(synth!.spoken).toHaveLength(0);
  });

  it("Stop while the request is on its way aborts it, and nothing plays after", async () => {
    let signal: AbortSignal | undefined;
    let answer: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation((_: string, init: RequestInit) => { signal = init.signal ?? undefined; return new Promise<Response>((r) => { answer = r; }); });
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    speech.stop();
    expect(signal?.aborted).toBe(true);
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null });
    answer(audioAnswer());
    await settle();
    expect(FakeMediaSource.all).toHaveLength(0);
    expect(synth!.spoken).toHaveLength(0);
  });

  it("Stop while it plays pauses and empties the element, ends the stream and revokes the URL", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      // A stream that stays open (more audio on its way).
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(MP3); } }), { status: 200 }));
    });
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    const url = audio().plays.at(-1)!;
    const ms = FakeMediaSource.all[0];
    expect(ms.readyState).toBe("open");
    audio().fire("playing");
    speech.stop();
    expect(signal?.aborted).toBe(true);
    expect(audio().pauses).toBeGreaterThan(0);
    expect(audio().getAttribute("src")).toBeNull();
    expect(ms.endings).toBe(1);
    expect(revoked).toContain(url);
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, talking: false, id: null });
    expect(synth!.spoken).toHaveLength(0);
  });

  it("a chat's own stop (by prefix) reaches its natural reply", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "chat1:3", natural: OFFER });
    await settle();
    audio().fire("playing");
    speech.stop("chat2:");
    expect(speech.getSnapshot().speaking).toBe(true);
    speech.stop("chat1:");
    expect(speech.getSnapshot().speaking).toBe(false);
  });

  it("never plays with the microphone open, and stops when one opens", async () => {
    const release = recorder.shareMicrophone({} as MediaStream);
    expect(speech.speak("Hello there.", { id: "r1", natural: OFFER })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    release();

    fetchMock.mockResolvedValue(audioAnswer());
    expect(speech.speak("Hello there.", { id: "r1", natural: OFFER })).toBe(true);
    await settle();
    audio().fire("playing");
    recorder.shareMicrophone({} as MediaStream);
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null });
    expect(audio().getAttribute("src")).toBeNull();
    expect(synth!.spoken).toHaveLength(0);
  });

  it("asking for the microphone stops it too", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    recorder.askingForMicrophone();
    expect(speech.getSnapshot().speaking).toBe(false);
  });

  it("reads the whole answer into a Blob where MediaSource can't take mp3", async () => {
    FakeMediaSource.supported = false;
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    const url = audio().plays.at(-1)!;
    const blob = objects.get(url) as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBe(MP3.byteLength);
    audio().fire("playing");
    audio().fire("ended");
    expect(revoked).toContain(url);
  });

  it("plays without Web Audio (the level is made up then)", async () => {
    vi.stubGlobal("window", { ...(window as unknown as Record<string, unknown>), AudioContext: undefined });
    vi.resetModules();
    ({ speech } = await import("@/lib/assistant-speech/controller"));
    speech.subscribeLevel((l) => levels.push(l));
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r1", natural: OFFER });
    await settle();
    FakeAudio.all.at(-1)!.fire("playing");
    levels = [];
    tick(60);
    expect(Math.max(...levels)).toBeGreaterThan(0.3);
  });

  it("falls back when the AudioContext it already plays through won't run", async () => {
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello.", { id: "r1", natural: OFFER });
    await settle();
    audio().fire("playing");
    audio().fire("ended");
    expect(FakeAudioContext.all[0].sources).toBe(1);
    // Suspended for good now (Safari backgrounded the page): playing would be silent.
    const ctx = FakeAudioContext.all[0];
    ctx.state = "suspended";
    ctx.resume = () => new Promise<void>(() => undefined);
    fetchMock.mockResolvedValue(audioAnswer());
    speech.speak("Hello there.", { id: "r2", natural: OFFER });
    await new Promise((r) => setTimeout(r, 350));
    expect(synth!.spoken).toHaveLength(1);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "r2" });
  });

  it("with no computer voice, a failed natural reply ends quietly as blocked", async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    install({ voices: false });
    ({ speech } = await import("@/lib/assistant-speech/controller"));
    fetchMock.mockResolvedValue(refusal(502, "upstream"));
    expect(speech.speak("Hello there.", { id: "r1", natural: OFFER })).toBe(true);
    expect(speech.getSnapshot().supported).toBe(false);
    await settle();
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, id: null, blocked: "r1", naturalFailed: "upstream" });
  });

  it("never fetches an offer whose path is not our own speech route", () => {
    for (const path of ["https://api.elevenlabs.io/v1/text-to-speech/x/stream", "//evil.example/api/orgs/a/assistant/speech", "/api/orgs/a/assistant/speech?x=1", "/api/orgs/a/brenda/undo"]) {
      speech.speak("Hello there.", { id: "r1", natural: { ...OFFER, path } });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(synth!.spoken.length).toBeGreaterThan(0); // the computer voice said it
      speech.stop();
      synth!.spoken = [];
    }
  });

  it("plays a sample from our own sample route through the same voice", async () => {
    const path = "/api/orgs/company-a/assistant/voice/samples/Xb7hH8MSUJpSbSDYk0k2";
    expect(speech.playSample(path, { id: "natural-sample:Xb7hH8MSUJpSbSDYk0k2" })).toBe(true);
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, id: "natural-sample:Xb7hH8MSUJpSbSDYk0k2" });
    await settle();
    expect(audio().plays).toEqual([path]);
    expect(fetchMock).not.toHaveBeenCalled();
    audio().fire("playing");
    expect(speech.getSnapshot().talking).toBe(true);
    audio().fire("ended");
    expect(speech.getSnapshot().speaking).toBe(false);

    expect(speech.playSample("https://storage.googleapis.com/eleven-public-prod/x.mp3", { id: "s" })).toBe(false);
    expect(speech.playSample("/api/orgs/a/assistant/voice/samples/../../x", { id: "s" })).toBe(false);
  });

  it("a sample that can't play ends as blocked, with no computer voice standing in", async () => {
    speech.playSample("/api/orgs/company-a/assistant/voice/samples/Xb7hH8MSUJpSbSDYk0k2", { id: "natural-sample:x" });
    await settle();
    audio().fire("error");
    expect(speech.getSnapshot()).toMatchObject({ speaking: false, blocked: "natural-sample:x" });
    expect(synth!.spoken).toHaveLength(0);
  });

  it("prime unlocks the element once with a silent WAV made in memory", async () => {
    speech.prime({ natural: true });
    expect(FakeAudioContext.all).toHaveLength(1);
    const first = audio().plays;
    expect(first).toHaveLength(1);
    const wav = objects.get(first[0]) as Blob;
    expect(wav.type).toBe("audio/wav");
    speech.prime();
    expect(audio().plays).toHaveLength(1);
    const bytes = natural.silentWav();
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(bytes.byteLength).toBe(44 + 800);
    expect(bytes.slice(44).every((b) => b === 0)).toBe(true);
  });

  it("a page on the computer voice starts no audio context (review, 9 October 2026)", () => {
    speech.prime();
    speech.prime();
    expect(FakeAudioContext.all).toHaveLength(0);
    expect(audio().plays).toHaveLength(1); // the element is still unlocked, once
  });

  it("puts the context to sleep a moment after a natural utterance, and wakes it for the next", async () => {
    fetchMock.mockImplementation(async () => audioAnswer());
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    await settle(); await settle();
    audio().fire("playing");
    audio().fire("ended");
    const ctx = FakeAudioContext.all[0];
    expect(ctx.state).toBe("running");
    await new Promise((r) => setTimeout(r, natural.IDLE_MS + 50));
    expect(ctx.suspends).toBe(1);
    expect(ctx.state).toBe("suspended");
    // A later press for a natural voice resumes it (and it sleeps again if nothing plays).
    speech.prime({ natural: true });
    expect(ctx.state).toBe("running");
    await new Promise((r) => setTimeout(r, natural.IDLE_MS + 50));
    expect(ctx.suspends).toBe(2);
  }, 10_000);

  it("Listen again plays the same reply from memory: no second request, no characters spent again", async () => {
    fetchMock.mockImplementation(async () => audioAnswer());
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    await settle(); await settle();
    audio().fire("playing");
    audio().fire("ended");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    await settle(); await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = audio().plays.at(-1)!;
    const kept = objects.get(url) as Blob;
    expect(kept).toBeInstanceOf(Blob);
    expect(kept.type).toBe("audio/mpeg");
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(MP3);
    audio().fire("playing");
    expect(speech.getSnapshot()).toMatchObject({ speaking: true, talking: true, id: "r1" });
    audio().fire("ended");
    expect(revoked).toContain(url);

    // Another speed is other audio: asked for.
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER, speed: "faster" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing of an utterance stopped before all of it arrived", async () => {
    let push: ((b: Uint8Array) => void) | null = null;
    fetchMock.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { push = (b) => c.enqueue(b); } }), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    await settle(); await settle();
    push!(MP3);
    await settle();
    speech.stop();
    fetchMock.mockImplementation(async () => audioAnswer());
    speech.speak("Hello there. All done.", { id: "r1", natural: OFFER });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
