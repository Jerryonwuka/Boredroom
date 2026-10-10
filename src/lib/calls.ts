/**
 * Calls (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, "build Phase 8, cook"). Screen recording for
 * tasks is gone; people call each other instead: one-to-one from a direct thread, a group call from a team channel (the
 * team call) or a named channel, on every plan. Video goes through LiveKit Cloud; ringing, missed calls, history and
 * Brenda's notes are Boredroom's own (migration 0054). Client-safe: types, limits, words and pure helpers only. The server
 * (services/calls), the web (components/app/call-*) and the tests import it; the notch cannot, so the routes send it what
 * it needs already resolved (an assistant's face shades included).
 */
import type { AssistantProfile, FaceShades } from "@/lib/assistant-look";

// ---- Limits (owner decision, 8 October 2026: plan limits postponed, "make sure everything is functional first"; one global
// safety cap). Migration 0054's SQL uses the same numbers; tests/unit/calls-lib.test.ts reads the migration to check. ----
export const CALL_LIMITS = {
  maxParticipants: 50,
  maxCallMs: 4 * 60 * 60_000,
  ringMs: 30_000,
  heartbeatMs: 15_000,
  staleMs: 45_000,
  connectGraceMs: 90_000,
  aloneMs: 15 * 60_000,
  onlineWindowMs: 10 * 60_000,
  ringGroupMax: 50,
  startsPerHour: 30,
  startsPerConversationPerHour: 10,
  // A join token is used at once (the device connects on receiving it) and LiveKit hands a connected device fresh tokens
  // itself, so it lasts 2 minutes, not 10: a token kept after leaving, or replayed from an idempotent join, soon stops
  // working (fix review, 10 October 2026). `tokenTtlMs` is the same length for the answer's `expiresAt`.
  tokenTtl: "2m",
  tokenTtlMs: 2 * 60_000,
  // LiveKit's room is compared with who is in the call at most this often, from a device's heartbeat (and by the sweep
  // every minute): anyone in the room without a `joined` row is taken out (fix review, 10 October 2026).
  reconcileEveryMs: 15_000,
  // A notch that said "I ring aloud" this recently rings for the person; a browser on its network stays silent (fix
  // review, 10 October 2026: one ringer).
  desktopRingerMs: 20_000,
  declineMessageMax: 280,
  historyPageSize: 30,
  capWarningMs: 5 * 60_000,
  pollMs: { idle: 4_000, ringing: 2_000, notReady: 60_000, min: 2_000, max: 60_000 },
} as const;

export type CallKind = "direct" | "group";
export type CallState = "ringing" | "active" | "ended";
export type CallEndReason = "completed" | "cancelled" | "declined" | "missed" | "empty" | "alone" | "cap" | "failed";
export type ParticipantRole = "caller" | "invitee" | "joiner";
export type ParticipantState = "invited" | "ringing" | "joined" | "left" | "declined" | "missed";
export type NotesConsent = "pending" | "yes" | "no";
export type RecapState = "none" | "pending" | "writing" | "done" | "skipped" | "failed";
export type CallConversationKind = "direct" | "team" | "channel";

/** An assistant as calls draw it: the profile and its small face's shades (the notch draws `face`; the web may ignore it). */
export type CallAssistant = AssistantProfile & { face: FaceShades };
export type CallPerson = { membershipId: string; name: string; firstName: string; profileId: string; avatarKey: string | null; assistant: CallAssistant };
/** Where a call is: "#Design", or the other person's name for a direct call (as the viewer sees it); null name: the
 * viewer cannot read it (a deleted channel). `href`: the thread, or null. */
