import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Baseline security headers.
//
// Calls (owner decision, 8 October 2026: phase 8): the camera and LiveKit Cloud for calls; screen sharing in calls keeps
// display-capture first-party; nothing is framed. The LiveKit SDK first fetches its region settings over https from
// <project>.<region>.production.livekit.cloud and then opens its signalling socket over wss; `*.livekit.cloud` covers
// both. Media and TURN relays are not governed by CSP.
//
// On-device dictation (owner decision, 5 October 2026; src/lib/whisper) needs two narrow exceptions: compiling
// WebAssembly ('wasm-unsafe-eval' allows WebAssembly only, not JavaScript eval) for the speech runtime the app serves
// itself, and downloading the pinned Whisper model from Hugging Face, which redirects large files to its CDN (*.hf.co).
// Only model files are fetched from there; no audio or other data is sent anywhere.
const SPEECH_MODEL_HOSTS = "https://huggingface.co https://*.hf.co";
const CALL_HOSTS = "https://*.livekit.cloud wss://*.livekit.cloud";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${SPEECH_MODEL_HOSTS} ${CALL_HOSTS}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "display-capture=(self), microphone=(self), camera=(self), geolocation=()" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default nextConfig;
