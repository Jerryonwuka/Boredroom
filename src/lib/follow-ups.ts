/**
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4). "Instead of following
 * up with the people, the assistants follow up with each other's assistants to know what the staff are working on." A
 * person asks their own assistant ("Where is Ben on the landing page?"); Ben's assistant answers from Ben's recent work,
 * and asks Ben once only when his work does not answer it.
 *
 * This file is what the server, the pages, the chat card and the notch share: the statuses, the limits, the shape of
 * the facts an assistant shares (exactly what was shared, kept on the row), the views each page reads, and the fixed
 * words (refusals, failures, the lines that list what was shared, the badges). It imports nothing from the server, so
 * client components can use it.
 *
 * Other people's words (comments, reasons, replies, task titles) appear here as plain text inside “ ” quotes, as
 * written; nothing here turns them into Markdown or links (review, 8 October 2026).
 */
import type { AssistantProfile } from "@/lib/assistant-look";

// ---- Statuses and choices ---------------------------------------------------------------------------------------------

export const FOLLOW_UP_STATUSES = ["pending", "asking", "answering", "answered", "expired", "declined", "cancelled", "failed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
/** Still moving: Boredroom is gathering, the person is being asked, or the answer is being written. */
export const OPEN_STATUSES: readonly FollowUpStatus[] = ["pending", "asking", "answering"];
/** Closed with an answer the requester may read (and the facts that were shared with it). */
export const SHARED_STATUSES: readonly FollowUpStatus[] = ["answered", "expired", "declined"];
export const isOpenStatus = (s: FollowUpStatus) => OPEN_STATUSES.includes(s);

export const REPLY_CHOICES = ["on_track", "blocked", "done", "not_started", "not_now"] as const;
export type ReplyChoice = (typeof REPLY_CHOICES)[number];
export const REPLY_LABELS: Record<ReplyChoice, string> = { on_track: "On track", blocked: "Blocked", done: "Done", not_started: "Not started", not_now: "Not now" };
export const isReplyChoice = (v: unknown): v is ReplyChoice => (REPLY_CHOICES as readonly unknown[]).includes(v);

/** "Answer from my work, ask me only if it can't" (the default) or "Always ask me first". */
export const FOLLOW_UP_PREFERENCES = ["auto", "ask_first"] as const;
export type FollowUpPreference = (typeof FOLLOW_UP_PREFERENCES)[number];
export const isFollowUpPreference = (v: unknown): v is FollowUpPreference => (FOLLOW_UP_PREFERENCES as readonly unknown[]).includes(v);

/** Every place that would start or list follow-ups before migration 0039 is applied says this (copilot, the helper). */
export const FOLLOW_UPS_NOT_READY = "Follow-ups aren't switched on in this workspace yet: it needs a database update. Ask the person directly for now.";
/** The routes that change something answer 503 with this before 0039. */
export const FOLLOW_UPS_NOT_READY_SHORT = "Follow-ups need a database update first. Try again later.";
/** How a plan's "no task fits these words" refusal starts (the built-in helper then offers to-dos instead, when it reads any). */
export const NO_TASK_LIKE = "I can't find a task like";

// ---- Limits (owner decision, 8 October 2026: constants in code, enforced in the service) -------------------------------

export const FOLLOW_UP_LIMITS = {
  /** People in one ask (a team fan-out included). */
  batchMax: 25,
  /** Follow-ups a person creates per local day. */
  perRequesterPerDay: 30,
  /** Same requester, same subject, same task (or both "what are they working on") per local day. */
  perPairTaskPerDay: 2,
  /** Times anyone's follow-up asks one person per local day; past it, the answer comes from their work only. */
  asksPerSubjectPerDay: 4,
  /**
   * Times one person's follow-ups ask the same person per local day (cancelled ones count); past it, that person's
   * answers come from the other's work only, and the rest of the day's asks stay for everyone else (security review,
   * 8 October 2026: one colleague could spend all four).
   */
  asksPerPairPerDay: 1,
  /** How long the person asked has to reply: 4 working hours. */
  replyWorkingSeconds: 4 * 3600,
  /** The workspace's own collection: the person can reply until this long before the report. */
  workspaceAskLeadSeconds: 5 * 60,
  questionMax: 280,
  noteMax: 280,
  /** People in one workspace collection. */
  workspaceMax: 500,
} as const;

// ---- What an assistant shares ----------------------------------------------------------------------------------------

export type FollowUpUpdateKind = "status" | "comment" | "time" | "submission" | "timer";
export type TaskStatusWord = "todo" | "in_progress" | "blocked" | "in_review" | "completed";
type OpenStatusWord = Exclude<TaskStatusWord, "completed">;

/**
 * Exactly what the subject's assistant shared, gathered under the asker's own permissions (row-level security as the
 * asker, never broader) and kept on the follow-up as it was at answer time. Never in here: the person's own to-dos
 * (a task they made for themself), their day plan, documents, messages, chats with their assistant, attendance or
 * recordings.
 */
export type FollowUpFacts = {
  v: 1;
  kind: "task" | "person";
  /** ISO. */
  gatheredAt: string;
  /** The start of the freshness window used (ISO). */
  freshSince: string;
  fresh: boolean;
  /** The asker may see the person's time and timer (app_can_view_records as the asker). */
  timeVisible: boolean;
  task?: {
    id: string; title: string; project: string;
    status: TaskStatusWord;
    /** 100 when completed. */
    progressPercent: number;
    dueAt: string | null; overdue: boolean;
    /** At most 280 characters. */
    blockedReason: string | null;
    completedAt: string | null;
  };
  /** Newest first, at most 5. `by` is a display name; byThem: the subject did it. Reason ≤ 280. */
  history?: { from: string | null; to: string; at: string; by: string | null; byThem: boolean; reason: string | null }[];
  /** Newest first, at most 3; body ≤ 280 (clipped with "…"). */
  comments?: { by: string; byThem: boolean; at: string; body: string }[];
  /** The subject's latest submission on the task (note ≤ 280). */
  submission?: { at: string; note: string | null } | null;
  /** Seconds, only when timeVisible; null otherwise. Task kind: on this task; person kind: on everything. */
  time?: { todaySeconds: number; weekSeconds: number } | null;
  /** Only when timeVisible. ownTodo: the timer runs on one of their own to-dos (its title is never given). */
  timer?: { state: "running" | "paused" | "interrupted"; since: string; taskId: string | null; taskTitle: string | null; ownTodo: boolean } | null;
  /** Person kind: open shared work assigned to them, visible to the asker, at most 8. */
  openTasks?: { id: string; title: string; status: OpenStatusWord; progressPercent: number; dueAt: string | null; overdue: boolean; blockedReason: string | null }[];
  /** How many more open ones beyond the 8. */
  openMore?: number;
  /** Person kind: shared work they finished today, at most 5. */
  completedToday?: { id: string; title: string }[];
  /** The newest signal by the subject that the asker can see; null when there is none in the last 30 days. */
  lastUpdate: { kind: FollowUpUpdateKind; at: string; text: string | null; taskTitle: string | null } | null;
};

/** A facts object read back from the database: anything that is not one (the empty '{}' of a new row) is null. */
export function factsOrNull(v: unknown): FollowUpFacts | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Partial<FollowUpFacts>;
  return f.v === 1 && (f.kind === "task" || f.kind === "person") ? (f as FollowUpFacts) : null;
}