export type CallWhere = { conversationId: string; kind: CallConversationKind; name: string | null; href: string | null };
/** `consent`: the viewer's own answer on their own row; on someone else's row only "yes" (else null): a "no" is never shown. */
export type CallParticipantView = CallPerson & {
  role: ParticipantRole; state: ParticipantState; you: boolean; inRoom: boolean;
  rangAt: string | null; firstJoinedAt: string | null; joinedAt: string | null; leftAt: string | null; consent: NotesConsent | null;
};
export type CallNotesView = {
  state: "off" | "on"; everOn: boolean; onBy: CallPerson | null; onAt: string | null; offAt: string | null;
  /** The viewer's own answer; null when the viewer was never in the call (they cannot answer). */
  myConsent: NotesConsent | null;
  /** Who said yes (their words may be used), in the order they did. Never who said no. */
  included: CallPerson[];
  /** People in the room now who have not answered. */
  pendingCount: number;
  recap: RecapState;
};
export type CallView = {
  id: string; kind: CallKind; state: CallState; where: CallWhere; room: string;
  startedBy: CallPerson; startedAt: string; answeredAt: string | null; endedAt: string | null; endReason: CallEndReason | null;
  /** Answered → ended (→ serverNow while live); null when never answered. */
  durationSeconds: number | null;
  /** startedAt + 4 hours: the call ends then. */
  endsAt: string;
  /** In the room first, then ringing, then the rest (joined order within each). */
  participants: CallParticipantView[];
  inRoom: number;
  me: {
    membershipId: string; state: ParticipantState | null; role: ParticipantRole | null;
    /** "participant": has a row; "reader": reads the conversation (a live group call they may join; an ended one shows its summary only). */
    access: "participant" | "reader";
    canJoin: boolean; canDecline: boolean; canLeave: boolean; canEnd: boolean;
    /** The viewer's other live call, when they are in one. */
    elsewhere: { callId: string; where: CallWhere } | null;
  };
  notes: CallNotesView;
  serverNow: string;
};
export type CallConnection = { url: string; token: string; identity: string; expiresAt: string };
export type RingingCall = { id: string; kind: CallKind; caller: CallPerson; where: CallWhere; rangAt: string; expiresAt: string; href: string; inAnotherCall: boolean };
export type ActiveCall = { id: string; kind: CallKind; where: CallWhere; startedAt: string; answeredAt: string | null; joinedAt: string; inRoom: number; href: string };
/**
 * GET /calls/now: what the overlay, the dock and the notch need. `me`: the viewer's membership id. `ringsOnDesktop`: a
 * signed-in notch on this browser's network rings this person's calls aloud (it said so in the last 20 seconds), so the
 * browser shows the incoming card without its own ring (fix review, 10 October 2026: one ringer, never two).
 */
export type CallsNow = { ready: boolean; available: boolean; me: string | null; ringing: RingingCall[]; active: ActiveCall | null; pollMs: number; serverNow: string; ringsOnDesktop: boolean };
/** A live call in a conversation the viewer reads (thread headers, the Calls page's "Happening now"). */
export type LiveCallSummary = { id: string; kind: CallKind; where: CallWhere; startedBy: CallPerson; startedAt: string; inRoom: number; people: CallPerson[]; notesOn: boolean; youAreIn: boolean; href: string };
/** From the viewer's side: they joined; they were rung and missed it; they declined; they started it and nobody answered. */
export type CallOutcome = "joined" | "missed" | "declined" | "not_answered";
export type CallHistoryItem = {
  id: string; kind: CallKind; where: CallWhere; startedBy: CallPerson; youStarted: boolean; startedAt: string; endedAt: string | null;
  durationSeconds: number | null; live: boolean; outcome: CallOutcome; people: CallPerson[]; peopleCount: number; recap: RecapState; href: string;
};
export type CallHistoryList = { ready: boolean; items: CallHistoryItem[]; nextBefore: string | null };
/** A call's line or recap message in its thread (MessageRow.call). */
export type CallLineView = {
  id: string; part: "line" | "recap"; kind: CallKind; state: CallState; startedBy: { membershipId: string; firstName: string };
  startedAt: string; answeredAt: string | null; endedAt: string | null; endReason: CallEndReason | null;
  inRoom: number; joinedCount: number; joinedNames: string[]; href: string;
};
/** Participant metadata the server puts in a LiveKit token (the browser draws tiles from it until the call view arrives). */
export type CallTokenMetadata = { v: 1; name: string; profileId: string; avatarKey: string | null; assistant: AssistantProfile };

export const callHref = (slug: string, id: string) => `/app/${slug}/calls/${id}`;
export const ringExpiresAt = (rangAt: string) => new Date(Date.parse(rangAt) + CALL_LIMITS.ringMs).toISOString();

