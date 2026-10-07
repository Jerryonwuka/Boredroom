"use client";

/**
 * Her voice in React (owner decision, 7 October 2026: her voice, personal assistants phase 2). Thin hooks over the one
 * voice on the page (lib/assistant-speech/controller) and this device's voice and speed (lib/assistant-speech/prefs):
 * the chat's Listen buttons, Settings → Your assistant → Voice and the gallery read them. Everything is null or the
 * defaults while server rendering and hydrating, then the browser's real answer.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { pageLangs, speech, type SpeechSnapshot } from "@/lib/assistant-speech/controller";
import { PREFS_EVENT, readVoicePrefs, writeVoicePrefs, type VoiceSpeed } from "@/lib/assistant-speech/prefs";
import { pickVoice, type LocalVoice } from "@/lib/assistant-speech/voices";

/** The page's one voice: support, the local voices, whether (and which reply) she is speaking, and the controls. */
export function useSpeech(): SpeechSnapshot & { speak: typeof speech.speak; stop: typeof speech.stop } {
  const snap = useSyncExternalStore(speech.subscribe, speech.getSnapshot, speech.getServerSnapshot);
  return useMemo(() => ({ ...snap, speak: speech.speak, stop: speech.stop }), [snap]);
}

// ---- this device's voice and speed ------------------------------------------------------------------------------

type Prefs = { voiceURI: string | null; speed: VoiceSpeed };
const SERVER_PREFS: Prefs = { voiceURI: null, speed: "normal" };
let cached: Prefs = SERVER_PREFS;
/** The same object until a value changes, as useSyncExternalStore needs. */
function prefsSnapshot(): Prefs {
  const p = readVoicePrefs();
  if (p.voiceURI !== cached.voiceURI || p.speed !== cached.speed) cached = p;
  return cached;
}
function subscribePrefs(cb: () => void): () => void {
  window.addEventListener(PREFS_EVENT, cb);
  window.addEventListener("storage", cb); // another tab chose a voice
  return () => { window.removeEventListener(PREFS_EVENT, cb); window.removeEventListener("storage", cb); };
}
const setVoiceURI = (v: string | null) => writeVoicePrefs({ voiceURI: v || null });
const setSpeed = (s: VoiceSpeed) => writeVoicePrefs({ speed: s });

/** This device's voice and speed (localStorage), live across tabs. A null or "" voice is Automatic. */
export function useVoicePrefs(): { voiceURI: string | null; speed: VoiceSpeed; setVoiceURI(v: string | null): void; setSpeed(s: VoiceSpeed): void } {
  const prefs = useSyncExternalStore(subscribePrefs, prefsSnapshot, () => SERVER_PREFS);
  return useMemo(() => ({ ...prefs, setVoiceURI, setSpeed }), [prefs]);
}

/** The voice "Automatic" uses on this device for this page's language, or null. */
export function useAutoVoice(): LocalVoice | null {
  const { supported, voices } = useSpeech();
  return useMemo(() => (supported ? pickVoice(voices, { voiceURI: null, langs: pageLangs() }) : null), [supported, voices]);
}

/** Calls `fn` with each level while she speaks (and 0 at the end), for the component's life. */
export function useSpeechLevel(fn: (level: number) => void): void {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => speech.subscribeLevel((level) => latest.current(level)), []);
}
