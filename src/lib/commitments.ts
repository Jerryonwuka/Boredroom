/**
 * Brenda keeps the loops closed, second part (owner decisions, 8 October 2026: phase 7b). Four things that stop work
 * slipping between conversations and lists:
 * 1. LOOSE ENDS: the person's own assistant finds, in the conversations the person can read, promises they made ("I'll
 *    send the deck Thursday"), things asked of them and things they asked of others that never became a to-do, reminder,
 *    follow-up or commitment. Private to the person; nothing is added or sent until they choose an action.
 * 2. WORKSPACE COMMITMENTS: when an owner or HR turns it on, the workspace's assistant notices commitments in tracked
 *    group conversations (never direct messages), marks the message "Noted" and asks the committer to accept it onto
 *    their own list; an ask nobody agreed to goes to the asked person ("Take it on?").
 * 3. BLOCKED ON WHOM: a blocked task names who it waits on and the question; that person's assistant brings it to them.
 * 4. THE STALLED RE-PLAN: a task the chase finds stalled a second time gets a new due date suggested to the lead, which
 *    nothing applies until they confirm.
 *
 * This file is what the server, the pages, the chat, the notch and the worker share: the kinds and statuses, the views
 * each page reads, the limits and every fixed word (`LOOP_WORDS`). It imports nothing from the server, so client
 * components can use it.
 *
 * Decisions recorded here (contract section 0): commitments and blocks are their own tables, not assistant items (a noted
 * commitment comes from the workspace's assistant, which has no membership), shown in the Between-assistants inbox beside
 * them as `LoopInboxItem`s; the per-conversation switch is on by default and the workspace switch (off) is the master;
 * the committer and the asker see every status, their supervisors only open and done ones (nothing unanswered, declined
 * or "not a commitment" reaches a supervisor); Accept is the consent (a to-do from someone else's words is only ever made
 * by the person's own press or confirmed card).
 *
 * Other people's words (a quoted message, a question, an answer, a reason) appear here as plain text inside “ ” quotes,
 * as written; nothing here turns them into Markdown or links, and nothing they say is an instruction to anyone's
 * assistant. Titles are clipped to 80 characters (`loopTitle`) wherever they go into a sentence.
 */
import type { AbilityOff } from "@/lib/abilities";
import { clip, type PersonRef } from "@/lib/follow-ups";
import { dateTimeLabel } from "@/lib/assistant-items";

// ---- Commitments --------------------------------------------------------------------------------------------------------