/** "under a minute", "1 min", "12 min", "1 h", "1 h 5 min". */
export function callDurationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 60) return "under a minute";
  const m = Math.floor(seconds / 60), h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${m} min`;
}
/** A live clock: "0:42", "12:04", "1:02:09". */
export function callClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "1 person", "3 people". */
const peopleCount = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** Every word a person reads about calls (plain British English; owner decisions, 8 October 2026: phase 8). */
export const CALL_WORDS = {
  nav: "Calls",
  call: "Call",
  callPerson: (name: string) => `Call ${first(name)}`,
  callIn: (where: string) => `Start a call in ${where}`,
  join: "Join",
  joinCount: (n: number) => `Join (${n})`,
  joinCall: "Join call",
  joinHere: "Join here instead",
  // The notch's missed-call card while the person is on another call (fix review, 10 October 2026): its Join leaves that
  // call first, as the incoming card's Accept does, under errors.inAnotherCall.
  leaveAndJoin: "Leave it and join",
  accept: "Accept",
  decline: "Decline",
  message: "Message",
  leave: "Leave",
  endForEveryone: "End for everyone",
  callBack: "Call back",
  callAgain: "Call again",
  backToCall: "Back to call",
  // Buttons' full names, so a list of "Call back" buttons says who each one calls (fix review, 10 October 2026); each
  // still starts with the words on the button.
  names: {
    callBack: (name: string) => `Call back ${first(name)}`,
    callAgainWith: (name: string) => `Call again with ${first(name)}`,
    callAgainIn: (where: string) => `Call again in ${where}`,
    join: (where: { kind: CallConversationKind; name: string | null }, n: number) =>
      `Join the call ${where.kind === "direct" ? `with ${where.name ?? "them"}` : `in ${where.name ?? "the channel"}`}, ${peopleCount(n)} in it`,
  },
  incoming: {
    title: (name: string) => `${name} is calling`,
    direct: "Call",
    group: (where: string) => `Call in ${where}`,
    waiting: "You're on another call. Accepting leaves it.",
    more: (n: number) => `+${n} more calling`,
    // The card never takes the focus; this keyboard shortcut moves it to Accept (fix review, 10 October 2026).
    shortcut: "Alt+Shift+A",
    announce: (name: string) => `${name} is calling. Press Alt Shift A, then Enter, to answer.`,
    acceptTip: "Accept (Alt+Shift+A)",
    silence: "Silence the ring",
    silenced: "Ring silenced",
    declineFailed: "That didn't go through. Try again.",
    // The notch's ring strip on a card that must stay (fix review, 10 October 2026: it offered only Accept).
    declineFrom: (name: string) => `Decline ${first(name)}'s call`,
  },
  // Settings → Your assistant → Calls (owner decision, 10 October 2026: incoming calls get their own sound setting,
  // separate from Brenda's sound effects, on by default).
  settings: {
    section: "Calls",
    description: "How this browser tells you someone is calling.",
    ring: "Ring for incoming calls",
    ringHint: (assistant: string) => `Plays a ring in this browser when someone calls. ${assistant}'s chimes have their own switch. When the desktop app rings for you, this browser stays quiet.`,
  },
  quickMessages: ["Can't talk now. I'll call you back.", "In a meeting. I'll call you after.", "Can you send me a message instead?"] as const,
  declineWithMessage: "Decline with a message",
  ownMessage: "Write your own",
  sendAndDecline: "Send and decline",
  outgoing: {
    ringing: (name: string) => `Calling ${first(name)}…`,
    ringingGroup: (where: string) => `Ringing people in ${where}…`,
    notRung: (name: string) => `${first(name)} isn't taking calls right now. They'll see that you called.`,
    offline: (name: string) => `${first(name)} looks offline. They'll see that you called.`,
    declined: (name: string) => `${first(name)} can't take the call`,
    sentMessage: (name: string) => `${first(name)} sent you a message`,
    noAnswer: (name: string) => `${first(name)} didn't answer`,
    nobodyRung: "Nobody else is online. People in the channel can join while it runs.",
  },
  stage: {
    waiting: "Waiting for people to join",
    alone: "You're the only one here",
    reconnecting: "Reconnecting…",
    connecting: "Connecting…",
    couldNotConnect: "Couldn't connect. Try again.",
    unsupported: "This browser can't make calls. Try a recent Chrome, Edge, Firefox or Safari.",
    otherDevice: "You joined this call from another tab or device.",
    inAnotherCall: (where: string) => `You're on a call in ${where}. Leave it and join this one?`,
    // Starting a NEW call while on another one (fix review, 10 October 2026: it asked to "join this one").
    leaveAndStart: (where: string) => `You're on a call in ${where}. Leave it and start this one?`,
    ended: "Call ended",
    full: "This call is full (50 people).",
    capSoon: "This call ends in 5 minutes. Calls last up to 4 hours.",
    joined: (name: string) => `${first(name)} joined`,
    left: (name: string) => `${first(name)} left`,
    youLeft: "You left the call",
    // Who is in it, on the panel before joining: never "You is in it" (fix review, 10 October 2026).
    inIt: (people: { firstName: string; you: boolean }[]) =>
      people.length === 0 ? "Waiting for people to join" : people.length > 1 ? peopleCount(people.length) : people[0].you ? "You're in it" : `${people[0].firstName} is in it`,
    beforeYouJoin: "Before you join",
    startAudio: "Turn on sound",
    noDevices: "Join without microphone or camera",
    rejoin: "Rejoin",
    cancel: "Cancel",
    back: "Back",
    backToThread: "Back to the conversation",
    deviceMenu: "Microphone and camera",
    microphone: "Microphone",
    camera: "Camera",
    callTime: (clock: string) => `Call time ${clock}`,
    peopleOnCall: "People on the call",
    previousPeople: "Previous people",
    nextPeople: "Next people",
    pageOf: (page: number, pages: number) => `${page} of ${pages}`,
    onTheCall: (names: string[]) => `On the call: ${names.join(", ")}`,
    you: "you",
    peopleCount,
    // How an ended call ended, on its page (fix review, 10 October 2026: "one person left for 15 minutes" read as if
    // someone went away for 15 minutes).
    endReasons: {
      completed: "Call ended", cancelled: "Cancelled", declined: "Declined", missed: "Missed", empty: "Call ended",
      alone: "Ended after 15 minutes with only one person on it", cap: "Ended at the 4-hour limit", failed: "Couldn't connect",
    } as Record<CallEndReason, string>,
  },
  // The People sheet on a call.
  people: {
    title: "People",
    inCall: (n: number) => `${n} in the call`,
    states: { joined: "In the call", ringing: "Ringing", invited: "Not rung", declined: "Declined", missed: "Missed", left: "Left" } as Record<ParticipantState, string>,
    included: "Included",
    you: "(you)",
    button: (n: number) => `People, ${n}`,
  },
  controls: { label: "Call controls", leaveOrEnd: "Leave or end the call", endConfirm: "End for everyone?", endBody: "Everyone is disconnected." },
  // Toggles keep one name and say their state with aria-pressed: pressed means muted, the camera off, the screen shared
  // (fix review, 10 October 2026: the camera's meant the opposite of the microphone's).
  mic: { mute: "Mute", unmute: "Unmute", blocked: "Your browser blocked the microphone. You can still listen.", none: "No microphone found.", busy: "The microphone is busy or didn't start." },
  camera: { toggle: "Camera off", off: "Turn camera off", on: "Turn camera on", blocked: "Your browser blocked the camera.", none: "No camera found.", busy: "The camera is busy or didn't start." },
  screen: {
    start: "Share screen", stop: "Stop sharing", sharing: (name: string) => `${first(name)} is sharing their screen`, you: "You're sharing your screen",
    unsupported: "Screen sharing isn't available in this browser.", failed: "Screen sharing didn't start. Try again.",
  },
  quality: { excellent: "Connection: excellent", good: "Connection: good", poor: "Connection: poor", lost: "Connection lost", unknown: "Connection: checking" },
  // After a status in a list or a card: "Available, on a call" (sentence case; fix review, 10 October 2026).
  onCall: "on a call",
  thread: {
    started: (name: string) => `${first(name)} started a call`,
    missed: (name: string) => `Missed call from ${first(name)}`,
    // A one-to-one call its person declined (fix review, 10 October 2026: it said "Missed call" to the one who declined).
    declined: (name: string) => `Declined call from ${first(name)}`,
    done: (seconds: number | null) => `Call, ${callDurationLabel(seconds)}`,
    live: "Live",
    details: "Details",
    endedGroup: (seconds: number | null, n: number) => `Call ended, ${callDurationLabel(seconds)}, ${peopleCount(n)}`,
  },
  history: {
    title: "Calls", all: "All", missed: "Missed", now: "Happening now",
    empty: "No calls yet",
    emptyHint: "Call someone from Messages or their card.",
    openMessages: "Open Messages",
    emptyMissed: "No missed calls.",
    outcome: { joined: "Joined", missed: "Missed", declined: "Declined", not_answered: "Not answered" } as Record<CallOutcome, string>,
    you: "You",
    deletedChannel: "A deleted channel",
    // "Started 14:05, 3 people", "Started yesterday, 23:50, 3 people".
    started: (when: string, n: number) => `Started ${when}, ${peopleCount(n)}`,
    notes: "Notes",
    yours: "Your calls",
    missedList: "Missed calls",
    loadMore: "Load more",
    loadMoreFailed: "Couldn't load more. Try again.",
  },
  notifications: {
    kinds: { "call.missed": "Missed call", "call.recap": "Call notes" } as Record<string, string>,
    missed: (name: string, where: string | null) => (where ? `Missed call from ${name} in ${where}` : `Missed call from ${name}`),
  },
  notReady: "Calls need a database update first. Try again later.",
  notConfigured: "Calls aren't set up on this server yet.",
  errors: {
    notFound: "That call isn't available.",
    ended: "This call has ended.",
    full: "This call is full (50 people).",
    notHere: "Calls start from a direct message, a team channel or a channel.",
    inAnotherCall: "You're on another call.",
    answered: "That call was already answered.",
    impersonated: (name: string) => `Only ${first(name)} can be on calls. You're signed in as them.`,
    rateLimited: "You've started a lot of calls. Try again in a few minutes.",
    noLiveKit: "Calls can't connect right now. Try again in a moment.",
    notAllowed: "Only the person who started this call can end it for everyone.",
  },
} as const;
