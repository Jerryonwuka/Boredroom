/**
 * Her voice and speed on this device (owner decision, 7 October 2026: her voice, personal assistants phase 2). Voices
 * differ from one computer to the next, so which one she uses and how fast she talks are kept in this browser's
 * localStorage, not on the account (when she speaks is on the account: lib/assistant-look `AssistantSpeak`). No voice
 * stored means "Automatic": the best local voice for the page's language (assistant-speech/controller).
 *
 * Storage can be blocked (private windows, cleared or refused site data): every read and write is wrapped, and where it
 * is blocked the choice is kept in memory until the page is left. Touches `window` only inside functions, so it is safe
 * to import while server rendering.
 */

export const VOICE_KEY = "boredroom-assistant-voice"; // a voiceURI, or absent for Automatic
export const SPEED_KEY = "boredroom-assistant-voice-speed"; // "slower" | "normal" | "faster"
/** Dispatched on window after a write (this tab); the "storage" event covers other tabs. */
export const PREFS_EVENT = "boredroom:assistant-voice";

export type VoiceSpeed = "slower" | "normal" | "faster";
export const SPEEDS: Record<VoiceSpeed, { label: string; rate: number }> = {
  slower: { label: "Slower", rate: 0.85 },
  normal: { label: "Normal", rate: 1 },
  faster: { label: "Faster", rate: 1.2 },
};
export const isVoiceSpeed = (v: unknown): v is VoiceSpeed => typeof v === "string" && Object.prototype.hasOwnProperty.call(SPEEDS, v);

/** This page's copy, for when storage is blocked. */
const memory: { voiceURI: string | null; speed: VoiceSpeed } = { voiceURI: null, speed: "normal" };

export function readVoicePrefs(): { voiceURI: string | null; speed: VoiceSpeed } {
  if (typeof window === "undefined") return { voiceURI: null, speed: "normal" };
  let voiceURI = memory.voiceURI;
  let speed = memory.speed;
  try { voiceURI = window.localStorage.getItem(VOICE_KEY) || null; } catch { /* storage blocked: this page's copy */ }
  try { const s = window.localStorage.getItem(SPEED_KEY); speed = isVoiceSpeed(s) ? s : "normal"; } catch { /* storage blocked: this page's copy */ }
  return { voiceURI, speed };
}

/** Saves what is given (null or "" removes the voice: Automatic again), then tells this tab's listeners. */
export function writeVoicePrefs(p: { voiceURI?: string | null; speed?: VoiceSpeed }): void {
  if (typeof window === "undefined") return;
  if (p.voiceURI !== undefined) memory.voiceURI = p.voiceURI || null;
  if (p.speed !== undefined && isVoiceSpeed(p.speed)) memory.speed = p.speed;
  try {
    if (p.voiceURI !== undefined) {
      if (p.voiceURI) window.localStorage.setItem(VOICE_KEY, p.voiceURI);
      else window.localStorage.removeItem(VOICE_KEY);
    }
    if (p.speed !== undefined && isVoiceSpeed(p.speed)) window.localStorage.setItem(SPEED_KEY, p.speed);
  } catch { /* storage blocked: kept in memory (above) until the page is left */ }
  try { window.dispatchEvent(new Event(PREFS_EVENT)); } catch { /* no window events */ }
}