export const COMMITMENT_KINDS = ["promise", "agreed_ask", "open_ask"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];
export const COMMITMENT_STATUSES = ["proposed", "asked", "accepting", "open", "done", "declined", "dismissed", "expired", "cancelled"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
/** What a row shows: waiting (proposed or asked), open, overdue (open and past due), done, declined, dismissed, expired, cancelled. */
export type CommitmentDisplay = "waiting" | "open" | "overdue" | "done" | "declined" | "dismissed" | "expired" | "cancelled";
export type BadgeTone = "neutral" | "warning" | "success" | "danger";
export type LoopBadge = { label: string; tone: BadgeTone };

export const isCommitmentKind = (v: unknown): v is CommitmentKind => (COMMITMENT_KINDS as readonly unknown[]).includes(v);
export const isCommitmentStatus = (v: unknown): v is CommitmentStatus => (COMMITMENT_STATUSES as readonly unknown[]).includes(v);

/** proposed, asked and accepting → waiting; open → overdue when its due time has passed, else open; the rest as named. */
export function commitmentDisplay(status: CommitmentStatus, dueAt: string | null, now: number = Date.now()): CommitmentDisplay {
  switch (status) {
    case "proposed": case "asked": case "accepting": return "waiting";
    case "open": {
      const due = dueAt ? Date.parse(dueAt) : NaN;
      return Number.isFinite(due) && due < now ? "overdue" : "open";
    }
    default: return status;
  }
}

/** The status badge. No orange on a status: waiting for the committer is `warning`, overdue `danger`, done `success`. */
export function commitmentBadge(d: CommitmentDisplay, viewer: "committer" | "asker" | "supervisor"): LoopBadge {
  switch (d) {
    case "waiting": return viewer === "committer" ? { label: "Needs your answer", tone: "warning" } : { label: "Waiting", tone: "neutral" };
    case "open": return { label: "Open", tone: "neutral" };
    case "overdue": return { label: "Overdue", tone: "danger" };
    case "done": return { label: "Done", tone: "success" };
    case "declined": return { label: "Declined", tone: "neutral" };
    case "dismissed": return { label: "Not a commitment", tone: "neutral" };
    case "expired": return { label: "Expired", tone: "neutral" };
    case "cancelled": return { label: "Cancelled", tone: "neutral" };
  }
}

export type MessageLabelState = "noted" | "done" | "declined" | "dismissed";
/**
 * A message's commitment label (text from LOOP_WORDS.label). `private` (owner decision, 9 October 2026: phase 7c): a
 * "Declined" or "Not a commitment" label, which only that commitment's committer and asker read (everyone else reads
 * no label on that message); `other`: the other one of the two, by first name, for "Only you and Ada see this." (null:
 * there is no other, "Only you see this."). "Noted" and "Done" are never private.
 */
export type MessageLabel = { state: MessageLabelState; text: string; private: boolean; other?: string | null };
/** The label states only the commitment's two people read (owner decision, 9 October 2026). */
export const PRIVATE_LABEL_STATES: readonly MessageLabelState[] = ["declined", "dismissed"];
export const isMessageLabelState = (v: unknown): v is MessageLabelState => v === "noted" || v === "done" || v === "declined" || v === "dismissed";

export type CommitmentView = {
  id: string; kind: CommitmentKind; status: CommitmentStatus; display: CommitmentDisplay;
  viewer: "committer" | "asker" | "supervisor";
  title: string; dueAt: string | null; dueWords: string | null; dueLabel: string | null;  // "Thu 9 Oct, 17:00" (org zone)
  committer: PersonRef; asker: PersonRef | null;
  where: { conversationId: string; kind: "team" | "organisation" | "channel"; name: string | null };  // name null: viewer can't read it
  // quote ≤ 280, live, viewer's RLS; null once the message was edited after it was noted (`edited`: the card says so)
  message: { id: string; at: string; href: string | null; quote: string | null; withdrawn: boolean; edited?: boolean };
  agreement: { id: string; href: string | null; quote: string | null; edited?: boolean } | null;
  todo: { id: string; title: string; status: string; href: string } | null;    // only when the viewer can see the task
  detectedBy: "claude" | "builtin";
  createdAt: string; decidedAt: string | null; doneAt: string | null; expiresAt: string;
  declineReason: string | null;      // committer and asker only
  stalled: boolean;                  // stalled_noted_at set
  badge: LoopBadge;
  canAccept: boolean; canDecline: boolean; canDismiss: boolean; canMarkDone: boolean;
  /** Owners and HR hold no to-dos: Accept tracks it without one. */
  acceptMakesTodo: boolean;
  href: string;                      // /app/{slug}/commitments?c={id}
};
export type CommitmentScope = "mine" | "team" | "all";
export type CommitmentFilters = {
  scope: CommitmentScope; person?: string | null;
  status?: "waiting" | "open" | "overdue" | "done" | "declined" | "dismissed" | "all";   // default "all"
  thisWeek?: boolean; before?: string | null; limit?: number;
};
export type CommitmentList = {
  ready: boolean; scopes: CommitmentScope[];   // mine always; team for leads; all for owner/HR
  items: CommitmentView[]; nextBefore: string | null;
  counts: { waiting: number; open: number; overdue: number } | null;  // null: not available
  people: { membershipId: string; name: string }[];                    // the person filter's options in this scope
};
export type CommitmentSettings = { ready: boolean; track: boolean; threadFollowUps: boolean; since: string | null };
export type ConversationTracking = {
  ready: boolean; workspaceOn: boolean; here: boolean; tracked: boolean; canChange: boolean;
  applies: boolean;                        // false on a direct thread: nothing is shown
  workspaceAssistantName: string;          // for the disclosure
};

/** What detection hands foundation (worker). Every id already checked by brain against the conversation's readers. */
export type DetectedCommitment = {
  conversationId: string; sourceMessageId: string; agreementMessageId: string | null;
  kind: CommitmentKind; committerMembershipId: string; askerMembershipId: string | null;
  title: string; dueAt: string | null; dueWords: string | null;
  detectedBy: "claude" | "builtin"; confidence: number; messageAt: string;
};

// ---- Loose ends ---------------------------------------------------------------------------------------------------------

export const LOOSE_END_KINDS = ["promise", "asked_of_me", "i_asked"] as const;
export type LooseEndKind = (typeof LOOSE_END_KINDS)[number];
export type LooseEndStatus = "open" | "todo" | "reminder" | "handed" | "follow_up_scheduled" | "follow_up" | "dismissed" | "resolved";
export type LooseEndAction = "todo" | "remind" | "hand_over" | "follow_up" | "dismiss";
export const LOOSE_END_STATUSES: readonly LooseEndStatus[] = ["open", "todo", "reminder", "handed", "follow_up_scheduled", "follow_up", "dismissed", "resolved"];
export const isLooseEndKind = (v: unknown): v is LooseEndKind => (LOOSE_END_KINDS as readonly unknown[]).includes(v);
/** Which actions each kind offers, in this order. */
export const LOOSE_END_ACTIONS: Record<LooseEndKind, readonly LooseEndAction[]> = {
  promise: ["todo", "remind", "hand_over", "dismiss"],
  asked_of_me: ["todo", "remind", "hand_over", "dismiss"],
  i_asked: ["follow_up", "hand_over", "remind", "todo", "dismiss"],
};
export type LooseEndView = {
  id: string; kind: LooseEndKind; status: LooseEndStatus;
  title: string; dueAt: string | null; dueWords: string | null; dueLabel: string | null;
  counterpart: PersonRef | null;
  message: { id: string; conversationId: string; at: string; href: string; quote: string | null; withdrawn: boolean; where: string };
  // where: "#Design", "Everyone", or "Ben Okafor" for a direct thread
  detectedBy: "claude" | "builtin"; confidence: number; source: "on_demand" | "routine";
  actions: LooseEndAction[];        // allowed now (empty unless open)
  result: { taskId?: string; reminderId?: string; itemId?: string; followUpId?: string; followUpAt?: string; error?: string } | null;
  headline: string;                 // LOOP_WORDS.looseEnds.headline(...)
  createdAt: string; actedAt: string | null;
  href: string;                     // /app/{slug}/home/loose-ends?l={id}
};
/**
 * `off` (phase 7c, owner decisions, 8–9 October 2026): who switched "Loose ends" off for this person (the workspace or
 * they themself); the list is then empty. Null when it is on; absent before migration 0048.
 */
export type LooseEndList = { ready: boolean; items: LooseEndView[]; counts: { open: number }; lastScanAt: string | null; off?: AbilityOff };
export type DetectedLooseEnd = {
  messageId: string; conversationId: string; contextMessageId: string | null; kind: LooseEndKind;
  counterpartMembershipId: string | null; title: string; dueAt: string | null; dueWords: string | null;
  detectedBy: "claude" | "builtin"; confidence: number;
};
export type LooseEndScanResult = {
  ready: boolean; scanned: number; candidates: number; found: LooseEndView[];
  engine: "claude" | "builtin" | "none"; note: string | null;   // e.g. allowance used up, AI off
};

// ---- Blocked on whom ----------------------------------------------------------------------------------------------------

export type TaskBlockStatus = "open" | "answered" | "not_me" | "cleared" | "cancelled";
export type TaskBlockView = {
  id: string; status: TaskBlockStatus; viewer: "blocked" | "waiting_on" | "supervisor";
  taskId: string; taskTitle: string; taskHref: string | null;     // null when the viewer can't see the task
  blocked: PersonRef; waitingOn: PersonRef;
  question: string; answer: string | null; unblocked: boolean;
  createdAt: string; seenAt: string | null; answeredAt: string | null; closedAt: string | null;
  canAnswer: boolean; canNotMe: boolean; canCancel: boolean;
  badge: LoopBadge;
  // open: waiting_on "Needs your answer" (warning), others "Waiting on {first}" (warning); answered "Answered" (success);
  // not_me "Not theirs" (neutral); cleared "Unblocked" (neutral); cancelled "Withdrawn" (neutral)
  href: string;                     // /app/{slug}/home/assistants?f={id}
};
export type WaitingOnList = {
  ready: boolean; scope: "mine" | "team" | "all";
  items: TaskBlockView[];                                           // open only, oldest first
  byPerson: { waitingOn: PersonRef; count: number }[];              // most first
};

/** A block's badge (contract A.3). */
export function taskBlockBadge(status: TaskBlockStatus, viewer: TaskBlockView["viewer"], waitingOnFirst: string): LoopBadge {
  switch (status) {
    case "open": return viewer === "waiting_on" ? { label: "Needs your answer", tone: "warning" } : { label: `Waiting on ${waitingOnFirst}`, tone: "warning" };
    case "answered": return { label: "Answered", tone: "success" };
    // Worded for who reads it (review, 9 October 2026): the person who said "Not me" reads it as theirs to say.
    case "not_me": return { label: viewer === "waiting_on" ? "Not mine" : "Not theirs", tone: "neutral" };
    case "cleared": return { label: "Unblocked", tone: "neutral" };
    case "cancelled": return { label: "Withdrawn", tone: "neutral" };
  }
}

// ---- Re-plan ------------------------------------------------------------------------------------------------------------

export type ReplanView = {
  id: string; status: "proposed" | "confirmed" | "dismissed" | "stale";
  taskId: string; taskTitle: string; taskHref: string;
  previousDueAt: string | null; proposedDueAt: string; proposedLabel: string; confirmedDueAt: string | null;
  followUpId: string | null; canConfirm: boolean;
};

// ---- The inbox ----------------------------------------------------------------------------------------------------------

export type LoopInboxItem =
  | { kind: "commitment"; commitment: CommitmentView }    // a proposal (promise or agreed ask) waiting for its committer
  | { kind: "open_ask"; commitment: CommitmentView }      // an open ask, notified, waiting for the asked person
  | { kind: "blocked_on"; block: TaskBlockView };         // an open block waiting on the viewer

// ---- The notch ----------------------------------------------------------------------------------------------------------

export type DesktopLoops = {
  ready: boolean;
  /** Waiting for this person, oldest first, max 5. */
  commitments: { id: string; kind: "commitment" | "open_ask"; title: string; what: string; dueLabel: string | null;
                 from: { name: string } | null; acceptLabel: string; href: string }[];
  blocks: { id: string; title: string; question: string; taskTitle: string; from: { name: string }; href: string }[];
  looseEnds: { open: number; href: string };
};

// ---- Limits (owner decision, 8 October 2026: constants in code, enforced in the services) --------------------------------

export const LOOP_LIMITS = {
  commitmentTtlDays: 7, openAskGraceMinutes: 60, acceptLeaseSeconds: 120, stuckAcceptingMinutes: 5,
  proposalsPerPersonPerDay: 10, asksPerPairPerDay: 3,
  // "Blocked on you" is a message between assistants: bounded like the others (security review, 9 October 2026).
  blocksPerPairPerDay: 3, blocksPerPersonPerDay: 10,
  scanEveryMinutes: 5, scanWindowHours: 24, scanMessagesPerRun: 200, candidatesPerCall: 25, modelCallsPerScan: 4, modelCallsPerOrgPerDay: 200,
  messageCharsForModel: 600, contextMessages: 2, minMessageChars: 6,
  prefilterMin: 0.35, modelAcceptCommitment: 0.6, modelAcceptLooseEnd: 0.5, builtinAccept: 0.7,
  looseEndDaysDefault: 7, looseEndDaysMax: 14, looseEndMessagesPerScan: 500, looseEndCandidatesPerCall: 20,
  looseEndModelCallsOnDemand: 3, looseEndModelCallsRoutine: 1, looseEndScanCooldownSeconds: 120,
  capturedSimilarity: 0.6, capturedLookbackDays: 14,
  titleMax: 200, whatMax: 120, dueWordsMax: 60, declineReasonMax: 280, questionMax: 500, answerMax: 1000, quoteMax: 280,
  stalledWorkingDays: 2, dueReminderTime: "09:00",
  listMax: 50, waitingMax: 20, desktopMax: 5, homeLooseEndsShown: 3, reportShown: 10,
} as const;

/** Every place that would read or start one of these before migration 0048 is applied says this (copilot, the helper). */
export const LOOPS_NOT_READY = "Loose ends and commitments need a database update first. Try again later.";
/** The routes that change something answer 503 with this before 0048. */
export const LOOPS_NOT_READY_SHORT = "This needs a database update first. Try again later.";

/** How long a title may run inside a sentence (“…”): 80 characters, as everywhere else. */
export const LOOP_TITLE_CLIP = 80;
/** A title as it goes into a sentence: one line, at most 80 characters. */
export const loopTitle = (s: string | null | undefined) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), LOOP_TITLE_CLIP);
/** "Thu 9 Oct, 17:00" in the organisation's zone, or null. */
export const loopDueLabel = (iso: string | null | undefined, timeZone: string): string | null => (iso ? dateTimeLabel(iso, timeZone) || null : null);

