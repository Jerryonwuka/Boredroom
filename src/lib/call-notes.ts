/**
 * Brenda's notes on calls (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, "Brenda can join calls:
 * notes, recap and commitments, WITH CONSENT"). On a call anyone can ask the workspace assistant to take notes; every
 * person on the call answers for themselves ("Include me" or "Not me"; no answer counts as no). Each consenting person's
 * own device writes their own words down (the browser's on-device speech recognition or the app's on-device Whisper;
 * never audio to anyone) and sends only text lines. After the call the workspace assistant writes a recap from those
 * lines alone; action items become Commitments each named person must accept. The lines are readable only by the
 * people who were on the call (no owner, HR or team-lead exception) and are deleted 7 days after the recap.
 *
 * Client-safe: types, limits and every fixed word (`NOTES_WORDS`). The server (services/call-notes, call-recap), the
 * call page (components/app/call-notes) and the transcriber (lib/call-transcriber) import it.
 */

export type NotesAvailability = { available: boolean; reason: "not_ready" | "plan" | "no_ai" | "off" | null };
export type NotesUnavailableReason = NonNullable<NotesAvailability["reason"]>;
export type TranscriptLine = { id: string; speaker: { membershipId: string; name: string }; spokenAt: string; text: string };
export type RecapActionItem = { n: number; what: string; owner: { membershipId: string; name: string } | null; dueAt: string | null; dueWords: string | null; commitmentId: string | null; mine: boolean };
export type CallRecapView = { callId: string; summary: string; decisions: string[]; actionItems: RecapActionItem[]; speakers: string[]; createdAt: string; linesDeleteAfter: string; linesDeletedAt: string | null };
export type EngineKind = "browser-local" | "whisper" | "none";
/**
 * Why a call has no recap (fix review, 10 October 2026; `calls.recap_skipped`): nobody agreed or nothing was said, the call
 * never had two people in it, or notes were switched off for the workspace (or its plan) by the time it ended.
 */
export type RecapSkipReason = "no_consent" | "not_answered" | "switched_off";

/**
 * Limits (owner decisions, 8 October 2026: phase 8). Migration 0054's app_call_add_lines holds the per-line ones too.
 * `recapsPerPersonPerDay` (fix review, 10 October 2026): recaps of calls whose notes one person turned on, a day.
 */
export const NOTES_LIMITS = { linesPerRequest: 10, lineMax: 1000, linesPerPersonPerCall: 2000, linesPerCall: 20000, requestsPer10Min: 240,
  transcriptCharsForModel: 60_000, recapsPerOrgPerDay: 100, recapsPerPersonPerDay: 20, keepDays: 7, segmentMinMs: 800, segmentMaxMs: 25_000,
  silenceEndMs: 900, postEveryMs: 5_000, queueMax: 3 } as const;