// ---- Refusals and failures -------------------------------------------------------------------------------------------

export type RefusalCode = "self" | "not_member" | "task_not_found" | "task_not_theirs" | "own_todo" | "not_allowed";
export const REFUSAL_CODES: readonly RefusalCode[] = ["self", "not_member", "task_not_found", "task_not_theirs", "own_todo", "not_allowed"];
export const isRefusalCode = (v: unknown): v is RefusalCode => (REFUSAL_CODES as readonly unknown[]).includes(v);

/** Who may ask about whom, in words (owner decision, 8 October 2026). `name` is the person's full name, `first` their first. */
export const REFUSAL_WORDS: Record<RefusalCode, (name: string, first: string) => string> = {
  self: () => "You can't follow up on yourself. Ask me what's on your list instead.",
  not_member: (name) => `${name} isn't an active member of this workspace.`,
  task_not_found: () => "That task isn't one you can see, or it was removed.",
  task_not_theirs: (_name, first) => `${first} doesn't hold or check that task. Ask about the person who holds it.`,
  own_todo: (_name, first) => `That's one of ${first}'s own to-dos. Assistants never share those; message ${first} if you need to know.`,
  not_allowed: (_name, first) => `You can follow up only on people in teams you lead, people you share a task with, or anyone if you're the owner or HR. ${first} isn't one of them.`,
};
export function refusalWords(code: RefusalCode, name: string, first: string): string {
  return (REFUSAL_WORDS[code] ?? REFUSAL_WORDS.not_allowed)(name, first);
}

