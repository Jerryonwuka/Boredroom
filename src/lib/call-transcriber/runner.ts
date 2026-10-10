"use client";

/**
 * Writes the person's own words down on their own device during a call and sends only the text (owner decisions,
 * 8 October 2026: phase 8, Brenda's notes on calls; contract E.3). Started by `CallNotesRunner` only while notes are on,
 * this person said "Include me", they are connected and their microphone is published; stopped on any change.
 *
 * - Both engines listen to the CALL's microphone track (LiveKit's published, echo-cancelled track), never a second
 *   getUserMedia: other people's voices from the speakers are cancelled out of it, so someone who said "Not me" is not
 *   written down on another person's device.
 * - Muted (the track muted or disabled), or stopped: nothing is recorded; a segment in progress is discarded, never sent.
 * - Lines go to POST /calls/:id/lines, up to 10 at a time, at most every 5 s (sooner at 5 waiting); network errors, 429
 *   and 503 are retried 3 times with backoff; "no consent", "notes off", "not in the call" and "not found" stop it for
 *   good. No audio, no recording, no sample ever leaves the tab. Text is never logged.
 */
import { NOTES_LIMITS, type EngineKind } from "@/lib/call-notes";
import { chooseEngine, forgetEngine, notesLang, recognitionCtor, type LocalRecognition } from "./engine";
import { cleanLine } from "./filter";
import { createSegmenter, lineAt, lineSeq, pushBounded, rmsOf, serverSkew, SEGMENT } from "./segmenter";

export type Line = { seq: number; at: number; text: string };
export type StopReason = "no_consent" | "notes_off" | "not_in_call" | "not_found" | "failed";
export type RunnerStatus =
  | { kind: "preparing"; mb: number; fraction: number }
  | { kind: "local"; engine: EngineKind }
  | { kind: "none" }
  | { kind: "behind" }
  | { kind: "muted" }
  | { kind: "stopped"; reason: StopReason };

// ---- Sending -----------------------------------------------------------------------------------------------------------

/** What a POST answered: ok, a reason to stop for good, or worth trying again. */
export type PostResult = { ok: true } | { ok: false; stop: StopReason } | { ok: false; retry: true };
export type LineSender = { add(line: Line): void; flush(): Promise<void>; close(): void; readonly stopped: StopReason | null; readonly waiting: number };

/** The route's error codes that stop the runner for good (409/403/404). */
export function stopReasonOf(status: number, code: string | undefined): StopReason | null {
  switch (code) {
    case "NO_CONSENT": return "no_consent";
    case "NOTES_OFF": return "notes_off";
    case "NOT_IN_CALL": return "not_in_call";
    case "NOT_FOUND": return "not_found";
    case "CALL_ENDED": return "not_in_call";
    case "TOO_MANY_LINES": return "failed";
    default: break;
  }
  if (status === 404) return "not_found";
  if (status === 403 || status === 409 || status === 422 || status === 400 || status === 401) return "failed";
  return null;
}

/**
 * The queue of lines and its POSTs (pure apart from the injected `post` and timers, so it is unit-tested). Lines wait at
 * most `postEveryMs`; five waiting send at once; one POST at a time.
 */
export function createLineSender(o: {
  post: (lines: Line[]) => Promise<PostResult>;
  onStop: (reason: StopReason) => void;
  everyMs?: number; soonAt?: number; batch?: number; retries?: number; backoffMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void;
}): LineSender {
  const everyMs = o.everyMs ?? NOTES_LIMITS.postEveryMs;
  const soonAt = o.soonAt ?? 5;
  const batch = o.batch ?? NOTES_LIMITS.linesPerRequest;
  const retries = o.retries ?? 3;
  const backoffMs = o.backoffMs ?? 1_000;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const queue: Line[] = [];
  let timer: unknown = null;
  let sending: Promise<void> | null = null;
  let stopped: StopReason | null = null;
  let closed = false;

  const stop = (reason: StopReason) => {
    if (stopped) return;
    stopped = reason;
    queue.length = 0;
    if (timer) { clearTimer(timer); timer = null; }
    o.onStop(reason);
  };

  const sendOnce = async (): Promise<void> => {
    while (queue.length && !stopped) {
      const lines = queue.slice(0, batch);
      let attempt = 0;
      for (;;) {
        const r = await o.post(lines).catch((): PostResult => ({ ok: false, retry: true }));
        if (r.ok) break;
        if ("stop" in r) { stop(r.stop); return; }
        if (++attempt > retries) { stop("failed"); return; }
        await new Promise<void>((res) => setTimer(res, backoffMs * 2 ** (attempt - 1)));
        if (stopped) return;
      }
      queue.splice(0, lines.length);
      if (queue.length < soonAt) break;
    }
  };

  const flush = async () => {
    if (timer) { clearTimer(timer); timer = null; }
    if (sending) { await sending; }
    if (!queue.length || stopped) return;
    sending = sendOnce().finally(() => { sending = null; });
    await sending;
    if (queue.length && !stopped && !closed) schedule();
  };

  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimer(() => { timer = null; void flush(); }, everyMs);
  };

  return {
    get stopped() { return stopped; },
    get waiting() { return queue.length; },
    add(line: Line) {
      if (stopped) return;
      queue.push(line);
      if (queue.length >= soonAt && !sending) void flush();
      else schedule();
    },
    flush,
    close() { closed = true; if (timer) { clearTimer(timer); timer = null; } },
  };
}

