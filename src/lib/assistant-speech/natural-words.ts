/**
 * The words around natural voices (owner decision, 9 October 2026: natural voice (ElevenLabs), contract F.2 to F.4):
 * the person's voice picker (Settings → Your assistant → Voice), the note that says why the computer voice is speaking
 * instead, and the owners' and HR's key and usage card (Settings → Brenda → Natural voice). Plain British English; pure,
 * so the tests read the same strings the pages show (tests/unit/assistant-speech-natural.test.ts).
 */
import type { NaturalVoiceReason } from "@/lib/natural-voices";

/** "9 November 2026" (en-GB), in `timeZone` when given, else this browser's; null for no date or a bad one. */
export function formatResetDate(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
  }
}

/** A count of characters as people read it: "38,373". */
export const formatCount = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0)).toLocaleString("en-GB");

/**
 * Why the person's assistant uses the computer voice although they chose a natural one, for Settings (contract F.4).
 * null when there is nothing to say: the natural voice is available, Voice is switched off for the workspace (its own
 * words cover that) or no natural voice is chosen.
 */
export function naturalVoiceNote(reason: NaturalVoiceReason | null | undefined, name: string, resetAt?: string | null, timeZone?: string): string | null {
  switch (reason) {
    case "not_ready": return `Natural voices need a database update first. ${name} uses the computer voice until then.`;
    case "no_key": return `Natural voices aren't available right now, so ${name} uses the computer voice.`;
    case "key_rejected": return `ElevenLabs refused the workspace's key, so ${name} uses the computer voice. An owner or HR can check it in Settings.`;
    // No limit of Boredroom's any more (owner request, 12 October 2026: "remove the limit for ElevenLabs voice"): only
    // ElevenLabs' own refusal for credits stops the natural voice.
    case "allowance_low": {
      const date = formatResetDate(resetAt, timeZone);
      return `Your ElevenLabs plan has run out of credits, so ${name} uses the computer voice until it resets${date ? ` on ${date}` : ""}.`;
    }
    case "upstream": return `ElevenLabs didn't answer just now, so ${name} used the computer voice.`;
    default: return null; // voice_off, no_voice, null: no note
  }
}

export const NATURAL_WORDS = {
  /** Beside the voice picker, always (owner decision, 9 October 2026: privacy). */
  privacy: "Natural voices are made by ElevenLabs: the words your assistant says are sent to ElevenLabs to turn into speech.",
  /**
   * Straight after it (review, 9 October 2026): ElevenLabs keeps each one in the History of the account whose key is
   * used, where that account's holder could read it, until Boredroom deletes it.
   */
  privacyHistory: "ElevenLabs also keeps them in the history of the account whose key is used (your workspace's or Boredroom's). Boredroom deletes them from there once they're said; if that fails, whoever holds that ElevenLabs account could read them.",
  picker: {
    label: "Voice",
    hint: "Saved to your account, so the desktop app uses it too.",
    legend: (name: string) => `${name}'s voice`,
    computer: "Computer voice",
    computerHint: "Built into this computer. The words stay on it.",
    play: (voice: string) => `Play a sample of ${voice}`,
    stop: (voice: string) => `Stop the sample of ${voice}`,
    sampleFailed: (voice: string) => `The sample of ${voice} couldn't play just now. Try again in a moment.`,
    sampleUnplayable: "This browser can't play the samples.",
    /** No key on Boredroom's side: the samples are not offered. */
    noSamples: "Samples play once natural voices are available.",
    notReady: (name: string) => `Natural voices need a database update first. ${name} uses the computer voice until then.`,
    unreadable: "Couldn't load the natural voices just now. Reload the page to try again.",
  },
  /** The computer voice's rows, under the picker. */
  computer: {
    label: "Computer voice",
    hint: "From this computer. Kept in this browser only.",
    hintFallback: "Used when the natural voice isn't available. Kept in this browser only.",
    sample: "Play a sample of the computer voice",
  },
  section: (name: string) => `Hear ${name}'s replies out loud, in a natural voice or your computer's own.`,
  /** The "Your assistant" page note's voice sentence. */
  pageNote: "Natural voices come from ElevenLabs; your computer's voices stay on this computer, and your choice of computer voice and speed is kept in this browser.",
  /**
   * Settings → Brenda → "AI and voice" (owners and HR), read-only since the owner's request (27 October 2026: "remove every
   * API key store"): Claude and the natural voices are Boredroom's, for every workspace; no key to add.
   */
  connection: {
    title: "AI and voice",
    description: "Brenda's AI and natural voice are provided by Boredroom. There's nothing to set up or pay for separately.",
    claude: "Claude",
    claudeOn: "Connected",
    claudeOff: "Not available right now",
    claudeHint: "Brenda's thinking, for everyone's assistant.",
    claudeOffLine: "A simple built-in helper answers until it's back, and only suggests.",
    voice: "Natural voice",
    voiceOn: "Connected",
    voiceOff: "Computer voice only",
    voiceHint: "From ElevenLabs, when someone picks a natural voice for their assistant.",
    voiceOffLine: "Assistants use the computer voice.",
    notReady: "Natural voices need a database update first. Assistants use the computer voice until then.",
    workspace: "Said aloud",
    workspaceHint: "Characters spoken in a natural voice in this workspace.",
    /** Characters said aloud (no daily share or limit since the owner's request, 12 October 2026). */
    workspaceValue: (today: number, month: number) => `${formatCount(today)} characters today; ${formatCount(month)} this month`,
    /** Boredroom's key ran out (its own usage and reset date are not shown to a workspace). */
    lowShared: "Natural voices have reached this month's allowance, so assistants use the computer voice for now. Nothing to do on your side.",
    privacyNote: "What each assistant says aloud in a natural voice is sent to ElevenLabs to turn into speech. Boredroom deletes each one from ElevenLabs' history once it's said, and keeps no words or audio.",
    anthropicNote: "Each request Brenda makes goes to Anthropic: the request and what she needed to read for it, and only what the person asking is allowed to see.",
  },
} as const;
