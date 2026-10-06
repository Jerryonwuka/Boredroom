"use client";

/**
 * The page's side of on-device dictation: one shared worker per tab (created on first use), the recording decoded to
 * 16 kHz mono, and the model's download progress for the "getting ready" message. See `config.ts`.
 */
import { WHISPER_MODEL_BYTES, WHISPER_SAMPLE_RATE } from "./config";

type Out =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id?: number; message: string };

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
/** Rejects the load in progress (set while one is), so a worker that dies while loading never leaves callers waiting. */
let failLoad: ((err: Error) => void) | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
const listeners = new Set<(fraction: number) => void>();
let lastFraction = 0;

// The smallest module using a WebAssembly SIMD instruction (the probe ONNX Runtime itself uses). The runtime ships only
// a SIMD build, so a browser without SIMD (Safari before 16.4, Chrome before 91, Firefox before 89) cannot run it; better
// to know before downloading 41 MB of model than after.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
let simd: boolean | null = null;

/** Whether this browser can run on-device dictation at all. */
export function whisperSupported(): boolean {
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined"
    || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") return false;
  if (simd === null) { try { simd = WebAssembly.validate(SIMD_PROBE); } catch { simd = false; } }
  return simd;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module", name: "brenda-dictation" });
  worker.onmessage = (e: MessageEvent<Out>) => {
    const m = e.data;
    if (m.type === "progress") { lastFraction = Math.min(0.99, m.loaded / Math.max(m.total, WHISPER_MODEL_BYTES)); for (const l of listeners) l(lastFraction); }
    else if (m.type === "result") { pending.get(m.id)?.resolve(m.text); pending.delete(m.id); }
    else if (m.type === "error" && m.id !== undefined) { pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id); }
  };
  // The worker's script failed to load (offline on first use, an old chunk after a deploy) or it crashed.
  worker.onerror = (e) => {
    e.preventDefault?.();
    const err = new Error(e.message || "The dictation engine could not start.");
    failLoad?.(err);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate(); worker = null; ready = null;
  };
  return worker;
}

/** Downloads (first time) and loads the model. Resolves when dictation can transcribe; progress is 0 to 1. */
export function prepareWhisper(onProgress?: (fraction: number) => void): Promise<void> {
  if (onProgress) { listeners.add(onProgress); onProgress(lastFraction); }
  if (!ready) {
    const w = getWorker();
    ready = new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent<Out>) => {
        if (e.data.type === "ready") { w.removeEventListener("message", onMsg); failLoad = null; resolve(); }
        else if (e.data.type === "error" && e.data.id === undefined) failLoad?.(new Error(e.data.message));
      };
      failLoad = (err) => { w.removeEventListener("message", onMsg); failLoad = null; ready = null; reject(err); };
      w.addEventListener("message", onMsg);
      w.postMessage({ type: "load" });
    });
  }
  const p = ready;
  if (onProgress) void p.finally(() => listeners.delete(onProgress)).catch(() => undefined);
  return p;
}

/** Recorded audio (any format the browser recorded) to 16 kHz mono samples for Whisper. */
export async function toWhisperAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
    return out;
  } finally { void ctx.close(); }
}

/** Speech to text on this computer. */
export async function transcribe(audio: Float32Array): Promise<string> {
  await prepareWhisper();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}

// Development only: lets the engine be exercised from the browser console without a microphone.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __boredroomWhisper?: unknown }).__boredroomWhisper = { prepareWhisper, toWhisperAudio, transcribe };
}