/** Why one person in a group was left out, short enough to sit in brackets after their name. */
export const SKIP_REASONS: Record<RefusalCode | "pair_cap", string> = {
  self: "that's you",
  not_member: "not an active member",
  task_not_found: "you can't see that task",
  task_not_theirs: "doesn't hold or check that task",
  own_todo: "it's their own to-do",
  not_allowed: "you can't follow up on them",
  pair_cap: "asked twice today already",
};

export type FollowUpFailure = "subject_left" | "not_allowed" | "task_gone" | "error";
export function failureWords(failure: FollowUpFailure, first: string): string {
  switch (failure) {
    case "subject_left": return `${first} is no longer in this workspace.`;
    case "not_allowed": return `You can no longer follow up on ${first}.`;
    case "task_gone": return "That task was removed or is no longer one you can see.";
    default: return "Something went wrong; ask again.";
  }
}

// ---- Words -----------------------------------------------------------------------------------------------------------

/** "Ben" from "Ben Okafor". */
export const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] || displayName;

/** At most `max` characters, ending "…" when cut, never splitting an emoji (a surrogate pair). */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  let cut = max - 1;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${s.slice(0, cut).trimEnd()}…`;
}

const STATUS_WORDS: Record<TaskStatusWord, string> = { todo: "not started", in_progress: "in progress", blocked: "blocked", in_review: "waiting for a check", completed: "done" };
export function statusWords(s: TaskStatusWord): string {
  return STATUS_WORDS[s] ?? String(s).replace(/_/g, " ");
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zoned(d: Date, timeZone: string) {
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
  const year = get("year"), month = get("month"), day = get("day");
  return { year, month, day, hour: get("hour") % 24, minute: get("minute"), date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}
const hm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
const dayName = (p: { year: number; month: number; day: number }) => `${DOW[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]} ${p.day} ${MONTHS[p.month - 1]}`;
const nextDate = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };

/** "15:40" today (in the organisation's time zone), "Wed 7 Oct 16:02" on any other day. "" for a time that is not one. */
export function whenLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zoned(d, timeZone);
  return p.date === zoned(now, timeZone).date ? hm(p) : `${dayName(p)} ${hm(p)}`;
}

/** A reply deadline: "15:30" today, "12:00 tomorrow", "Mon 12 Oct 12:00" further away. */
export function deadlineLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zoned(d, timeZone);
  const today = zoned(now, timeZone).date;
  if (p.date === today) return hm(p);
  if (p.date === nextDate(today)) return `${hm(p)} tomorrow`;
  return `${dayName(p)} ${hm(p)}`;
}

/** "1 h 20 min", "2 h", "45 min", "under a minute", "no time". */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s === 0) return "no time";
  if (s < 60) return "under a minute";
  const minutes = Math.floor(s / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const q = (s: string) => `“${s}”`;

/**
 * What the subject's assistant shared, one fact per plain-text line (no Markdown), for the exchange's "What Ben's
 * Brenda shared", the reply card's "What your assistant will share", the notch and the model's <follow_up_facts>.
 * `first` is the subject's first name; `forSubject` writes it for the subject ("you"); `asker` names the person asking
 * where the subject is told what that person cannot see.
 */
export function factLines(facts: FollowUpFacts, o: { timeZone: string; now?: Date; first: string; forSubject?: boolean; asker?: string | null }): string[] {
  const now = o.now ?? new Date();
  const when = (iso: string) => whenLabel(iso, o.timeZone, now);
  const you = !!o.forSubject;
  const them = you ? "you" : o.first;
  const Them = you ? "You" : o.first;
  const actor = (by: string | null, byThem: boolean) => (byThem ? Them : by ? firstName(by) : null);
  const lines: string[] = [];
  const isTask = facts.kind === "task";

  // The task as it stands.
  const t = facts.task;
  if (isTask && t) {
    let s = `${q(t.title)} is ${statusWords(t.status)}`;
    if ((t.status === "in_progress" || t.status === "blocked") && t.progressPercent > 0) s += `, ${t.progressPercent}% done`;
    if (t.status === "completed") { if (t.completedAt) s += `, finished ${when(t.completedAt)}`; }
    else if (t.overdue && t.dueAt) s += `, overdue since ${when(t.dueAt)}`;
    else if (t.dueAt) s += `, due ${when(t.dueAt)}`;
    if (t.status === "blocked" && t.blockedReason) s += `: ${t.blockedReason}`;
    lines.push(s);
  }

  // The newest thing they did that the asker can see.
  const lu = facts.lastUpdate;
  if (lu) {
    const on = !isTask && lu.taskTitle ? ` on ${q(lu.taskTitle)}` : "";
    let what: string;
    switch (lu.kind) {
      case "comment": what = `a comment${on}, ${when(lu.at)}${lu.text ? `: ${q(lu.text)}` : ""}`; break;
      case "status": what = `${isTask ? "marked it" : lu.taskTitle ? `marked ${q(lu.taskTitle)}` : "marked a task"} ${statusWords((lu.text ?? "") as TaskStatusWord)}, ${when(lu.at)}`; break;
      case "submission": what = `${isTask ? "sent it" : lu.taskTitle ? `sent ${q(lu.taskTitle)}` : "sent work"} for a check, ${when(lu.at)}${lu.text ? `: ${q(lu.text)}` : ""}`; break;
      case "time": what = `time logged, ${when(lu.at)}`; break;
      default: what = "the timer, running now";
    }
    lines.push(`Latest from ${them}: ${what}`);
  } else {
    lines.push(isTask ? "Nothing recorded on this lately" : "Nothing recorded lately");
  }

  // Time and the timer: only for those who may see the person's records.
  if (!facts.timeVisible) {
    lines.push(you ? `Time: not shared, ${o.asker ? firstName(o.asker) : "they"} can't see your timesheets` : "Time: not shared with you");
  } else if (facts.time) {
    lines.push(`${isTask ? "Time on it" : "Time logged"}: ${durationLabel(facts.time.todaySeconds)} today, ${durationLabel(facts.time.weekSeconds)} this week`);
  }
  const tm = facts.timer;
  if (facts.timeVisible && tm) {
    if (tm.ownTodo) lines.push(`Timer ${tm.state} on a to-do of ${you ? "your" : "their"} own`);
    else if (tm.state === "running") lines.push(tm.taskTitle ? `Working now on ${q(tm.taskTitle)} since ${when(tm.since)}` : `Working now, since ${when(tm.since)}`);
    else lines.push(`Timer ${tm.state}${tm.taskTitle ? ` on ${q(tm.taskTitle)}` : ""}, started ${when(tm.since)}`);
  }

  // "What are they working on": their open shared work and what they finished today.
  if (!isTask) {
    const open = facts.openTasks ?? [];
    const done = facts.completedToday ?? [];
    if (open.length) {
      const items = open.map((x) => {
        const bits: string[] = [statusWords(x.status)];
        if ((x.status === "in_progress" || x.status === "blocked") && x.progressPercent > 0) bits.push(`${x.progressPercent}%`);
        if (x.overdue) bits.push("overdue");
        return `${q(x.title)} (${bits.join(", ")})`;
      });
      lines.push(`Open: ${items.join(", ")}${facts.openMore ? ` and ${facts.openMore} more` : ""}`);
    }
    if (done.length) lines.push(`Finished today: ${done.map((x) => q(x.title)).join(", ")}`);
    if (!open.length && !done.length) lines.push(you ? "No open shared work" : "No open shared work you can see");
  }

  // The task's own record: comments, status changes, the latest submission. What the "Latest from" line already said is
  // not said twice (visual review, 8 October 2026: the same comment was listed twice).
  const same = (kind: FollowUpUpdateKind, at: string) => !!lu && lu.kind === kind && Date.parse(lu.at) === Date.parse(at);
  for (const c of facts.comments ?? []) {
    if (c.byThem && same("comment", c.at)) continue;
    lines.push(`${actor(c.by, c.byThem) ?? "Someone"} commented, ${when(c.at)}: ${q(c.body)}`);
  }
  for (const h of facts.history ?? []) {
    if (h.byThem && same("status", h.at) && lu?.text === h.to) continue;
    const who = actor(h.by, h.byThem);
    // The first entry (no "from") is the task being made, not a move to "not started".
    if (!h.from) { lines.push(`${who ? `${who} created it` : "Created"}, ${when(h.at)}`); continue; }
    const move = `from ${statusWords(h.from as TaskStatusWord)} to ${statusWords(h.to as TaskStatusWord)}`;
    lines.push(`${who ? `${who} moved it ${move}` : `Moved ${move}`}, ${when(h.at)}${h.reason ? `: ${q(h.reason)}` : ""}`);
  }
  if (facts.submission && !same("submission", facts.submission.at)) lines.push(`${Them} sent it for a check, ${when(facts.submission.at)}${facts.submission.note ? `: ${q(facts.submission.note)}` : ""}`);
  return lines;
}