/** The real POST, as the person (same-origin cookie). Never logs the text. */
export function postLinesTo(orgSlug: string, callId: string): (lines: Line[]) => Promise<PostResult> {
  return async (lines) => {
    let res: Response;
    try {
      res = await fetch(`/api/orgs/${encodeURIComponent(orgSlug)}/calls/${encodeURIComponent(callId)}/lines`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ lines }),
      });
    } catch { return { ok: false, retry: true }; }
    if (res.ok) return { ok: true };
    if (res.status === 429 || res.status === 503 || res.status >= 500) return { ok: false, retry: true };
    const data = await res.json().catch(() => null) as { code?: string } | null;
    return { ok: false, stop: stopReasonOf(res.status, data?.code ?? undefined) ?? "failed" };
  };
}

// ---- Running -------------------------------------------------------------------------------------------------------------

export type RunnerOptions = {
  orgSlug: string;
  callId: string;
  /** The call's start (`CallView.startedAt`) and the server's clock when the view arrived (`serverNow`, `receivedAt`). */
  callStartedAt: string;
  serverNow: string;
  receivedAt: number;
  micTrack: MediaStreamTrack;
  onStatus: (s: RunnerStatus) => void;
};
export type Runner = { stop(): void };

const isMuted = (t: MediaStreamTrack) => t.muted || !t.enabled || t.readyState === "ended";

