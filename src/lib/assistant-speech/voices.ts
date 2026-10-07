/**
 * Which voices she may speak with on the web (owner decision, 7 October 2026: her voice, personal assistants phase 2).
 * Only voices that run on this device (`localService` true): a network voice, such as Chrome's "Google …" voices or
 * Edge's "… Online (Natural)" ones, sends the text of every reply to a third party's speech service, so it is never
 * offered and never used. macOS's novelty voices (Bubbles, Zarvox and the like) are left out too: they are jokes, not
 * a teammate's voice. Pure (no browser objects), so it is unit-tested; the controller feeds it `getVoices()`.
 */

export type LocalVoice = { voiceURI: string; name: string; lang: string; isDefault: boolean };

/** The browser's voice, as much of it as this module needs (SpeechSynthesisVoice has these). */
export type BrowserVoice = { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean };

/** macOS's novelty voices, by name (matched case-insensitively, ignoring a "(language)" suffix some browsers add). */
export const NOVELTY_VOICES: ReadonlySet<string> = new Set([
  "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Deranged", "Good News", "Hysterical", "Jester",
  "Organ", "Pipe Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox",
]);
const NOVELTY = new Set(Array.from(NOVELTY_VOICES, (n) => n.toLowerCase()));

export const isNoveltyVoice = (name: string) => NOVELTY.has(name.replace(/\s*\(.*$/, "").trim().toLowerCase());

/** How a voice is known: its voiceURI (every browser gives one; the name stands in if one ever does not). */
export const voiceKey = (v: { voiceURI: string; name: string }) => v.voiceURI || v.name;

/** Only voices that run on this device (localService true), minus macOS's novelty voices, sorted by name. */
export function localVoices(all: ReadonlyArray<BrowserVoice>): LocalVoice[] {
  const seen = new Set<string>();
  const out: LocalVoice[] = [];
  for (const v of all) {
    const key = voiceKey(v);
    if (v.localService !== true || !key || isNoveltyVoice(v.name ?? "") || seen.has(key)) continue;
    seen.add(key);
    out.push({ voiceURI: key, name: v.name || key, lang: v.lang ?? "", isDefault: !!v.default });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.lang.localeCompare(b.lang));
}

/** Language tags compare case-insensitively, with "_" read as "-" (Android reports en_GB). */
export const normaliseLang = (l: string) => l.trim().replace(/_/g, "-").toLowerCase();
const baseLang = (l: string) => normaliseLang(l).split("-")[0];

/**
 * The chosen voice if it is still here, else the best for the language: the device default if it speaks it, then an
 * exact match (en-GB), then the same base language (en), then the device default, then the first. null when none.
 * `langs` is in order of preference; the first is "the language".
 */
export function pickVoice(voices: readonly LocalVoice[], want: { voiceURI?: string | null; langs: readonly string[] }): LocalVoice | null {
  if (!voices.length) return null;
  if (want.voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === want.voiceURI);
    if (chosen) return chosen;
  }
  const langs = Array.from(new Set(want.langs.filter(Boolean).map(normaliseLang))).filter(Boolean);
  const fallback = voices.find((v) => v.isDefault) ?? voices[0];
  if (!langs.length) return fallback;
  const device = voices.find((v) => v.isDefault);
  if (device && baseLang(device.lang) === baseLang(langs[0])) return device;
  for (const l of langs) {
    const exact = voices.find((v) => normaliseLang(v.lang) === l);
    if (exact) return exact;
  }
  for (const l of langs) {
    const same = voices.find((v) => baseLang(v.lang) === baseLang(l));
    if (same) return same;
  }
  return fallback;
}