// ---- Views (what the pages, the chat card and the notch read) ---------------------------------------------------------

export type PersonRef = { membershipId: string; name: string; firstName: string; assistant: AssistantProfile };

export type FollowUpView = {
  id: string; batchId: string; status: FollowUpStatus; answeredFrom: "facts" | "person" | "deadline" | null;
  question: string;
  task: { id: string; title: string; href: string } | null;
  /** null: the workspace's own collection, signed by `workspaceAssistant`. */
  requester: PersonRef | null;
  workspaceAssistant: AssistantProfile | null;
  subject: PersonRef;
  /** What was shared. The subject always sees it; the requester and readers only once answered/expired/declined. */
  facts: FollowUpFacts | null;
  /** The subject's reply. The subject always sees it; the requester and readers only once answered/declined. */
  reply: { choice: ReplyChoice; note: string | null; at: string } | null;
  answer: string | null; answerEngine: "claude" | "template" | null; capped: boolean;
  askedAt: string | null; deadlineAt: string | null; repliedAt: string | null; answeredAt: string | null; createdAt: string;
  failure: FollowUpFailure | null;
  viewer: "requester" | "subject" | "reader";
  /** The viewer is the subject and their assistant is asking them. */
  canReply: boolean;
  /** The viewer is the requester and it is still pending or asking. */
  canCancel: boolean;
  /** /app/<slug>/home/follow-ups/<id> */
  href: string;
};