/** Starts writing down. Answers a handle whose `stop()` ends everything and discards anything not yet transcribed. */
export function startCallNotes(o: RunnerOptions): Runner {
  const skew = serverSkew(o.serverNow, o.receivedAt);
  let running = true;
  let lastSeq = -1;
  const cleanups: (() => void)[] = [];
  const status = (s: RunnerStatus) => { if (running || s.kind === "stopped") o.onStatus(s); };
  const sender = createLineSender({
    post: postLinesTo(o.orgSlug, o.callId),
    onStop: (reason) => { status({ kind: "stopped", reason }); stopAll(); },
  });
  /** A line from speech that started at `startMs` (this device's clock); seq always goes forward on this device. */
  const emit = (startMs: number, raw: string) => {
    const text = cleanLine(raw);
    if (!text || !running) return;
    let seq = lineSeq(startMs, skew, o.callStartedAt);
    if (seq <= lastSeq) seq = lastSeq + 1;
    lastSeq = seq;
    sender.add({ seq, at: Math.max(lineAt(startMs, skew), Date.parse(o.callStartedAt) || 0), text });
  };
  const stopAll = () => {
    if (!running) return;
    running = false;
    for (const c of cleanups.splice(0)) { try { c(); } catch { /* already gone */ } }
    // What was already written down still goes (the server keeps lines for a minute after notes stop or the person leaves).
    void sender.flush().finally(() => sender.close());
  };

  void (async () => {
    const kind = await chooseEngine();
    if (!running) return;
    if (kind === "browser-local") {
      if (!runBrowser()) {
        forgetEngine();
        await runWhisperOrNone();
      }
    } else if (kind === "whisper") await runWhisperOrNone();
    else status({ kind: "none" });
  })();

  // ---- The browser's on-device engine --------------------------------------------------------------------------------------
  function runBrowser(): boolean {
    const SR = recognitionCtor();
    if (!SR) return false;
    let rec: LocalRecognition;
    try {
      rec = new SR();
      rec.processLocally = true;
      // A recognition that ignored processLocally would send audio away: never start one.
      if (rec.processLocally !== true) return false;
      rec.lang = notesLang();
      rec.continuous = true;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
    } catch { return false; }
    let phraseStart = Date.now();
    let alive = true;
    rec.onspeechstart = () => { phraseStart = Date.now(); };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r?.isFinal) continue;
        if (!isMuted(o.micTrack)) emit(phraseStart, r[0]?.transcript ?? "");
        phraseStart = Date.now();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") {
        alive = false;
        status({ kind: "none" });
      }
    };
    // Restart while running (Chrome ends a continuous session after a while of silence).
    rec.onend = () => { if (running && alive) { try { rec.start(o.micTrack); } catch { /* starting already */ } } };
    try { rec.start(o.micTrack); } catch { return false; }
    const onMute = () => status({ kind: "muted" });
    const onUnmute = () => status({ kind: "local", engine: "browser-local" });
    o.micTrack.addEventListener("mute", onMute);
    o.micTrack.addEventListener("unmute", onUnmute);
    cleanups.push(() => {
      alive = false;
      o.micTrack.removeEventListener("mute", onMute);
      o.micTrack.removeEventListener("unmute", onUnmute);
      rec.onresult = null; rec.onend = null; rec.onerror = null;
      try { rec.abort(); } catch { /* stopped */ }
    });
    status(isMuted(o.micTrack) ? { kind: "muted" } : { kind: "local", engine: "browser-local" });
    return true;
  }

  // ---- On-device Whisper -------------------------------------------------------------------------------------------------
  async function runWhisperOrNone(): Promise<void> {
    let w: typeof import("@/lib/whisper/client");
    try { w = await import("@/lib/whisper/client"); } catch { status({ kind: "none" }); return; }
    if (!running) return;
    if (!w.whisperSupported() || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") { status({ kind: "none" }); return; }
    const mb = Math.round((await import("@/lib/whisper/config")).WHISPER_MODEL_BYTES / 1_048_576);
    let ready = false;
    status({ kind: "preparing", mb, fraction: 0 });
    const preparing = w.prepareWhisper((fraction) => { if (!ready) status({ kind: "preparing", mb, fraction }); })
      .then(() => { ready = true; if (running) status(isMuted(o.micTrack) ? { kind: "muted" } : { kind: "local", engine: "whisper" }); })
      .catch(() => { if (running) status({ kind: "none" }); throw new Error("whisper"); });

    const stream = new MediaStream([o.micTrack]);
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const mime = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
      : typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    const seg = createSegmenter();
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let segStart = 0;
    const waiting: { blob: Blob; startMs: number }[] = [];
    let working = false;
    let wasMuted = isMuted(o.micTrack);

    const discard = () => {
      const r = recorder;
      recorder = null;
      chunks = [];
      if (r && r.state !== "inactive") { r.ondataavailable = null; r.onstop = null; try { r.stop(); } catch { /* stopped */ } }
    };
    const begin = (at: number) => {
      discard();
      try {
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        chunks = [];
        r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        r.start();
        recorder = r;
        segStart = at;
      } catch { recorder = null; }
    };
    const finish = (startMs: number) => {
      const r = recorder;
      recorder = null;
      if (!r || r.state === "inactive") return;
      const mine = chunks;
      chunks = [];
      r.onstop = () => {
        if (!running) return;
        const blob = new Blob(mine, { type: r.mimeType || mime || "audio/webm" });
        if (pushBounded(waiting, { blob, startMs }) > 0) status({ kind: "behind" });
        void work();
      };
      try { r.stop(); } catch { /* stopped */ }
    };
    const work = async () => {
      if (working) return;
      working = true;
      try {
        await preparing;
        while (running && waiting.length) {
          const next = waiting.shift()!;
          try {
            const samples = await w.toWhisperAudio(next.blob);
            if (!running) break;
            emit(next.startMs, await w.transcribe(samples));
          } catch { /* one segment that could not be read is skipped */ }
        }
      } catch { /* the model could not load: status says so */ } finally { working = false; }
    };

    // Epoch milliseconds, so a segment's start is on the same clock as the server's (skew).
    const tick = setInterval(() => {
      if (!running) return;
      const muted = isMuted(o.micTrack);
      if (muted) {
        if (!wasMuted) { seg.reset(); discard(); status({ kind: "muted" }); }
        wasMuted = true;
        return;
      }
      if (wasMuted) { wasMuted = false; status(ready ? { kind: "local", engine: "whisper" } : { kind: "preparing", mb, fraction: 0 }); }
      analyser.getFloatTimeDomainData(buf);
      const now = Date.now();
      for (const ev of seg.push(rmsOf(buf), now)) {
        if (ev.type === "start") begin(ev.at);
        else if (ev.type === "cancel") discard();
        else if (ev.keep) finish(segStart);
        else discard();
      }
    }, SEGMENT.sampleMs);
    if (wasMuted) status({ kind: "muted" });

    cleanups.push(() => {
      clearInterval(tick);
      seg.reset();
      discard();
      waiting.length = 0;
      try { source.disconnect(); } catch { /* gone */ }
      void ctx.close().catch(() => undefined);
    });
  }

  return { stop: stopAll };
}