/** "Ada", "Ada and Ben", "Ada, Ben and Olu". */
export function namesList(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

const UNAVAILABLE: Record<NotesUnavailableReason, string> = {
  plan: "Notes on calls need the AI assistant on your plan.",
  no_ai: "Notes on calls need an AI connection. An owner can add one in Settings.",
  off: "Notes on calls are switched off for this workspace.",
  not_ready: "Notes need a database update first.",
};

/** Every word a person reads about notes on calls (plain British English; owner decisions, 8 October 2026: phase 8). */
export const NOTES_WORDS = {
  toggleOn: (ws: string) => `${ws} takes notes`,
  toggleOff: "Stop notes",
  confirmTitle: (ws: string) => `Turn on ${ws}'s notes?`,
  confirmBody: (ws: string, where: string): string[] => [
    "Everyone on the call is asked, and only the words of people who agree are used.",
    "Each person's own device writes their words down. No audio leaves anyone's device.",
    `After the call, ${ws} sends everyone on it a recap, and a short version goes into ${where}.`,
    "Only the people on the call can read the transcript. It's deleted 7 days after the recap.",
  ],
  confirm: "Turn on notes",
  cancel: "Cancel",
  bannerOn: (by: string, ws: string) => `${by} turned on ${ws}'s notes.`,
  bannerYou: (ws: string) => `You turned on ${ws}'s notes.`,
  from: (names: string[]) => (names.filter(Boolean).length ? `Notes from ${namesList(names)}.` : "Nobody is included yet."),
  ask: "Include your words?",
  // What saying yes means, for everyone before they answer, not only for the person who turned notes on (contract E.2;
  // fix review, 10 October 2026: nobody else was told that a short version goes into the thread).
  consentInfo: (where: string) =>
    `Only the words of people who agree are used, written down on each person's own device. Everyone on the call gets the recap, a short version goes into ${where}, and the transcript is deleted 7 days after it.`,
  include: "Include me",
  notMe: "Not me",
  included: "Your words are included.",
  stopIncluding: "Stop including me",
  leftOut: "Your words are left out.",
  engine: {
    preparing: (mb: number) => `Getting notes ready (${mb} MB, once)…`,
    local: "Writing down on this device.",
    none: "This browser can't take notes, so your words won't be included.",
    muted: "You're muted: nothing is written down.",
    behind: "Falling behind: some words were skipped.",
  },
  tile: {
    title: (ws: string) => `${ws} is taking notes`,
    from: (n: number) => (n === 1 ? "From 1 person" : `From ${n} people`),
  },
  unavailable: UNAVAILABLE,
  recap: {
    title: "Notes",
    writing: (ws: string) => `${ws} is writing the notes…`,
    summary: "Summary",
    decisions: "Decisions",
    actions: "Action items",
    noOwner: "No owner",
    open: "Open",
    acceptHint: "Each person accepts their own.",
    transcript: "Transcript",
    deletesOn: (date: string) => `Deleted on ${date}`,
    deleted: "The transcript was deleted 7 days after the recap.",
    skipped: "Nobody agreed to notes, so there are none.",
    skippedNotAnswered: "Notes need two people on the call, so there are none.",
    skippedOff: "Notes were switched off for this workspace, so there are none.",
    failed: (date: string) => `The notes couldn't be written. The transcript is here until ${date}.`,
    onlyParticipants: "Only the people on the call can read its notes.",
    noLines: "Nothing was written down.",
  },
  notifications: {
    recapDirect: (other: string) => `Notes from your call with ${other}`,
    recapGroup: (where: string) => `Notes from the call in ${where}`,
    failed: "The notes from your call couldn't be written",
    failedBody: (date: string) => `The transcript is on the call's page until ${date}.`,
    items: (n: number) => (n === 1 ? "1 action item." : `${n} action items.`),
  },
  thread: {
    head: (duration: string) => `Notes from the call (${duration}):`,
    // `named`: the items with an owner, the ones sent to someone to accept (fix review, 10 October 2026: items nobody owns
    // were counted as sent).
    tail: (d: number, n: number, named: number = n) => (named <= 0
      ? `Decisions: ${d}. Action items: ${n}.`
      : named >= n
        ? `Decisions: ${d}. Action items: ${n}, sent to the people named for them to accept.`
        : `Decisions: ${d}. Action items: ${n}, ${named} sent to the people named for them to accept.`),
  },
  errors: {
    impersonated: (first: string) => `Only ${first} can choose this.`,
    transcriptImpersonated: "Transcripts can't be read while you're signed in as someone else.",
    notAvailable: (reason: NotesUnavailableReason) => UNAVAILABLE[reason],
    noConsent: "Your words aren't included on this call.",
    notesOff: "Notes are off on this call.",
    notInCall: "You're not in this call.",
    tooMany: "This call has as many notes as it can hold.",
    badLines: "Those lines couldn't be read.",
    badChoice: "Choose Include me or Not me.",
    rateLimited: "That's a lot of notes in a few minutes. Try again shortly.",
  },
} as const;
