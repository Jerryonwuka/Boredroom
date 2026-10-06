/// <reference lib="webworker" />
/**
 * The dictation worker: loads Whisper once and turns 16 kHz mono audio into text, off the page's main thread so typing
 * and animations stay smooth. Messages in: { type: "load" } and { type: "transcribe", id, audio }. Messages out:
 * { type: "progress", loaded, total }, { type: "ready" }, { type: "result", id, text } and { type: "error", id?, message }.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { SPEECH_RUNTIME, WHISPER_MODEL, WHISPER_REVISION } from "./config";
import { resumableFetch } from "./resumable-fetch";

// Models only from Hugging Face (pinned revision), cached by the browser after the first download.
env.allowLocalModels = false;
env.useBrowserCache = true;
// Downloads continue where they stopped after a dropped connection instead of starting the file again.
env.fetch = resumableFetch as typeof env.fetch;
// The runtime comes from our own origin. The library's "WASM cache" would re-load it from a blob: URL, which the
// Content-Security-Policy does not allow, so the browser's ordinary HTTP cache is used instead.
env.useWasmCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number; proxy?: boolean } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { ...SPEECH_RUNTIME };
  // Threads need cross-origin isolation, which the app does not enable; one thread is plenty for tiny.en.
  onnx.wasm.numThreads = 1;
  onnx.wasm.proxy = false;
}

type In = { type: "load" } | { type: "transcribe"; id: number; audio: Float32Array };

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
const files = new Map<string, { loaded: number; total: number }>();

function load() {
  asr ??= pipeline("automatic-speech-recognition", WHISPER_MODEL, {
    revision: WHISPER_REVISION,
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      self.postMessage({ type: "progress", loaded, total });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; }); // a failed download can be retried
  return asr;
}

/** Whisper marks silence and noise as "[BLANK_AUDIO]", "(music)" and the like; none of that was said. */
function clean(text: string) {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") { await load(); self.postMessage({ type: "ready" }); return; }
    if (msg.type === "transcribe") {
      const run = await load();
      const out = await run(msg.audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      self.postMessage({ type: "result", id: msg.id, text: clean(text) });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg.type === "transcribe" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
