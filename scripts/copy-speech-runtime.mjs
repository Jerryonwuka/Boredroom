/**
 * On-device dictation (owner decision, 5 October 2026) runs Whisper in the browser with ONNX Runtime Web. Its
 * WebAssembly runtime would otherwise be fetched from a public CDN; this copies it into `public/speech/` so the app
 * serves it itself (same origin, allowed by the Content-Security-Policy). Run on install, before `dev`, and strictly before `build`.
 *
 * The files must be the exact onnxruntime-web build that @huggingface/transformers bundles, so they are resolved from
 * that package rather than from the top level. `public/speech/` is generated and ignored by git.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];
const out = join(process.cwd(), "public", "speech");

try {
  const require = createRequire(import.meta.url);
  const transformers = require.resolve("@huggingface/transformers");
  const fromTransformers = createRequire(transformers);
  // onnxruntime-web's export map hides package.json; its entry file sits in dist/ next to the runtime files.
  const dist = dirname(fromTransformers.resolve("onnxruntime-web"));
  mkdirSync(out, { recursive: true });
  for (const f of FILES) {
    const src = join(dist, f), dest = join(out, f);
    if (!existsSync(src)) throw new Error(`missing ${src}`);
    if (existsSync(dest) && statSync(dest).size === statSync(src).size && statSync(dest).mtimeMs >= statSync(src).mtimeMs) continue;
    copyFileSync(src, dest);
  }
  console.log(`Speech runtime ready in public/speech (${FILES.join(", ")}).`);
} catch (err) {
  // Never fail an install or `dev` over this (dictation falls back to the browser's speech service), but a production
  // build (`--strict`) must not ship without the runtime.
  console.warn(`Could not prepare the on-device speech runtime: ${err instanceof Error ? err.message : err}`);
  if (process.argv.includes("--strict")) process.exitCode = 1;
}