export type FollowUpBatchView = {
  id: string; kind: "person" | "group" | "workspace"; question: string;
  task: { id: string; title: string; href: string } | null; team: { id: string; name: string } | null;
  createdAt: string; completedAt: string | null; summary: string | null;
  /**
   * answered: answered from the person's work; replied: answered with the person's reply; noReply: expired;
   * open: pending, asking or answering.
   */
  counts: { total: number; open: number; answered: number; replied: number; noReply: number; declined: number; cancelled: number; failed: number };
  items: FollowUpView[];
  /** /app/<slug>/home/follow-ups?batch=<id> */
  href: string;
};

/** The badge on a follow-up, by status: its words and tone. */
export function badgeOf(v: Pick<FollowUpView, "status" | "subject">): { label: string; tone: "neutral" | "success" | "warning" | "danger" } {
  switch (v.status) {
    case "pending": return { label: "Starting", tone: "neutral" };
    case "asking": return { label: `Waiting for ${v.subject.firstName}`, tone: "warning" };
    case "answering": return { label: "Writing the answer", tone: "neutral" };
    case "answered": return { label: "Answered", tone: "success" };
    case "expired": return { label: "No reply", tone: "neutral" };
    case "declined": return { label: "Not now", tone: "neutral" };
    case "cancelled": return { label: "Cancelled", tone: "neutral" };
    default: return { label: "Couldn't follow up", tone: "danger" };
  }
}

/** A group's counts in one sentence (at most 300 characters): "6 people: 3 answered from their work, 2 replied, 1 didn't reply in time." */
export function batchSummary(c: FollowUpBatchView["counts"]): string {
  const parts: string[] = [];
  if (c.answered) parts.push(`${c.answered} answered from their work`);
  if (c.replied) parts.push(`${c.replied} replied`);
  if (c.noReply) parts.push(`${c.noReply} didn't reply in time`);
  if (c.declined) parts.push(`${c.declined} said not now`);
  if (c.failed) parts.push(`${c.failed} couldn't be asked`);
  if (c.cancelled) parts.push(`${c.cancelled} cancelled`);
  const who = `${c.total} ${c.total === 1 ? "person" : "people"}`;
  return clip(parts.length ? `${who}: ${parts.join(", ")}.` : `${who}.`, 300);
}
