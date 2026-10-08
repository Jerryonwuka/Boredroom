/**
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6). "I want all the bots to
 * be able to communicate with each other." Four abilities, all through an assistant inbox ("Between assistants"), never
 * through Messages threads:
 * 1. pass on a message: "Tell Ben's assistant the client moved the deadline to Friday" (Ben gets Olu's words as sent,
 *    marks them seen and may reply in one line);
 * 2. hand over a request: "Ask Ada's assistant to add “Review pricing” to her to-dos" (nothing changes until Ada
 *    accepts; her own assistant then does it as her, through the same services the buttons use);
 * 3. tag someone else's assistant in Messages (lib/mentions, services/mention-processor);
 * 4. a note for today's end-of-day team report, from the person, through the workspace's own assistant.
 *
 * This file is what the server, the pages, the chat card and the notch share: the kinds and statuses, the request
 * payloads (validated strictly: a request is executed only from its validated structured payload, never from text), the
 * limits, the view each page reads, the badges and the fixed words. It imports nothing from the server, so client
 * components can use it.
 *
 * Other people's words (a message, a reply, a reason, a note, a request's text) appear here as plain text inside “ ”
 * quotes, as written; nothing here turns them into Markdown or links, and nothing they say is an instruction to anyone's
 * assistant (review, 8 October 2026).
 */
import { clip, firstName, type PersonRef } from "@/lib/follow-ups";

// ---- Kinds and statuses --------------------------------------------------------------------------------------------

export const ASSISTANT_ITEM_KINDS = ["message", "request", "reply", "report_note"] as const;
export type AssistantItemKind = (typeof ASSISTANT_ITEM_KINDS)[number];
export const isAssistantItemKind = (v: unknown): v is AssistantItemKind => (ASSISTANT_ITEM_KINDS as readonly unknown[]).includes(v);

export const ASSISTANT_ITEM_STATUSES = ["delivered", "seen", "accepted", "declined", "done", "failed", "expired", "cancelled", "withdrawn"] as const;
export type AssistantItemStatus = (typeof ASSISTANT_ITEM_STATUSES)[number];
export const isAssistantItemStatus = (v: unknown): v is AssistantItemStatus => (ASSISTANT_ITEM_STATUSES as readonly unknown[]).includes(v);

export const REQUEST_KINDS = ["add_todo", "set_reminder", "task_status", "task_comment"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const isRequestKind = (v: unknown): v is RequestKind => (REQUEST_KINDS as readonly unknown[]).includes(v);

export const REQUEST_TASK_STATUSES = ["todo", "in_progress", "blocked", "in_review", "completed"] as const;
export type RequestTaskStatus = (typeof REQUEST_TASK_STATUSES)[number];
export const isRequestTaskStatus = (v: unknown): v is RequestTaskStatus => (REQUEST_TASK_STATUSES as readonly unknown[]).includes(v);
export const STATUS_WORDS: Record<RequestTaskStatus, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", in_review: "In review", completed: "Done" };

/**
 * The moves the person who HOLDS a task may make themself (tasks.ts TRANSITIONS, submitTask and completeTask, seen from
 * the holder): a request may ask only for one of these (owner decision, 8 October 2026: "only to a status Ada herself
 * may set on a task she holds"). Reopening finished work or returning it from review is the reviewer's, never asked of
 * the holder.
 */
export const HOLDER_MOVES: Record<RequestTaskStatus, readonly RequestTaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["todo", "blocked", "in_review", "completed"],
  blocked: ["in_progress"],
  in_review: [],
  completed: [],
};

// ---- Limits (owner decision, 8 October 2026: constants in code, enforced in the service) -------------------------------

export const ASSISTANT_ITEM_LIMITS = {
  messagesPerPairPerDay: 5,        // one sender to one recipient
  requestsPerPairPerDay: 3,
  incomingPerRecipientPerDay: 20,  // messages + requests from everyone
  perSenderPerDay: 40,             // messages + requests to everyone
  reportNotesPerPersonPerDay: 3,
  messageMax: 1000, replyMax: 280, reportNoteMax: 500, requestNoteMax: 280, declineReasonMax: 280,
  todoTitleMax: 200, reminderTextMax: 500, commentMax: 1000, reasonMax: 280,
  requestTtlDays: 3,               // a request expires this long after it was sent
  acceptLeaseSeconds: 120, stuckAcceptedMinutes: 5,
  waitingMax: 10, listMax: 50,
} as const;

