/**
 * Natural voices (owner decision, 9 October 2026: natural voice (ElevenLabs), contract A).
 *
 * The curated ElevenLabs voices each person can pick for their assistant, and the shapes the server, the web and the
 * notch share. Pure: no server imports, so the browser bundles it as is.
 *
 * Chosen on 9 October 2026 from GET /v1/voices on Boredroom's key: all eight are `premade` (default voices every
 * account has, with stable ids) and list `eleven_flash_v2_5` among their high-quality models (Sarah and Adam were left
 * out: no Flash v2.5 listed). Varied: four women, three men, one neutral; four British, four American; warm, bright,
 * calm, deep. The UI shows the first name only, never ElevenLabs' marketing name. No voice cloning.
 */

export type NaturalVoice = {
  id: string;
  name: string;
  description: string;
  gender: "woman" | "man" | "neutral";
  accent: "British" | "American";
};

export const NATURAL_VOICES: readonly NaturalVoice[] = Object.freeze([
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", description: "Clear and friendly, a British woman", gender: "woman", accent: "British" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", description: "Warm and velvety, a British woman", gender: "woman", accent: "British" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Warm and steady, a British man", gender: "man", accent: "British" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "Calm and composed, a British man", gender: "man", accent: "British" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "Bright and lively, an American woman", gender: "woman", accent: "American" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", description: "Calm and professional, an American woman", gender: "woman", accent: "American" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Deep and reassuring, an American man", gender: "man", accent: "American" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", description: "Relaxed and even, an American voice", gender: "neutral", accent: "American" },
].map((v) => Object.freeze(v as NaturalVoice)));

const BY_ID = new Map(NATURAL_VOICES.map((v) => [v.id, v]));

/** In the catalogue (the only ids that ever reach an ElevenLabs URL). */
export const isNaturalVoiceId = (v: unknown): v is string => typeof v === "string" && BY_ID.has(v);

export const naturalVoice = (id: string | null | undefined): NaturalVoice | null => (id ? BY_ID.get(id) ?? null : null);

/** Per utterance (speakable() already stops at ~400). */
export const SPEECH_MAX_CHARS = 600;

/** ElevenLabs voice_settings.speed (0.7 to 1.2). Same keys as assistant-speech/prefs VoiceSpeed. */
export const SPEECH_SPEEDS = { slower: 0.9, normal: 1, faster: 1.1 } as const;
export type SpeechSpeed = keyof typeof SPEECH_SPEEDS;

/** Why the computer voice speaks instead (null: the natural voice is available). */
export type NaturalVoiceReason =
  | "not_ready"
  | "no_voice"
  | "voice_off"
  | "no_key"
  | "key_rejected"
  | "person_cap"
  | "workspace_cap"
  /** Boredroom's key only: today's share of the key, shared by every workspace on it, is used up (9 October 2026, review). */
  | "shared_cap"
  | "allowance_low"
  | "upstream";

/** What a reply carries so its own words can be said in the natural voice (contract D). */
export type SpeechOffer = { path: string; token: string; text: string };

/** Settings → Your assistant (the person). */
export type NaturalVoiceView = {
  /** Migration 0053 applied. */
  ready: boolean;
  /** A catalogue id; null = "Computer voice" (the default). */
  chosen: string | null;
  /** A chosen voice would be used right now. */
  available: boolean;
  /** Why not (null when available, or when chosen is null: then "no_voice" is NOT shown). */
  reason: NaturalVoiceReason | null;
  /** ISO, when the key's monthly allowance resets (for "allowance_low"). */
  resetAt: string | null;
  usedToday: number;
  personDailyLimit: number;
  /** A key exists (the workspace's or Boredroom's), so the samples can play; without one they are not offered. */
  samples: boolean;
  voices: readonly NaturalVoice[];
};

/** Settings → Brenda → Natural voice (owners and HR). */
export type VoiceConnectionStatus = {
  ready: boolean;
  /** "Your workspace's key" | "Boredroom's key" | none. */
  source: "organisation" | "environment" | "none";
  /** "…ab12" and ISO; the organisation key only. */
  hint: string | null;
  connectedAt: string | null;
  /**
   * The workspace's own key's subscription (null: unreadable, or on Boredroom's key: its usage is every workspace's
   * together, so it is never shown to one of them; 9 October 2026, review).
   */
  month: { used: number; limit: number; resetAt: string | null } | null;
  monthError: "key_rejected" | "upstream" | null;
  /** Under 10% of the allowance left. */
  low: boolean;
  /** Characters this workspace spoke since the 1st (our counters). */
  workspaceMonth: number;
  /** This workspace today, and today's share. */
  today: { used: number; share: number };
  /** Boredroom's key only: today's share of the key, shared by every workspace on it, is used up. */
  sharedFull: boolean;
  /**
   * The workspace's own key cannot delete what was said from its ElevenLabs history (no History access), so the key's
   * account holder can read it there; Boredroom keeps trying for a day. Known once a deletion was tried. Always false on
   * Boredroom's key: that is Boredroom's to fix, not the workspace's (fix review, 9 October 2026).
   */
  historyBlocked: boolean;
  /**
   * The workspace's own key: how many things said aloud in the last 30 days could not be deleted from its ElevenLabs
   * history (no id from ElevenLabs, no History access for a day, ElevenLabs failing). 0 on Boredroom's key.
   */
  historyLeft: number;
  personDailyLimit: number;
};

// Control characters except tab, newline and carriage return (those become spaces with the rest of the whitespace), and
// the invisible ones: zero-width spaces and joiners, direction marks and overrides, the BOM. Line and
// paragraph separators are whitespace (\s), so they become spaces.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * The exact words a speech token covers and ElevenLabs is sent (contract D.1): control characters removed, whitespace
 * collapsed, trimmed, clipped to SPEECH_MAX_CHARS at a sentence end, else a word boundary. Idempotent:
 * speechText(speechText(x)) === speechText(x), which the speech route relies on to refuse altered text.
 */
export function speechText(raw: string): string {
  const flat = String(raw ?? "")
    .replace(CONTROL, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= SPEECH_MAX_CHARS) return flat;
  const head = flat.slice(0, SPEECH_MAX_CHARS);
  // The last sentence end inside the cap (". ", "! ", "? " or the very end), not absurdly early.
  let cut = -1;
  for (const m of head.matchAll(/[.!?…](?=\s|$)/g)) cut = m.index + 1;
  if (cut >= SPEECH_MAX_CHARS * 0.4) return head.slice(0, cut).trim();
  const space = flat.charAt(SPEECH_MAX_CHARS) === " " ? SPEECH_MAX_CHARS : head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head).trim();
}
