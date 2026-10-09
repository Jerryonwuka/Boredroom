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
    case "no_key": return `Natural voices aren't set up for this workspace yet, so ${name} uses the computer voice.`;
    case "key_rejected": return `ElevenLabs refused the workspace's key, so ${name} uses the computer voice. An owner or HR can check it in Settings.`;
    case "person_cap": return `You've used today's natural voice, so ${name} uses the computer voice until tomorrow.`;
    case "workspace_cap": return `Your workspace has used today's natural voice, so ${name} uses the computer voice until tomorrow.`;
    // Boredroom's key only: every workspace on it shares the day (review, 9 October 2026).
    case "shared_cap": return `Today's natural voice allowance, shared by the workspaces on Boredroom's key, is used up, so ${name} uses the computer voice until tomorrow.`;
    case "allowance_low": {
      const date = formatResetDate(resetAt, timeZone);
      return `This month's natural voice allowance is nearly used up, so ${name} uses the computer voice until it resets${date ? ` on ${date}` : ""}.`;
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
    /** No key at all (neither the workspace's nor Boredroom's): the samples are not offered. */
    noSamples: "Samples play once natural voices are set up for this workspace.",
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
  /** Settings → Brenda → Natural voice (owners and HR; contract F.3). */
  connection: {
    title: "Natural voice",
    description: "Natural voices for everyone's assistant, from ElevenLabs. Without a key of your own, Boredroom's key is used within a daily share.",
    row: "Connection",
    connected: "Connected",
    boredroom: "Boredroom's key",
    none: "Not connected",
    organisationLine: (hint: string | null, date: string | null) => `Your workspace's key${hint ? `, ending ${hint}` : ""}${date ? `, connected ${date}` : ""}`,
    environmentLine: "Using Boredroom's key. Add your workspace's own key to use your own allowance.",
    noneLine: "Assistants use the computer voice.",
    keyLabel: "ElevenLabs API key",
    keyHint: "From elevenlabs.io, under your profile, API keys. It needs Text to Speech, Voices (read), User (read) and History (read and write), so what's said can be deleted from the key's history.",
    connect: "Connect and test",
    testing: "Testing…",
    cancel: "Cancel",
    replace: "Replace key",
    remove: "Remove",
    removing: "Removing…",
    removeTitle: "Remove the ElevenLabs key?",
    removeDescription: "The stored key is deleted. Boredroom's key is used again within a daily share, or the computer voice when there isn't one.",
    removed: "Removed. The stored key is deleted.",
    success: "Connected. ElevenLabs answered.",
    tooShort: "That's too short to be an ElevenLabs API key.",
    notReady: "Natural voices need a database update first. Assistants use the computer voice until then.",
    usage: "Usage this month",
    /** ElevenLabs counts its allowance in credits, not characters (Flash costs half a credit a character). */
    used: "Credits used",
    usedValue: (used: number, limit: number) => `${formatCount(used)} of ${formatCount(limit)}`,
    usedLabel: "ElevenLabs credits used this month",
    usedText: (used: number, limit: number) => `${formatCount(used)} of ${formatCount(limit)} credits`,
    resets: "Resets",
    keyInUse: "Key in use",
    organisationKey: "Your workspace's key",
    boredroomKey: "Boredroom's key",
    workspace: "This workspace",
    workspaceValue: (today: number, share: number, month: number) => `${formatCount(today)} today of a ${formatCount(share)} share; ${formatCount(month)} this month`,
    person: "Each person",
    personValue: (n: number) => `Up to ${formatCount(n)} characters a day`,
    low: (date: string | null) => `Less than 10% of this month's allowance is left, so assistants use the computer voice until it resets${date ? ` on ${date}` : ""}.`,
    /** Boredroom's key (its own usage and reset date are not shown to a workspace). */
    lowShared: "Boredroom's key is nearly used up this month, so assistants use the computer voice until it resets. Add your workspace's own key to carry on.",
    sharedFull: "Today's allowance on Boredroom's key, shared by the workspaces using it, is used up, so assistants use the computer voice until tomorrow. Add your workspace's own key to avoid this.",
    historyBlocked: "This key can't delete what assistants say from its ElevenLabs history, so whoever holds that ElevenLabs account can read it there. Give the key History (read and write) access in ElevenLabs: Boredroom keeps trying for a day, so what was said meanwhile is deleted once it can.",
    /** What could not be deleted from the key's history in the last 30 days (fix review, 9 October 2026). */
    historyLeft: (n: number) => n === 1
      ? "One thing said aloud in the last 30 days couldn't be deleted from this key's ElevenLabs history, so whoever holds that ElevenLabs account can read it there. You can delete it in ElevenLabs, under History."
      : `${formatCount(n)} things said aloud in the last 30 days couldn't be deleted from this key's ElevenLabs history, so whoever holds that ElevenLabs account can read them there. You can delete them in ElevenLabs, under History.`,
    monthUpstream: "Couldn't read the usage from ElevenLabs just now.",
    monthRejected: "ElevenLabs refused the workspace's key. Replace it or remove it.",
    keyNote: "The key is tested with one free request, then stored encrypted and never shown again.",
    privacyNote: "What each assistant says aloud in a natural voice is sent to ElevenLabs to turn into speech. ElevenLabs keeps it in the history of the account that owns the key, where that account's holder can read it, so Boredroom deletes each one once it's said (the key needs History access for that). If ElevenLabs doesn't answer in time, Boredroom can't tell which one it was and leaves it; with your workspace's own key, the Natural voice card counts those. Boredroom keeps no words or audio.",
  },
} as const;