// ---- Pages (paths built from a slug and ids; contract A.3) ---------------------------------------------------------------

export const commitmentHref = (slug: string, id: string) => `/app/${slug}/commitments?c=${id}`;
export const looseEndHref = (slug: string, id: string) => `/app/${slug}/home/loose-ends?l=${id}`;
export const blockHref = (slug: string, id: string) => `/app/${slug}/home/assistants?f=${id}`;
/** Where a commitment's notification and inbox card open: the Between-assistants inbox, the card highlighted. */
export const commitmentInboxHref = (slug: string, id: string) => `/app/${slug}/home/assistants?f=${id}`;

// ---- Fixed words: `LOOP_WORDS` (contract A.4) ------------------------------------------------------------------------------
// W = the workspace assistant's name ("Brenda"), A = the person's own assistant's name ("Max"), first names as given.

export const LOOP_WORDS = {
  label: {
    noted: "Noted", done: "Done", declined: "Declined", dismissed: "Not a commitment",
    aria: (W: string, state: MessageLabelState) => state === "noted" ? `${W} noted a commitment here` : `Commitment: ${({ done: "done", declined: "declined", dismissed: "not a commitment", noted: "noted" })[state]}`,
    // Phase 7c (owner decision, 9 October 2026): a declined or "not a commitment" label is the two people's only.
    privateHint: (other: string | null | undefined) => (other ? `Only you and ${other} see this.` : "Only you see this."),
  },
  disclosure: (W: string) => `${W} notes commitments made here; people accept them onto their own list.`,
  conversationSwitch: {
    label: "Note commitments here",
    hint: (W: string) => `${W} notices promises and agreed asks in this conversation and asks each person to accept them onto their own list. Never in direct messages.`,
    offWorkspace: (W: string) => `Off for the whole workspace. The owner or HR can turn it on in Settings, ${W}.`,
    readOnlyOn: (W: string) => `${W} notes commitments made here.`,
    readOnlyOff: "Commitments aren't noted here.",
    forbidden: "Only someone who runs this conversation can change this.",
  },
  settings: {
    card: "Commitments in group chats",
    track: "Track commitments in group chats",
    trackHint: (W: string) => `${W} notices commitments made in channels, team chats and Everyone (never direct messages), marks them “Noted” and asks each person to accept them onto their own to-dos. Each tracked conversation says so, and whoever runs it can turn it off there.`,
    threadFollowUps: "Post gentle follow-ups in the thread",
    threadFollowUpsHint: (W: string) => `When a commitment is ${LOOP_LIMITS.stalledWorkingDays} working days overdue with no progress, ${W} also posts a short follow-up in the thread where it was made. Off: only the people involved are told, privately.`,
    badge: { on: "On", off: "Off" },
    pageNote: "Commitments are private to the people involved; team leads, the owner and HR see the accepted ones of the people whose records they can see.",
    notReady: "This needs a database update first.",
    forbidden: "Only the organisation owner or HR can change this.",
  },
  inbox: {
    commitmentTitle: (W: string, title: string) => `${W} noted you said you'd “${title}”`,
    agreedTitle: (W: string, askerFirst: string, title: string) => `${W} noted you agreed to ${askerFirst}'s ask: “${title}”`,
    commitmentQuestion: "Add it to your to-dos?",
    commitmentQuestionNoTodos: "Track it as your commitment?",
    openAskTitle: (askerFirst: string, title: string) => `${askerFirst} asked you to “${title}”`,
    openAskQuestion: "Take it on?",
    accept: "Add to my to-dos", acceptNoTodos: "Accept", takeItOn: "Take it on",
    decline: "Decline", dismiss: "Not a commitment",
    declinePlaceholder: "Say why, if you like",
    nothingChanges: "Nothing is added until you accept.",
    askerToldOnDecline: (askerFirst: string) => `${askerFirst} is told what you decide.`,
    accepted: "Added to your to-dos.", acceptedNoTodo: "Tracked as your commitment.",
    acceptedButNoTodo: "Accepted, but the to-do couldn't be added. Add it from your to-dos.",
    declined: "Declined.", dismissed: "Marked as not a commitment. It won't come back.",
    blockedTitle: (blockedFirst: string) => `${blockedFirst} is blocked on you`,
    blockedOn: (taskTitle: string) => `On “${taskTitle}”`,
    answer: "Answer", notMe: "Not me", answerPlaceholder: "Your answer", unblocks: "This unblocks it",
    sendAnswer: "Send answer", answered: (blockedFirst: string) => `Sent. ${blockedFirst} sees it as your comment on the task.`,
    notMeDone: (blockedFirst: string) => `${blockedFirst} is told it isn't yours.`,
  },
  notifications: {
    kinds: {
      "brenda.commitment": "Commitment noted", "brenda.open_ask": "Asked of you", "brenda.commitment_accepted": "Commitment accepted",
      "brenda.commitment_declined": "Commitment declined", "brenda.commitment_due": "Due today", "brenda.commitment_stalled": "Commitment overdue",
      "brenda.blocked_on": "Blocked on you", "brenda.block_answered": "Answer", "brenda.block_not_me": "Blocked on someone else",
      "brenda.replan": "Re-plan",
    } as Record<string, string>,
    commitment: (W: string, title: string) => `${W} noted you said you'd “${title}”`,
    agreed: (W: string, askerFirst: string, title: string) => `${W} noted you agreed to “${title}” for ${askerFirst}`,
    commitmentBody: "Add it to your to-dos? Nothing is added until you accept.",
    openAsk: (askerFirst: string, title: string) => `${askerFirst} asked you to “${title}”`,
    openAskBody: (askerFirst: string) => `Take it on? ${askerFirst} is told what you decide.`,
    accepted: (first: string, title: string) => `${first} took on “${title}”`,
    declined: (first: string, title: string) => `${first} can't take on “${title}”`,
    declinedBody: (reason: string | null) => (reason ? `“${reason}”` : "No reason given."),
    due: (title: string) => `Due today: “${title}”`,
    dueBody: (askerFirst: string | null) => `You said you'd do this${askerFirst ? ` for ${askerFirst}` : ""}. Mark it done when it's done.`,
    stalled: (title: string) => `“${title}” is ${LOOP_LIMITS.stalledWorkingDays} working days overdue`,
    stalledBody: (committerFirst: string) => `${committerFirst} hasn't moved it since it was due. Only you were told.`,
    blockedOn: (blockedFirst: string) => `${blockedFirst} is blocked on you`,
    blockedOnBody: (question: string) => `“${question}”`,
    blockAnswered: (first: string, answer: string) => `${first} answered: “${answer}”`,
    blockAnsweredBody: (unblocked: boolean, taskTitle: string) => unblocked ? `“${taskTitle}” is back in progress.` : `“${taskTitle}” is still blocked.`,
    blockNotMe: (first: string) => `${first} says it isn't theirs`,
    blockNotMeBody: "Name someone else, or tell your team lead.",
    replan: (taskTitle: string) => `Re-plan “${taskTitle}”?`,
    replanBody: (label: string) => `It stalled again. Suggested new due date: ${label}. Nothing changes until you confirm.`,
    acceptInterrupted: "Accepted, but Boredroom couldn't confirm the to-do was added. Check your to-dos.",
  },
  thread: {
    // Only Boredroom's words (security review, 9 October 2026): the title is someone's own words (the committer may
    // even rewrite it on accept), and this is posted as the workspace's assistant. It replies to the message itself, so
    // the thread already shows what it is about.
    followUp: (dueLabel: string | null) => `A gentle nudge on this${dueLabel ? ` (due ${dueLabel})` : ""}: is it still on its way?`,
  },
  page: {
    title: "Commitments",
    description: "Promises and agreed asks from group chats, and who is waiting on whom.",
    tabs: { mine: "My commitments", team: "Team", all: "Everyone", waitingOn: "Waiting on" },
    columns: { what: "What", who: "Who", askedBy: "Asked by", where: "Where", due: "Due", status: "Status" },
    filters: { person: "Person", everyone: "Everyone", overdue: "Overdue", thisWeek: "This week", status: "Status" },
    emptyMine: { title: "No commitments yet", body: "When you promise something in a tracked group chat, it shows here once you accept it." },
    emptyTeam: { title: "Nothing here", body: "Accepted commitments of the people on your teams show here." },
    emptyAll: { title: "Nothing here", body: "Accepted commitments of everyone in the workspace show here." },
    emptyWaiting: { title: "Nobody is waiting on anyone", body: "When someone marks a task blocked and names who it waits on, it shows here." },
    trackingOff: (W: string) => `Tracking is off. The owner or HR can turn it on in Settings, ${W}.`,
    // The owner and HR read the one they can act on, with the link (review, 9 October 2026).
    trackingOffAdmin: "Tracking is off. Turn it on in Settings, under Commitments in group chats.",
    openSettings: "Open Settings",
    noMessage: "Only people in that conversation can see the message.",
    withdrawn: "The message was withdrawn.",
    edited: "The message was edited after it was noted.",
    openTodo: "To-do", openMessage: "Message", markDone: "Mark done",
    waitingRow: (blocked: string, waitingOn: string) => `${blocked} is waiting on ${waitingOn}`,
    since: (when: string) => `since ${when}`,
    notReady: "This needs a database update first.",
    showMore: "Show more",
  },
  looseEnds: {
    title: "Loose ends",
    description: (A: string) => `What ${A} found in your conversations that never became a to-do, reminder, follow-up or commitment. Only you see this.`,
    headline: (kind: LooseEndKind, title: string, counterpartFirst: string | null) =>
      kind === "promise" ? `You said you'd “${title}”${counterpartFirst ? ` for ${counterpartFirst}` : ""}`
      : kind === "asked_of_me" ? `${counterpartFirst ?? "Someone"} asked you to “${title}”`
      : `You asked ${counterpartFirst ?? "someone"} to “${title}”`,
    actions: { todo: "Make it a to-do", remind: "Remind me", hand_over: (first: string) => `Hand it to ${first}'s assistant`, handOverSomeone: "Hand it to someone's assistant", follow_up: "Follow up later", dismiss: "Not a commitment" },
    actionsFor: (title: string) => `Actions for “${title}”`,
    look: "Look for loose ends", looking: "Looking…",
    seeAll: (n: number) => `See all ${n}`,
    empty: { title: "No loose ends", body: (A: string) => `Ask ${A} “Any loose ends?”, or look now.` },
    noneOpen: { title: "Nothing open", body: (A: string) => `Everything found so far was dealt with. Ask ${A} “Any loose ends?”, or look again.` },
    foundNone: "Nothing new: no loose ends in your conversations.",
    found: (n: number) => (n === 1 ? "Found 1 loose end." : `Found ${n} loose ends.`),
    builtinNote: "The AI isn't on, so only the clearest ones were found.",
    allowanceNote: (limit: number) => `You've used today's ${limit} requests, so only the clearest ones were found.`,
    confirmTodo: { title: "Add this to your to-dos?", body: "It comes from words in a conversation, so you confirm it first.", save: "Add to-do" },
    confirmFollowUp: { title: "Follow up later?", body: (first: string, when: string) => `On ${when}, your assistant asks ${first}'s assistant about it. Nothing is asked before then.`, save: "Schedule" },
    confirmHandOver: { title: "Hand it over?", body: (first: string) => `${first} gets a request to add it to their to-dos. Nothing changes until they accept.`, save: "Send request" },
    remind: { title: "Remind me", at: "When", save: "Set reminder" },
    done: { todo: "Added to your to-dos.", reminder: (when: string) => `Reminder set for ${when}.`, handed: (first: string) => `Sent to ${first}'s assistant.`, followUp: (when: string) => `Scheduled for ${when}.`, dismissed: "Marked as not a commitment. It won't come back." },
    status: { todo: "To-do", reminder: "Reminder set", handed: "Handed over", follow_up_scheduled: (when: string) => `Follow-up ${when}`, follow_up: "Followed up", dismissed: "Not a commitment", resolved: "Done elsewhere" },
    privacy: "Only you see your loose ends. Nothing is added to a list or sent to anyone until you choose.",
    notReady: "This needs a database update first.",
  },
  block: {
    waitingOn: "Waiting on", nobody: "Nobody in particular", question: "Your question to them",
    questionHint: (first: string) => `${first}'s assistant brings them this to answer.`,
    shown: (first: string, q: string) => `Waiting on ${first}: “${q}”`,
    answeredLine: (first: string, a: string) => `${first} answered: “${a}”`,
    notMeLine: (first: string) => `${first} says it isn't theirs. Name someone else?`,
    // Review, 9 October 2026: the prompt is for the holder only; the person who said it reads it in the first person.
    notMeLineMine: "You said it isn't yours.",
    notMeLineOthers: (first: string) => `${first} says it isn't theirs.`,
    change: "Change", stop: "Stop waiting", add: "Waiting on someone?",
    cantSeeTask: (first: string) => `${first} can't open this task; they see your question and its title.`,
    notReady: "This needs a database update first.",
  },
  replan: {
    title: "Re-plan", line: (title: string, label: string) => `“${title}” stalled again. Suggested new due date: ${label}.`,
    confirm: "Confirm new date", change: "Change date", notNow: "Not now",
    confirmed: (label: string) => `Due date moved to ${label}.`, dismissed: "Kept the due date as it is.",
    stale: "The task changed since, so this suggestion no longer applies.",
  },
  errors: {
    notReady: LOOPS_NOT_READY_SHORT, notFound: "That isn't here any more.", closed: "This was already answered.",
    expired: "This has expired.", tooLong: (n: number) => `Keep it to ${n} characters.`,
    impersonated: (first: string) => `Only ${first} can answer this. It stays as it is while someone else is signed in as them.`,
    notHolder: "Only the person the task is assigned to can say who it waits on.",
    notBlocked: "Mark the task blocked first.", self: "That's you.", notMember: (name: string) => `${name} isn't an active member of this workspace.`,
    emptyQuestion: "Say what you need from them.", emptyAnswer: "Write an answer first.",
    direct: "Direct messages are never tracked.", scanCooldown: "Looked a moment ago. Try again in a couple of minutes.",
    impersonatedBlock: (first: string) => `Only ${first} can say who this waits on. It stays as it is while someone else is signed in as them.`,
    blockMuted: (first: string) => `${first} isn't taking messages from your assistant right now.`,
    blockLimitPair: (first: string) => `You've named ${first} on blocked tasks ${LOOP_LIMITS.blocksPerPairPerDay} times today. Message them directly, or try again tomorrow.`,
    blockLimitDay: `You've named people on blocked tasks ${LOOP_LIMITS.blocksPerPersonPerDay} times today. Try again tomorrow.`,
  },
} as const;

/** The label a message carries, in words (`LOOP_WORDS.label`). */
export function messageLabel(state: MessageLabelState, other?: string | null): MessageLabel {
  const isPrivate = PRIVATE_LABEL_STATES.includes(state);
  return isPrivate ? { state, text: LOOP_WORDS.label[state], private: true, other: other ?? null } : { state, text: LOOP_WORDS.label[state], private: false };
}

/** What a loose end shows once something was done with it (`LOOP_WORDS.looseEnds.status`); null while it is open. */
export function looseEndStatusWords(status: LooseEndStatus, followUpLabel?: string | null): string | null {
  const s = LOOP_WORDS.looseEnds.status;
  switch (status) {
    case "open": return null;
    case "follow_up_scheduled": return s.follow_up_scheduled(followUpLabel ?? "");
    default: return s[status];
  }
}