// ---- Request payloads ------------------------------------------------------------------------------------------------

/**
 * What a request asks, structured. This (never the sender's words) is what the recipient accepts and what their own
 * assistant then does as them. `taskTitle` is for words only: the task is always `taskId`.
 */
export type RequestPayload =
  | { v: 1; kind: "add_todo"; title: string; dueAt: string | null }
  | { v: 1; kind: "set_reminder"; text: string; at: string }
  | { v: 1; kind: "task_status"; taskId: string; taskTitle: string; from: RequestTaskStatus; to: RequestTaskStatus; reason: string | null }
  | { v: 1; kind: "task_comment"; taskId: string; taskTitle: string; text: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An ISO 8601 instant with its offset ("2026-10-09T17:00:00+01:00", "…Z"). */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;
export const isIsoInstant = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A one-line text of 1 to `max` characters, trimmed, with no control characters. */
const line = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v && !CONTROL.test(v);
const keysAre = (o: Record<string, unknown>, keys: string[]) => {
  const have = Object.keys(o);
  return have.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
};

/**
 * A payload read back from the database (or a Confirm token), checked strictly: version 1, a known kind, exactly that
 * kind's keys, the lengths in ASSISTANT_ITEM_LIMITS, ids that are uuids, instants that are ISO with an offset, statuses
 * that exist and differ, and a reason for "blocked" (a payload must be executable as it stands: the plan asks "Say what
 * is blocking it." before one is ever made). Anything else is null, and an Accept of it changes nothing.
 */
export function payloadOrNull(v: unknown): RequestPayload | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return null;
  const L = ASSISTANT_ITEM_LIMITS;
  switch (o.kind) {
    case "add_todo":
      if (!keysAre(o, ["v", "kind", "title", "dueAt"]) || !line(o.title, L.todoTitleMax)) return null;
      if (o.dueAt !== null && !isIsoInstant(o.dueAt)) return null;
      return { v: 1, kind: "add_todo", title: o.title, dueAt: o.dueAt as string | null };
    case "set_reminder":
      if (!keysAre(o, ["v", "kind", "text", "at"]) || !line(o.text, L.reminderTextMax) || !isIsoInstant(o.at)) return null;
      return { v: 1, kind: "set_reminder", text: o.text, at: o.at };
    case "task_status":
      if (!keysAre(o, ["v", "kind", "taskId", "taskTitle", "from", "to", "reason"])) return null;
      if (!isUuid(o.taskId) || !line(o.taskTitle, L.todoTitleMax) || !isRequestTaskStatus(o.from) || !isRequestTaskStatus(o.to) || o.from === o.to) return null;
      if (o.reason !== null && !line(o.reason, L.reasonMax)) return null;
      if (o.to === "blocked" && o.reason === null) return null;
      return { v: 1, kind: "task_status", taskId: o.taskId.toLowerCase(), taskTitle: o.taskTitle, from: o.from, to: o.to, reason: o.reason as string | null };
    case "task_comment":
      if (!keysAre(o, ["v", "kind", "taskId", "taskTitle", "text"])) return null;
      if (!isUuid(o.taskId) || !line(o.taskTitle, L.todoTitleMax) || typeof o.text !== "string" || !o.text.trim() || o.text.length > L.commentMax || o.text.trim() !== o.text || CONTROL_BUT_NEWLINE.test(o.text)) return null;
      return { v: 1, kind: "task_comment", taskId: o.taskId.toLowerCase(), taskTitle: o.taskTitle, text: o.text };
    default:
      return null;
  }
}

// ---- Words for dates -------------------------------------------------------------------------------------------------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zonedParts(d: Date, timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    fmtCache.set(timeZone, f);
  }
  const parts = f.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** "Fri 9 Oct, 17:00" in the organisation's time zone: always with the day, so a request reads the same tomorrow. "" for a time that is not one. */
