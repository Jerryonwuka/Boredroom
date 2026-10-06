/**
 * On-device dictation (owner decision, 5 October 2026): Whisper "tiny" (English), quantised to 8 bits, run in the
 * browser by transformers.js on ONNX Runtime Web. About 41 MB of model downloaded from Hugging Face once per browser
 * (then cached), plus the 14 MB WebAssembly runtime the app serves itself from `public/speech/`. No audio leaves the
 * computer. The revision is pinned so an upstream change can never alter what users run.
 */
export const WHISPER_MODEL = "onnx-community/whisper-tiny.en";
export const WHISPER_REVISION = "2575352d61be1bf7225cf8f8b268a4678025fc58";
/**
 * What the model download adds up to (encoder 10.1 MB + decoder 30.7 MB + tokenizer and configs). The library reports
 * files one at a time, small ones first, so progress is measured against this rather than the files seen so far.
 */
export const WHISPER_MODEL_BYTES = 43_600_000;
/** The WebAssembly runtime, copied from onnxruntime-web by scripts/copy-speech-runtime.mjs. */
export const SPEECH_RUNTIME = { mjs: "/speech/ort-wasm-simd-threaded.mjs", wasm: "/speech/ort-wasm-simd-threaded.wasm" };
/** Longest single dictation; Whisper reads it in 30-second windows. */
export const MAX_DICTATION_SECONDS = 120;
export const WHISPER_SAMPLE_RATE = 16_000;
