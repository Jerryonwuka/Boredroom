"use client";

/**
 * Which on-device speech engine writes a person's words down on a call (owner decisions, 8 October 2026: phase 8,
 * Brenda's notes on calls; contract E.3, decision D9). Audio never leaves the device:
 * 1. the browser's ON-DEVICE speech recognition (Chrome and Edge 139+: `SpeechRecognition.available({ processLocally:
 *    true })` says "available"; "downloadable" is installed from the person's own "Include me" press, a user gesture);
 * 2. otherwise the app's on-device Whisper (src/lib/whisper: English, 41 MB downloaded once);
 * 3. otherwise none: the banner says this browser can't take notes, and nothing is sent.
 * Never a recognition without `processLocally` (Chrome's default Web Speech sends audio to Google), never any server
 * speech service.
 */
import type { EngineKind } from "@/lib/call-notes";

/** The parts of the Web Speech API's on-device recognition used here (not yet in TypeScript's DOM types). */
export type LocalRecognition = {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onspeechstart: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
};
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
export type LocalRecognitionCtor = {
  new (): LocalRecognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

/** The language asked for: the browser's own when it is English, else British English (notes are English only for now). */
export function notesLang(): string {
  const l = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return /^en(-|$)/i.test(l) ? l : "en-GB";
}

export function recognitionCtor(): LocalRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: LocalRecognitionCtor; webkitSpeechRecognition?: LocalRecognitionCtor };
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  // Only a recognition that can promise to stay on the device (it has the static `available`).
  return SR && typeof SR.available === "function" ? SR : null;
}

async function localAvailability(): Promise<Availability> {
  const SR = recognitionCtor();
  if (!SR?.available) return "unavailable";
  try { return await SR.available({ langs: [notesLang()], processLocally: true }); } catch { return "unavailable"; }
}

async function whisperOk(): Promise<boolean> {
  try { return (await import("@/lib/whisper/client")).whisperSupported(); } catch { return false; }
}

let chosen: Promise<EngineKind> | null = null;

/** The engine this device uses (asked once per tab; the browser's on-device engine only when it is already there). */
export function chooseEngine(): Promise<EngineKind> {
  if (!chosen) {
    chosen = (async (): Promise<EngineKind> => {
      if ((await localAvailability()) === "available") return "browser-local";
      return (await whisperOk()) ? "whisper" : "none";
    })().catch(() => "none" as EngineKind);
  }
  return chosen;
}

/**
 * Called inside the person's "Include me" press (a user gesture): when the browser can install its on-device language
 * pack, it is installed now and used once it is there; otherwise the choice stays as `chooseEngine` makes it (Whisper's
 * model is fetched by the runner, with its progress on the banner). Never throws.
 */
export function prepareEngine(): Promise<EngineKind> {
  const SR = recognitionCtor();
  if (!SR?.available || !SR.install) return chooseEngine();
  const install = SR.install;
  // The install call must start inside the gesture, so it is made before anything is awaited.
  const pending = localAvailability().then(async (a): Promise<EngineKind> => {
    if (a === "available") return "browser-local";
    return (await whisperOk()) ? "whisper" : "none";
  });
  const installing = install({ langs: [notesLang()], processLocally: true }).catch(() => false);
  chosen = Promise.all([pending, installing]).then(async ([kind, installed]) => {
    if (kind === "browser-local") return kind;
    if (installed && (await localAvailability()) === "available") return "browser-local" as EngineKind;
    return kind;
  }).catch(() => "none" as EngineKind);
  return chosen;
}

/** Forget the choice (a test, or a browser whose engine failed at runtime falls back to Whisper). */
export function forgetEngine(next: EngineKind | null = null): void {
  chosen = next ? Promise.resolve(next) : null;
}