export function dateTimeLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, timeZone);
  const dow = DOW[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${dow} ${p.day} ${MONTHS[p.month - 1]}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "17:05" in the organisation's time zone. */
export function timeLabel(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

const q = (s: string) => `“${s}”`;
const T_MAX = 80;

/**
 * A request in words: `summary` for one line ("add the to-do “Review pricing”, due Fri 9 Oct, 17:00"; it follows "Ask
 * Ada to accept: " and "Olu's Max asks you to accept: ") and `lines`, one per field, for "What would change" (plain
 * text, other people's words in “ ” as written).
 */
export function requestLines(p: RequestPayload, o: { timeZone: string; now?: number }): { summary: string; lines: string[] } {
  const tz = o.timeZone;
  switch (p.kind) {
    case "add_todo":
      return {
        summary: `add the to-do ${q(clip(p.title, T_MAX))}${p.dueAt ? `, due ${dateTimeLabel(p.dueAt, tz)}` : ""}`,
        lines: [`New to-do: ${q(p.title)}`, p.dueAt ? `Due: ${dateTimeLabel(p.dueAt, tz)}` : "Due: no date"],
      };
    case "set_reminder":
      return {
        summary: `set a reminder for ${dateTimeLabel(p.at, tz)}: ${q(clip(p.text, T_MAX))}`,
        lines: [`Reminder: ${q(p.text)}`, `When: ${dateTimeLabel(p.at, tz)}`],
      };
    case "task_status":
      return {
        summary: `move ${q(clip(p.taskTitle, T_MAX))} to ${STATUS_WORDS[p.to]}`,
        lines: [`Task: ${q(p.taskTitle)}`, `Status: ${STATUS_WORDS[p.from]} to ${STATUS_WORDS[p.to]}`, ...(p.reason ? [`Reason: ${q(p.reason)}`] : [])],
      };
    case "task_comment":
      return {
        // The comment's own words belong in the one line too: an Accept from the compact row, the bell or the sender's
        // status card must never post words the person has not seen (review, 8 October 2026).
        summary: `comment on ${q(clip(p.taskTitle, T_MAX))}: ${q(clip(p.text.replace(/\s+/g, " "), T_MAX))}`,
        lines: [`Task: ${q(p.taskTitle)}`, `Comment: ${q(p.text)}`],
      };
  }
}

/**
 * What was done, after "Ada accepted: " ("to-do added", "reminder set for Fri 9 Oct, 15:00", "“Landing page” is now in
 * review", "comment added to “Landing page”"). `sentForCheck`: a move to Done that went for a check instead (the task
 * has a reviewer: completeTask sends it to In review), so it never says "is now done" (review, 8 October 2026).
 */
export function doneWords(p: RequestPayload, timeZone: string, o: { sentForCheck?: boolean } = {}): string {
  switch (p.kind) {
    case "add_todo": return "to-do added";
    case "set_reminder": return `reminder set for ${dateTimeLabel(p.at, timeZone)}`;
    case "task_status":
      if (p.to === "completed" && o.sentForCheck) return `${q(clip(p.taskTitle, T_MAX))} is sent for a check before it's done`;
      return `${q(clip(p.taskTitle, T_MAX))} is now ${STATUS_WORDS[p.to].toLowerCase()}`;
    case "task_comment": return `comment added to ${q(clip(p.taskTitle, T_MAX))}`;
  }
}

/** What the recipient's accepted request touched, for "{first} can check their …" ("to-dos", "reminders", "task"). */
export const requestPlace = (k: RequestKind) => (k === "add_todo" ? "to-dos" : k === "set_reminder" ? "reminders" : "task");

// ---- Results ---------------------------------------------------------------------------------------------------------

export const RESULT_CODES = ["done", "not_allowed", "task_gone", "bad_transition", "in_past", "no_todos", "invalid", "interrupted", "error"] as const;
export type ResultCode = (typeof RESULT_CODES)[number];
export const isResultCode = (v: unknown): v is ResultCode => (RESULT_CODES as readonly unknown[]).includes(v);

// ---- The view (what the pages, the chat card and the notch read) ------------------------------------------------------

export type AssistantItemView = {
  id: string; kind: AssistantItemKind; status: AssistantItemStatus; createdAt: string; updatedAt: string;
  viewer: "sender" | "recipient" | "reader";
  sender: PersonRef;                      // lib/follow-ups PersonRef (name, firstName, assistant profile)
  recipient: PersonRef | null;            // null: a report note
  body: string | null; tidied: boolean;
  request: { kind: RequestKind; payload: RequestPayload; summary: string; lines: string[]; expiresAt: string } | null;
  reply: { id: string; body: string; createdAt: string; seenAt: string | null } | null;   // a message's reply
  replyTo: { id: string; body: string } | null;                                          // a reply's message (clipped 140)
  seenAt: string | null; decidedAt: string | null; finishedAt: string | null;
  declineReason: string | null;
  /** `sentForCheck`: a move to Done that went for a check (In review) instead. */
  result: { code: ResultCode; words: string; sentForCheck?: boolean } | null;
  report: { date: string; cutoffAt: string; open: boolean } | null;
  origin: { conversationId: string; name: string; href: string } | null;   // only when the viewer reads that conversation
  badge: { label: string; tone: "neutral" | "warning" | "success" | "danger" };
  canSeen: boolean; canReply: boolean; canAccept: boolean; canDecline: boolean; canCancel: boolean; canWithdraw: boolean; canMute: boolean;
  href: string;   // /app/{slug}/home/assistants/items/{id}
};

/** Still waiting for someone: an open request, an unseen message or reply, a note that has not gone into the report. */
export function isOpenItem(v: Pick<AssistantItemView, "kind" | "status">): boolean {
  if (v.kind === "request") return v.status === "delivered" || v.status === "seen" || v.status === "accepted";
  return v.status === "delivered";
}

/**
 * The badge on an item: a word always, and its tone (colour never carries the meaning alone). `reportTime` is the
 * organisation's report time ("18:00") for a note still to go in.
 */
export function itemBadge(v: Pick<AssistantItemView, "kind" | "status" | "viewer" | "reply" | "recipient" | "report">, o: { reportTime?: string } = {}): AssistantItemView["badge"] {
  if (v.kind === "report_note") {
    switch (v.status) {
      case "done": return { label: "In the report", tone: "success" };
      case "withdrawn": return { label: "Withdrawn", tone: "neutral" };
      case "expired": return { label: "Not sent", tone: "neutral" };
      default: return { label: o.reportTime ? `Goes in at ${o.reportTime}` : "Goes in today's report", tone: "neutral" };
    }
  }
  if (v.kind === "request") {
    switch (v.status) {
      case "delivered":
      case "seen":
        return v.viewer === "recipient" ? { label: "Needs your answer", tone: "warning" } : { label: `Waiting for ${v.recipient?.firstName ?? "them"}`, tone: "warning" };
      case "accepted": return { label: "Doing it", tone: "neutral" };
      case "done": return { label: "Done", tone: "success" };
      case "declined": return { label: "Declined", tone: "neutral" };
      case "failed": return { label: "Couldn't be done", tone: "danger" };
      case "expired": return { label: "Expired", tone: "neutral" };
      default: return { label: "Cancelled", tone: "neutral" };
    }
  }
  // A message (with or without its reply) or a reply.
  if (v.kind === "message" && v.reply) return { label: "Replied", tone: "success" };
  if (v.status === "seen") return { label: "Seen", tone: "success" };
  return v.viewer === "recipient" ? { label: "New", tone: "warning" } : { label: "Delivered", tone: "neutral" };
}

// ---- Notifications ---------------------------------------------------------------------------------------------------

export const ASSISTANT_ITEM_NOTIFICATION_TYPES = {
  message: "assistant.message", request: "assistant.request", reply: "assistant.reply", outcome: "assistant.outcome",
  tagged: "assistant.tagged", threadReply: "assistant.thread_reply",
} as const;
export type AssistantItemNotificationType = (typeof ASSISTANT_ITEM_NOTIFICATION_TYPES)[keyof typeof ASSISTANT_ITEM_NOTIFICATION_TYPES];

// ---- Before migration 0043 -------------------------------------------------------------------------------------------

/** Every place that would send through another assistant before migration 0043 is applied says this (copilot, the helper). */
export const ASSISTANT_TALK_NOT_READY = "Talking to other people's assistants needs a database update first. Message the person directly for now.";
/** The routes that change something answer 503 with this before 0043. */
export const ASSISTANT_TALK_NOT_READY_SHORT = "This needs a database update first. Try again later.";

// ---- Words -----------------------------------------------------------------------------------------------------------

/** "Olu's Max": a person's first name and their assistant's name. */
export const assistantOf = (first: string, assistantName: string) => `${first}'s ${assistantName}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Every fixed string the phase 6 surfaces show (contract H, B.2, C.2 to C.5), so the web, the notch preview, the server
 * and the tests agree. Functions take first names ("Olu"), full names ("Olu Adeyemi") and assistant names ("Max") as
 * given; other people's words are passed in already quoted where a sentence quotes them.
 */
export const ASSISTANT_ITEM_WORDS = {
  // What the sender's assistant says when it cannot send (B.2). `first` is the recipient's first name.
  refusals: {
    limitPairMessages: (first: string) => `You've passed on ${ASSISTANT_ITEM_LIMITS.messagesPerPairPerDay} messages to ${first} today. Message ${first} directly, or try again tomorrow.`,
    limitPairRequests: (first: string) => `You've sent ${first} ${ASSISTANT_ITEM_LIMITS.requestsPerPairPerDay} requests today. Message ${first} directly, or try again tomorrow.`,
    limitRecipient: (first: string) => `${first} has had a lot from other people's assistants today. Message ${first} directly instead.`,
    limitSender: () => `You've sent ${ASSISTANT_ITEM_LIMITS.perSenderPerDay} messages and requests through other people's assistants today. Try again tomorrow.`,
    limitNotes: () => `You've added ${ASSISTANT_ITEM_LIMITS.reportNotesPerPersonPerDay} notes to today's team report. Tell your team lead directly.`,
    muted: (first: string) => `${first} isn't taking messages from your assistant right now.`,
    self: () => "That's you. Ask me to do it directly.",
    notMember: (name: string) => `${name} isn't an active member of this workspace.`,
    notesOff: () => "Notes for the team report are switched off in this workspace.",
    reportOff: () => "The end-of-day team report is off in this workspace, so there's nothing to add a note to.",
    tooLate: () => "Today's team report has already been written. Tell your team lead directly.",
    noReportToday: () => "There's no team report today: it isn't a working day here. Tell your team lead directly.",
    noReader: () => "Nobody receives a team report that covers your work, so the note wouldn't be read. Tell the person directly.",
    noTodos: (first: string) => `${first} has no to-do list (owners and HR don't hold tasks).`,
    taskNotFound: () => "That task isn't one you can see, or it was removed.",
    notTheirs: (first: string) => `${first} doesn't hold that task, so ${first} can't move it.`,
    notVisible: (first: string) => `${first} can't see that task, so ${first} can't comment on it.`,
    badTransition: (first: string, title: string, fromWord: string, toWord: string) => `${first} can't move “${clip(title, T_MAX)}” from ${fromWord} to ${toWord}.`,
    blockedWithoutReason: () => "Say what is blocking it.",
    inPast: () => "That time has already passed. Pick a time later than now.",
    tooFar: () => "Reminders can be set up to a year ahead.",
    badTime: (words: string) => `I can't read “${clip(words, 60)}” as a date and time. Say it as a day and a time, such as Friday at 17:00.`,
    noPerson: (words: string) => `I can't find anyone called “${clip(words, 60)}” in this workspace.`,
    severalPeople: (words: string, names: string[]) => `More than one person fits “${clip(words, 60)}”: ${names.slice(0, 5).join(", ")}. Use the full name.`,
    sayWho: () => "Say whose assistant to send it to.",
    noTask: (words: string, first: string) => `I can't find a task like “${clip(words, 60)}” that ${first} can see. Name it as it's written.`,
    severalTasks: (words: string, titles: string[]) => `“${clip(words, 60)}” fits more than one task: ${titles.slice(0, 5).map((t) => `“${clip(t, 60)}”`).join(", ")}. Which one?`,
    sayTask: () => "Say which task.",
    emptyMessage: () => "Say what to pass on.",
    longMessage: () => `Keep the message to ${ASSISTANT_ITEM_LIMITS.messageMax.toLocaleString("en-GB")} characters.`,
    emptyNote: () => "Say what the note should say.",
    longNote: () => `Keep the note to ${ASSISTANT_ITEM_LIMITS.reportNoteMax} characters.`,
    longRequestNote: () => `Keep the note to ${ASSISTANT_ITEM_LIMITS.requestNoteMax} characters.`,
    emptyTodo: () => "Say what the to-do is.",
    longTodo: () => `Keep the to-do to ${ASSISTANT_ITEM_LIMITS.todoTitleMax} characters.`,
    emptyReminder: () => "Say what to remind them of.",
    longReminder: () => `Keep the reminder to ${ASSISTANT_ITEM_LIMITS.reminderTextMax} characters.`,
    sayWhen: () => "Say when to remind them.",
    emptyComment: () => "Say what the comment should say.",
    longComment: () => `Keep the comment to ${ASSISTANT_ITEM_LIMITS.commentMax.toLocaleString("en-GB")} characters.`,
    longReason: () => `Keep the reason to ${ASSISTANT_ITEM_LIMITS.reasonMax} characters.`,
    sayStatus: () => "Say which status: To do, In progress, Blocked, In review or Done.",
    badKind: () => "I can ask someone to accept a to-do, a reminder, a task move or a comment, nothing else.",
  },

  // The recipient's and the sender's own steps (C.2, C.3).
  steps: {
    notHere: "That isn't here any more.",
    closed: "This was already answered.",
    expired: "This request has expired.",
    alreadyReplied: "You've already replied to this.",
    tooLate: "Today's report has already been written, so the note stays in it.",
    reasonTooLong: `Keep the reason to ${ASSISTANT_ITEM_LIMITS.declineReasonMax} characters.`,
    replyEmpty: "Write a reply first.",
    replyTooLong: `Keep the reply to ${ASSISTANT_ITEM_LIMITS.replyMax} characters.`,
    impersonatedAccept: (first: string) => `Only ${first} can accept this. It stays as it is while someone else is signed in as them.`,
    impersonatedDecline: (first: string) => `Only ${first} can decline this. It stays as it is while someone else is signed in as them.`,
    impersonatedReply: (first: string) => `Only ${first} can reply. It stays as it is while someone else is signed in as them.`,
    impersonatedSeen: (first: string) => `Only ${first} can mark this as seen. It stays as it is while someone else is signed in as them.`,
    impersonatedMute: (first: string) => `Only ${first} can change whose assistants reach them. It stays as it is while someone else is signed in as them.`,
    impersonatedPreferences: (first: string) => `Only ${first} can change this. It stays as it is while someone else is signed in as them.`,
    muteSelf: "That's you.",
    muteNotMember: "That person isn't in this workspace.",
    settingsForbidden: "Only the organisation owner or HR can change this.",
  },

  // What happened to an accepted request (C.2): the result's words.
  results: {
    invalid: "This request could not be read, so nothing was changed.",
    error: "Something went wrong, so nothing was changed.",
    interrupted: (first: string, kind: RequestKind) => `${first} accepted, but Boredroom couldn't confirm it finished. ${first} can check their ${requestPlace(kind)}.`,
    noLongerHolds: (first: string, title: string) => `${first} no longer holds “${clip(title, T_MAX)}”, so nothing was changed.`,
    taskGone: "That task was removed or is no longer one they can see.",
    movedSince: (title: string, nowWord: string, toWord: string) => `“${clip(title, T_MAX)}” is ${nowWord} now, so it can't move to ${toWord}.`,
    noTodos: (first: string) => `${first} has no to-do list (owners and HR don't hold tasks).`,
    inReviewNote: (senderFirst: string) => `Sent for review at ${senderFirst}'s request.`,
  },

  // Notifications (C.5).
  notifications: {
    messageTitle: (senderFirst: string, senderAssistant: string) => `${assistantOf(senderFirst, senderAssistant)} passed on a message`,
    messageBody: (body: string) => `“${clip(body.replace(/\s+/g, " ").trim(), 120)}”`,
    requestTitle: (senderFirst: string, senderAssistant: string, summary: string) => clip(`${assistantOf(senderFirst, senderAssistant)} asks you to accept: ${summary}`, 140),
    requestBody: (expires: string) => `Nothing changes until you accept. It expires ${expires}.`,
    replyTitle: (first: string) => `${first} replied to your message`,
    replyBody: (body: string) => `“${clip(body, 120)}”`,
    outcomeDoneTitle: (first: string, done: string) => `${first} accepted: ${done}`,
    outcomeFailedTitle: (first: string) => `${first} accepted, but it couldn't be done`,
    outcomeDeclinedTitle: (first: string) => `${first} declined your request`,
    outcomeExpiredTitle: (first: string) => `No answer from ${first}`,
    declinedBody: (reason: string | null) => (reason ? `“${clip(reason, 280)}”` : "No reason given."),
    expiredBody: (summary: string) => `Your request to ${summary} expired.`,
    requestCancelled: (senderFirst: string) => `${senderFirst} cancelled this request.`,
    requestExpired: "This request expired.",
    requestAnswered: "You answered this request.",
  },

  // Activity rows ("What Max did"): `summary` is what owners and HR may read, `personal` the person's own words.
  activity: {
    passedSummary: "Passed a message to a colleague's assistant",
    requestSummary: "Sent a request to a colleague's assistant",
    noteSummary: "Added a note to the team report",
    didRequestSummary: "Did a colleague's request after you accepted",
    failedRequestSummary: "Couldn't do a colleague's request after you accepted",
    answeredSummary: "A colleague answered your request",
    replySummary: "Passed your reply on",
  },

  // The pages (H.1).
  page: {
    title: "Between assistants",
    description: "What your assistant and other people's assistants passed on, asked and answered.",
    backTo: (name: string) => `Back to ${name}`,
    tabs: { waiting: "Waiting for you", sent: "Sent", received: "Received" },
    sentTypes: { items: "Messages and requests", followUps: "Follow-ups" },
    receivedTypes: { items: "Messages and requests", followUps: "Follow-ups about you" },
    kindFilters: { all: "All", message: "Messages", request: "Requests", report_note: "Report notes" },
    statusFilters: { open: "Open", done: "Done", all: "All" },
    emptyWaiting: { title: "Nothing waiting for you", body: "When someone's assistant brings you a message or a request, it shows here." },
    emptySent: {
      title: "Nothing sent yet",
      body: (name: string) => `Ask ${name} “Tell Ben's assistant the client moved the deadline to Friday.”`,
      action: (name: string) => `Ask ${name}`,
      prompt: "Tell Ben's assistant the client moved the deadline to Friday.",
    },
    emptyReceived: { title: "Nothing received yet", body: "Messages, requests and follow-ups from other people's assistants show here." },
    notes: {
      privacy: "Only you and the other person see what passed between your assistants. The owner and HR see that it happened, not what was said.",
      requests: "Nothing in a request changes your account until you accept it.",
      reportNotes: "Notes for the team report go to the people who receive it: your team lead, the owner and HR.",
    },
    notReady: "This needs a database update first.",
    showMore: "Show more",
    seeAll: (n: number) => `See all ${n}`,
  },

  // The card (H.1). `who` is "Olu's Max"; bold it where the design says so.
  card: {
    receivedMessage: (senderFirst: string) => `passed on a message from ${senderFirst}`,
    receivedRequest: "asks you to accept a change",
    receivedReply: (first: string) => `${first} replied to your message`,
    asSent: (senderFirst: string) => `${senderFirst}'s words, as sent.`,
    reworded: (senderAssistant: string, senderFirst: string) => `${senderAssistant} reworded it at ${senderFirst}'s request.`,
    askedIn: (name: string) => `Asked in ${name}`,
    markSeen: "Mark as seen",
    reply: "Reply",
    replyPlaceholder: "Reply in one line",
    sendReply: "Send reply",
    replySent: (yourAssistant: string, senderFirst: string) => `Sent. ${yourAssistant} passes it to ${senderFirst}.`,
    mute: (senderFirst: string) => `Stop items from ${senderFirst}'s assistant`,
    muteTitle: (senderFirst: string) => `Stop items from ${senderFirst}'s assistant?`,
    muteBody: (senderFirst: string, senderAssistant: string) => `New messages and requests from ${assistantOf(senderFirst, senderAssistant)} won't reach you. ${senderFirst} is told you're not taking them. You can undo this in Settings.`,
    whatWouldChange: "What would change",
    senderNote: (senderFirst: string) => `${senderFirst}'s note`,
    nothingChanges: (yourAssistant: string) => `Nothing changes until you accept. If you do, ${yourAssistant} does it for you, as you.`,
    expires: (when: string) => `Expires ${when}.`,
    decline: "Decline",
    declinePlaceholder: "Say why, if you like",
    accept: "Accept",
    accepted: (done: string) => `Accepted. ${done.charAt(0).toUpperCase()}${done.slice(1)}.`,
    declined: "Declined.",
    couldNotBeDone: (words: string) => `Couldn't be done: ${words}`,
    expiredLine: "Expired.",
    cancelledBy: (senderFirst: string) => `${senderFirst} cancelled this request.`,
    to: (who: string) => `To ${who}`,
    toRequest: (who: string) => `To ${who}: accept a change`,
    hasSeen: (first: string, at: string) => `${first} has seen it, ${at}.`,
    replied: (first: string, body: string) => `${first} replied: “${body}”`,
    cancelRequest: "Cancel request",
    cancelConfirm: "Cancel this request?",
    reportNoteTitle: "Note for today's team report",
    fromYouVia: (yourAssistant: string, body: string) => `From you via ${yourAssistant}: “${body}”`,
    reportReadAt: (time: string) => `The people who receive the report read it at ${time}, or sooner if they ask for the report early.`,
    withdrawNote: "Withdraw note",
    withdrawConfirm: "Withdraw your note from today's team report?",
  },

  // The live status card in her chat (H.2).
  status: {
    messageTitle: (who: string) => `Message to ${who}`,
    requestTitle: (who: string) => `Request to ${who}`,
    noteTitle: "Note for today's team report",
    delivered: "Delivered.",
    seen: (first: string, at: string) => `${first} has seen it, ${at}.`,
    replied: (first: string, body: string) => `${first} replied: “${body}”`,
    waiting: (first: string) => `Waiting for ${first}.`,
    doing: (first: string) => `${first} accepted. Doing it now.`,
    done: (first: string, done: string) => `${first} accepted: ${done}.`,
    declined: (first: string, reason: string | null) => (reason ? `${first} declined: “${reason}”` : `${first} declined.`),
    failed: (words: string) => `Couldn't be done: ${words}`,
    expired: (first: string) => `Expired: no answer from ${first}.`,
    cancelled: "You cancelled this request.",
    noteOpen: (time: string) => `Goes in today's report at ${time}.`,
    noteDone: "In the report.",
    noteWithdrawn: "You withdrew this note.",
    noteNotSent: "Not sent: no team report went out with it.",
    couldNotRefresh: "Couldn't refresh",
    retry: "Retry",
    showAll: "Show all",
  },

  // Settings (H.5).
  settings: {
    talkCard: "Other people's assistants",
    allowTags: (name: string) => `Let people tag ${name} in Messages`,
    allowTagsHint: (name: string) => `People in a conversation with you can ask ${name} about your work there. It answers from your work, or asks you, as for follow-ups. Anything not everyone there can see goes only to the person who asked.`,
    mutedTitle: "Muted assistants",
    mutedNone: "You haven't muted anyone's assistant.",
    unmute: "Unmute",
    notesCard: "Notes from the team",
    notesSwitch: "Let people add notes to the team report",
    notesHint: `Someone tells their assistant “Put this in today's team report”, and the note goes in the end-of-day report, from them. At most ${ASSISTANT_ITEM_LIMITS.reportNotesPerPersonPerDay} a day each; they can withdraw a note until the report is written.`,
    notesBadge: { on: "On", off: "Off", needsReport: "Needs the daily report" },
    notesPageNote: "Notes are read only by the people who receive the report.",
    notReady: "This needs a database update first.",
  },

  // The notch (H.7).
  notch: {
    messageTitle: (senderFirst: string, senderAssistant: string) => `${assistantOf(senderFirst, senderAssistant)} passed on a message`,
    requestTitle: (senderFirst: string, senderAssistant: string) => `${assistantOf(senderFirst, senderAssistant)} asks you to accept a change`,
    replyTitle: (first: string) => `${first} replied to your message`,
    seen: "Seen",
    send: "Send",
    open: "Open",
    done: "Done",
    nothingChanges: "Nothing changes until you accept.",
    doneLine: (done: string) => `Done: ${done}.`,
  },

  /** "2 requests and 1 message are waiting for you." */
  waitingCount: (requests: number, others: number) => {
    const parts = [requests ? plural(requests, "request") : "", others ? plural(others, "message") : ""].filter(Boolean);
    return parts.length ? `${parts.join(" and ")} ${requests + others === 1 ? "is" : "are"} waiting for you.` : "Nothing is waiting for you.";
  },
} as const;

/** The other person in an item, from the viewer's side: the recipient for the sender, the sender for anyone else. */
export function otherOf(v: Pick<AssistantItemView, "viewer" | "sender" | "recipient">): PersonRef | null {
  return v.viewer === "sender" ? v.recipient : v.sender;
}

/** "Ben" from "Ben Okafor" (re-exported for callers that only import this file). */
export { firstName };
