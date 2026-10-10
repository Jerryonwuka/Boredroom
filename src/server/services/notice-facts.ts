/**
 * What each of the notch's notifications is about, as structured facts (owner decision, 9 October 2026: notch
 * notifications, "A plus the grafts": "one short headline, numbers as chips, and the full text behind Open"). A
 * notification carries only its title and body; the card needs the shape behind it: who sent the message and its first
 * line, the follow-up answer's result and time logged, the team report's numbers, the request's change, the task's due
 * day, the commitment's due time. `desktopState` reads up to 20 unread notifications and gives each a `facts` field from
 * here; `facts: null` means "draw the plain card" (the notch's own fallback, from the title and body).
 *
 * Contract B (notch notifications build contract, 9 October 2026), every rule binding:
 * - Everything is read as the viewer: `withUser` (row-level security as the person) or a service getter that already
 *   reads as them (getFollowUp, getFollowUpBatch, getAssistantItem, getCommitment, getStandupRollup); never as the
 *   worker or the system. Only the viewer's own notifications come in (the caller's query is theirs, under RLS). A
 *   resource the viewer cannot read gives `null` for that notification, and nothing of it is read.
 * - At most PER_KIND_MAX lookups per kind per poll, newest first; one SQL per kind with `= ANY($ids)` where practical;
 *   getter kinds call the getter per notification, each in its own `try` (what the viewer cannot see is null).
 * - Each kind's resolver is wrapped: an error logs `[desktop] notice facts <kind>: <message>` and yields nulls.
 *   `noticeFacts` never throws.
 * - Text is one line (control and direction characters to spaces, runs collapsed): previews at most 160 characters,
 *   names 80, at most 12 people per list. Other people's words stay plain text (the notch escapes everything).
 * - Faces: every person comes with their own assistant's look, read once for everyone involved (assistant_profiles, as
 *   desktop.ts reads teammates'); anyone without a profile is Brenda.
 * - The team report's numbers come from `brenda_report_log.facts` (migration 0052, written by daily-report.ts with the
 *   report); before 0052, or for a report written before it, from the report's snapshot (`source: "snapshot"`: finished,
 *   overdue and blocked only); with neither, null.
 * - The getter kinds (answer, batch, request, commitment, rollup) are kept 2 minutes per person and notification (review,
 *   9 October 2026: rebuilt on every poll they cost a few transactions each, one after another); the SQL kinds are read
 *   every time, so a withdrawn message or a channel left shows at the next poll.
 * Kinds the notch draws from the state lists it already reads (the follow-up ask, assistant messages and replies,
 * commitments and open asks noted, blocks, standup drafts) get no facts here.
 *
 * Calls (owner decisions, 8 October 2026: phase 8): a missed call (`call.missed`) gets `kind: "call"`: who called (with
 * their assistant's face), where ("#Design", or null for a one-to-one call), whether the call is still on (`live`: the
 * card offers Join) and, for a one-to-one call, who to call back. Read as the viewer under row-level security: only
 * someone the call rang (or who reads its conversation) gets facts. None before migration 0054.
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { localDate } from "@/server/lib/time";
import { forget0046, retryWithout0046, schema0046Ready } from "@/server/lib/schema-0046";
import { forget0052, isMissingSchema, retryWithout0052, schema0052Ready } from "@/server/lib/schema-0052";
import { DEFAULT_ASSISTANT, PALETTE, isAssistantColour, isAssistantEyes, isAssistantVisor, type AssistantProfile } from "@/lib/assistant-look";
import { REPLY_LABELS, clip, type FollowUpView, type PersonRef } from "@/lib/follow-ups";
import { isRequestTaskStatus, type RequestPayload } from "@/lib/assistant-items";
import type { DesktopAssistant } from "@/server/services/desktop";
import { getFollowUp, getFollowUpBatch } from "@/server/services/follow-ups";
import { getAssistantItem } from "@/server/services/assistant-items";
import { getCommitment } from "@/server/services/commitments";
import { getStandupRollup } from "@/server/services/standup";
import { snapshotOf, type ReportFacts, type ReportSnapshot } from "@/server/services/daily-report";
import { retryWithout0054, schema0054Ready } from "@/server/lib/schema-0054";

// ---- The shape (contract B.1) ------------------------------------------------------------------------------------------

export type NoticePerson = { membershipId: string; name: string; assistant: DesktopAssistant };
export type AnswerResultKey = "on_track" | "blocked" | "done" | "not_started" | "in_progress" | "in_review" | "no_reply" | "not_now" | "failed";
export type NoticeRequest = {
  kind: "add_todo" | "set_reminder" | "task_status" | "task_comment"; title: string | null; taskTitle: string | null;
  fromStatus: string | null; toStatus: string | null; dueAt: string | null; at: string | null; text: string | null;
};
export type NoticeFacts =
  | { v: 1; kind: "message"; from: NoticePerson | null; preview: string | null; where: string | null; direct: boolean; task: string | null }
  | { v: 1; kind: "mention"; from: NoticePerson | null; preview: string | null; where: string | null }
  | { v: 1; kind: "comment"; from: NoticePerson | null; preview: string | null; task: string | null }
  | { v: 1; kind: "answer"; subject: NoticePerson; question: string; task: string | null; status: "answered" | "expired" | "declined" | "failed";
      result: { key: AnswerResultKey; label: string } | null; time: { todaySeconds: number; weekSeconds: number } | null;
      openTasks: number | null; engine: "claude" | "template" | null; href: string }
  | { v: 1; kind: "batch"; counts: { total: number; answered: number; replied: number; noReply: number; declined: number; failed: number } }
  | { v: 1; kind: "report"; localDate: string; source: "facts" | "snapshot"; trackedSeconds: number | null; finished: number | null;
      overdue: number | null; blocked: number | null;
      missing: { count: number; people: NoticePerson[] } | null; late: { count: number; people: (NoticePerson & { minutes: number })[] } | null }
  | { v: 1; kind: "review"; decision: "requested" | "approved" | "changes_requested" | "question"; task: { id: string; title: string };
      by: NoticePerson | null; revision: number | null; daysEarly: number | null; note: string | null }
  | { v: 1; kind: "assignment"; task: { id: string; title: string; project: string | null; dueAt: string | null; estimateMinutes: number | null;
      priority: "low" | "normal" | "high" | "urgent"; status: string }; by: NoticePerson | null; canStart: boolean }
  | { v: 1; kind: "request"; from: NoticePerson; status: string; expiresAt: string | null; note: string | null; result: string | null;
      request: NoticeRequest | null }
  | { v: 1; kind: "commitment"; title: string; dueAt: string | null; dueLabel: string | null; status: string; overdue: boolean;
      asker: NoticePerson | null; committer: NoticePerson; canMarkDone: boolean; href: string }
  | { v: 1; kind: "reminder"; text: string; at: string; setAt: string | null; taskTitle: string | null; taskId: string | null }
  | { v: 1; kind: "routine"; name: string; lead: string; sections: { id: string; label: string; count: number }[] }
  | { v: 1; kind: "rollup"; team: string; posted: number; members: number; blockers: number;
      noUpdate: NoticePerson[]; late: NoticePerson[] }
  // Phase 8: a missed call. `live`: still on (Join); `callBack`: a one-to-one call's caller (Call back).
  | { v: 1; kind: "call"; callId: string; from: NoticePerson; where: string | null; direct: boolean; at: string; live: boolean;
      callBack: { membershipId: string } | null };
export type NoticeKind = NoticeFacts["kind"];

/** A notification as the notch receives it: the row's own fields and its facts (null: the plain card). */
export type DesktopNotification = {
  id: string; type: string; title: string; body: string | null; href: string | null;
  resource_id: string | null; created_at: string; facts: NoticeFacts | null;
};
/** The notification row as read here: plus its key and resource type, which stay on the server (never sent to the notch). */
export type NoticeRow = Omit<DesktopNotification, "facts"> & { resource_type: string | null; deduplication_key: string };

// ---- Limits and plain helpers (pure) -----------------------------------------------------------------------------------

export const NOTICE_LIMITS = { perKind: 6, preview: 160, name: 80, people: 12, concurrency: 4 } as const;
const L = NOTICE_LIMITS;

// Control characters (C0, C1), line and paragraph separators, and the direction marks and overrides that would reorder
// the words around them.
const STRAY = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** One line: control and direction characters to spaces, runs of white space collapsed, trimmed. */
export function oneLine(s: string | null | undefined): string {
  return (s ?? "").replace(STRAY, " ").replace(/\s+/g, " ").trim();
}
/** One line of at most `max` characters ("…" when cut, never splitting an emoji); null when nothing is left. */
export function clipLine(s: string | null | undefined, max: number = L.preview): string | null {
  const t = oneLine(s);
  return t ? clip(t, max) : null;
}
const nameOf = (s: string | null | undefined) => clipLine(s, L.name) ?? "Someone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** `prefix:<uuid>[:<uuid>]`: the first id, lower case; null for anything else (another prefix, a part that is not a UUID). */
function keyId(key: string | null | undefined, prefix: string, parts: 2 | 3): string | null {
  if (typeof key !== "string") return null;
  const p = key.split(":");
  if (p.length !== parts || p[0] !== prefix || !p.slice(1).every(isUuid)) return null;
  return p[1].toLowerCase();
}
/** The notification keys the facts are read by (the services that notify write them): message.direct `message:<message>`. */
export const messageIdOf = (key: string | null | undefined) => keyId(key, "message", 2);
/** message.mention: `mention:<message>:<recipient membership>`. */
export const mentionIdOf = (key: string | null | undefined) => keyId(key, "mention", 3);
/** task.comment: `comment:<comment>:<recipient membership>`. */
export const commentIdOf = (key: string | null | undefined) => keyId(key, "comment", 3);
/** brenda.reminder: `brenda.reminder:<reminder>`. */
export const reminderIdOf = (key: string | null | undefined) => keyId(key, "brenda.reminder", 2);
/** review.approved / changes_requested / question: `review:<review>`. */
export const reviewIdOf = (key: string | null | undefined) => keyId(key, "review", 2);
/** review.requested: `review.requested:<submission>`. */
export const submissionIdOf = (key: string | null | undefined) => keyId(key, "review.requested", 2);
/** brenda.daily_report: `brenda.daily_report:<local date>`, the day (YYYY-MM-DD, a real date) or null. */
export function reportDayOf(key: string | null | undefined): string | null {
  const m = typeof key === "string" ? /^brenda\.daily_report:(\d{4}-\d{2}-\d{2})$/.exec(key) : null;
  if (!m || Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`)) || new Date(`${m[1]}T00:00:00Z`).toISOString().slice(0, 10) !== m[1]) return null;
  return m[1];
}

/** Which facts a notification gets, by type; null: none (the state lists, or a kind the notch draws plainly). */
export function noticeKindOf(n: Pick<NoticeRow, "type" | "resource_type">): NoticeKind | null {
  switch (n.type) {
    case "message.direct": return "message";
    case "message.mention": return "mention";
    case "task.comment": return "comment";
    case "brenda.followup_answer": return "answer";
    // A group's batch only: a routine run's answers ("Answers are in for …") point at the run, not a batch.
    case "brenda.followup_batch": return n.resource_type === "follow_up" ? "batch" : null;
    case "brenda.daily_report": return "report";
    case "review.requested": case "review.approved": case "review.changes_requested": case "review.question": return "review";
    case "task.assigned": return "assignment";
    case "assistant.request": case "assistant.outcome": return "request";
    case "brenda.commitment_due": case "brenda.commitment_accepted": case "brenda.commitment_declined": case "brenda.commitment_stalled": return "commitment";
    case "brenda.reminder": return "reminder";
    case "brenda.routine": return "routine";
    case "brenda.standup_rollup": return "rollup";
    case "call.missed": return "call";
    default: return null;
  }
}

/** An assistant as the notch draws it (as desktop.ts): checked fields, Brenda's for anything that is not one. */
function lookOf(p: Partial<AssistantProfile> | null | undefined): DesktopAssistant {
  const colour = isAssistantColour(p?.colour) ? p!.colour! : DEFAULT_ASSISTANT.colour;
  return {
    name: p?.name || DEFAULT_ASSISTANT.name, colour,
    visor: isAssistantVisor(p?.visor) ? p!.visor! : DEFAULT_ASSISTANT.visor,
    eyes: isAssistantEyes(p?.eyes) ? p!.eyes! : DEFAULT_ASSISTANT.eyes,
    face: PALETTE[colour].face,
  };
}
type Looks = (membershipId: string) => DesktopAssistant;
const personOf = (w: { membershipId: string; name: string | null }, looks: Looks): NoticePerson => ({ membershipId: w.membershipId, name: nameOf(w.name), assistant: looks(w.membershipId) });
const refPerson = (p: PersonRef): NoticePerson => ({ membershipId: p.membershipId, name: nameOf(p.name), assistant: lookOf(p.assistant) });

/**
 * Where a message was, in the words of the person reading: "#Design", "Everyone", or "your chat" (as messaging.ts says it
 * in the mention's title); null for a channel whose name could not be read.
 */
export function whereOf(kind: string, name: string | null): string | null {
  if (kind === "direct") return "your chat";
  if (kind === "organisation") return "Everyone";
  const n = clipLine(name, L.name);
  return n ? `#${n}` : null;
}

/**
 * The follow-up answer's result, the big word on the card (pure). A reply wins (its choice); no reply by the deadline is
 * "No reply", a "not now" is "Not now", a failure "Couldn't follow up". Answered from the work: a task's status, or for a
 * person their time today ("Working now" while the timer runs, "Working today", "Not started today"); null when their
 * time is not visible to the asker or nothing was shared.
 */
export function answerResult(v: Pick<FollowUpView, "status" | "reply" | "facts">): { key: AnswerResultKey; label: string } | null {
  switch (v.status) {
    case "failed": return { key: "failed", label: "Couldn't follow up" };
    case "expired": return { key: "no_reply", label: "No reply" };
    case "declined": return { key: "not_now", label: REPLY_LABELS.not_now };
    case "answered": break;
    default: return null;
  }
  if (v.reply) return { key: v.reply.choice, label: REPLY_LABELS[v.reply.choice] };
  const f = v.facts;
  if (!f) return null;
  if (f.kind === "task") {
    switch (f.task?.status) {
      case "todo": return { key: "not_started", label: "Not started" };
      case "in_progress": return { key: "in_progress", label: "In progress" };
      case "blocked": return { key: "blocked", label: "Blocked" };
      case "in_review": return { key: "in_review", label: "In review" };
      case "completed": return { key: "done", label: "Done" };
      default: return null;
    }
  }
  if (!f.timeVisible) return null;
  if (f.timer?.state === "running") return { key: "on_track", label: "Working now" };
  if (!f.time) return null;
  return f.time.todaySeconds > 0 ? { key: "on_track", label: "Working today" } : { key: "not_started", label: "Not started today" };
}

/**
 * A request's change, from its structured payload (pure): what the card draws as the move row. A task move's statuses are
 * the keys ("in_progress", "in_review"): the notch says them in its own words. Null without one.
 */
export function requestMove(p: RequestPayload | null | undefined): NoticeRequest | null {
  if (!p || p.v !== 1) return null;
  const none: NoticeRequest = { kind: p.kind, title: null, taskTitle: null, fromStatus: null, toStatus: null, dueAt: null, at: null, text: null };
  switch (p.kind) {
    case "add_todo": return { ...none, title: clipLine(p.title), dueAt: p.dueAt ?? null };
    case "set_reminder": return { ...none, text: clipLine(p.text), at: p.at };
    case "task_status": return {
      ...none, taskTitle: clipLine(p.taskTitle),
      fromStatus: isRequestTaskStatus(p.from) ? p.from : null, toStatus: isRequestTaskStatus(p.to) ? p.to : null,
    };
    case "task_comment": return { ...none, taskTitle: clipLine(p.taskTitle), text: clipLine(p.text) };
    default: return null;
  }
}

const daysApart = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/**
 * Whole days between the due date and the day the work was done, in the organisation's time zone (pure): positive is
 * early ("1 day early"), negative late, 0 on the day; null without a due date or before it was done.
 */
export function daysEarly(dueAt: string | null | undefined, doneAt: string | null | undefined, timeZone: string): number | null {
  if (!dueAt || !doneAt || Number.isNaN(Date.parse(dueAt)) || Number.isNaN(Date.parse(doneAt))) return null;
  return daysApart(localDate(doneAt, timeZone), localDate(dueAt, timeZone));
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** A stored brenda_report_log.facts, checked field by field; null when it is not one (pure). */
export function storedReportFacts(raw: unknown): ReportFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.localDate)) return null;
  if (!["self", "team", "organisation"].includes(r.scope as string)) return null;
  for (const k of ["people", "trackedSeconds", "finished", "sentForReview", "overdue", "blocked", "waitingForYou", "missingCount", "lateCount"]) if (!count(r[k])) return null;
  if (!Array.isArray(r.missing) || !Array.isArray(r.late)) return null;
  const who = (x: unknown): x is { membershipId: string; name: string } => !!x && typeof x === "object" && isUuid((x as Record<string, unknown>).membershipId) && typeof (x as Record<string, unknown>).name === "string";
  return {
    v: 1, localDate: r.localDate, scope: r.scope as ReportFacts["scope"], people: r.people as number, trackedSeconds: r.trackedSeconds as number,
    finished: r.finished as number, sentForReview: r.sentForReview as number, overdue: r.overdue as number, blocked: r.blocked as number,
    waitingForYou: r.waitingForYou as number,
    missing: r.missing.filter(who).slice(0, L.people).map((p) => ({ membershipId: p.membershipId, name: p.name })), missingCount: r.missingCount as number,
    late: r.late.filter((x): x is { membershipId: string; name: string; minutes: number } => who(x) && count((x as Record<string, unknown>).minutes))
      .slice(0, L.people).map((p) => ({ membershipId: p.membershipId, name: p.name, minutes: p.minutes })), lateCount: r.lateCount as number,
  };
}

/** The report card's counts from the report's snapshot (pure): finished, overdue (late and not done), blocked. */
export function snapshotCounts(s: ReportSnapshot): { finished: number; overdue: number; blocked: number } {
  const tasks = Object.values(s.tasks);
  return {
    finished: tasks.filter((t) => t.s === "completed").length,
    overdue: tasks.filter((t) => t.late && t.s !== "completed").length,
    blocked: tasks.filter((t) => t.s === "blocked").length,
  };
}

// ---- Resolvers, one per kind ------------------------------------------------------------------------------------------

/** One notification's facts, to be built once the faces of the people in it are read. */
type Built = { people: string[]; make: (looks: Looks) => NoticeFacts | null };
type Resolver = (ctx: OrgContext, rows: NoticeRow[]) => Promise<Map<string, Built>>;
const ready = (f: NoticeFacts): Built => ({ people: [], make: () => f });

/** Whether a getter's refusal means "the viewer cannot see this" (null, quietly) rather than a fault (logged). */
const quiet = (err: unknown) => err instanceof AppError && (err.status === 403 || err.status === 404 || err.status === 503);

/**
 * What the getter kinds found, kept a short while per person and notification (review, 9 October 2026: the facts were
 * rebuilt on every 20 s poll, each getter a settle pass and a few transactions, one notification after another). A
 * notification's facts barely change while it is unread; what does (a commitment turning overdue) is worked out when the
 * card's facts are made, not when they are read. Only the getter kinds are kept: the SQL kinds are one read per kind, and
 * they must notice at once a message withdrawn or a channel left. What the viewer cannot see is kept as "none" (the same
 * answer next time); a fault is never kept.
 */
const GETTER_TTL_MS = 2 * 60_000;
const GETTER_KEEP_MAX = 2_000;
const kept = new Map<string, { at: number; built: Built | null }>();
/** Forgets what the getter kinds found (tests; a process keeps it at most GETTER_TTL_MS anyway). */
export function forgetNoticeFacts(): void { kept.clear(); }
function keep(key: string, built: Built | null) {
  kept.delete(key);
  kept.set(key, { at: Date.now(), built });
  while (kept.size > GETTER_KEEP_MAX) { const oldest = kept.keys().next().value; if (oldest === undefined) break; kept.delete(oldest); }
}

/** Calls a getter per notification, in turn, each in its own try: what the viewer cannot see is null. Kept GETTER_TTL_MS. */
async function each<T>(ctx: OrgContext, kind: NoticeKind, rows: NoticeRow[], get: (id: string) => Promise<T | null>, build: (v: T, n: NoticeRow) => Built | null): Promise<Map<string, Built>> {
  const out = new Map<string, Built>();
  const now = Date.now();
  for (const n of rows) {
    if (!isUuid(n.resource_id)) continue;
    const key = `${ctx.org.id}:${ctx.membership.id}:${kind}:${n.id}`;
    const hit = kept.get(key);
    if (hit && now - hit.at < GETTER_TTL_MS) { if (hit.built) out.set(n.id, hit.built); continue; }
    try {
      const v = await get(n.resource_id);
      const b = v ? build(v, n) : null;
      keep(key, b);
      if (b) out.set(n.id, b);
    } catch (err) {
      if (err instanceof AppError && (err.status === 403 || err.status === 404)) keep(key, null); // not theirs to see: the same next time
      else if (!quiet(err) && !isMissingSchema(err)) console.warn(`[desktop] notice facts ${kind}: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  return out;
}

type MessageRow = { id: string; sender: string | null; sender_name: string | null; body: string; deleted: boolean; task_title: string | null; kind: string; conv_name: string | null };
/** The messages behind message.direct and message.mention, as the viewer reads them (a conversation they left: none). */
async function readMessages(ctx: OrgContext, ids: string[]): Promise<Map<string, MessageRow>> {
  const rows = await withUser(ctx.user.profileId, (db) => db.query<MessageRow>(
    `SELECT m.id, m.sender_membership_id AS sender, p.display_name AS sender_name, m.body, m.deleted_at IS NOT NULL AS deleted,
            t.title AS task_title, c.kind, CASE c.kind WHEN 'team' THEN tm.name WHEN 'channel' THEN c.title END AS conv_name
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN teams tm ON tm.id = c.team_id
     LEFT JOIN tasks t ON t.id = m.task_id
     LEFT JOIN memberships ms ON ms.id = m.sender_membership_id
     LEFT JOIN profiles p ON p.id = ms.user_id
     WHERE m.id = ANY($1::uuid[]) AND m.organisation_id = $2`, [ids, ctx.org.id]));
  return new Map(rows.map((r) => [r.id, r]));
}

function messagesBy(kind: "message" | "mention"): Resolver {
  return async (ctx, rows) => {
    const want = new Map<string, string>();
    for (const n of rows) {
      const id = kind === "message" ? messageIdOf(n.deduplication_key) : mentionIdOf(n.deduplication_key);
      if (id) want.set(n.id, id);
    }
    const out = new Map<string, Built>();
    if (!want.size) return out;
    const found = await readMessages(ctx, [...new Set(want.values())]);
    for (const [nid, mid] of want) {
      const m = found.get(mid);
      if (!m) continue;
      // A withdrawn message keeps who sent it, never its words.
      const preview = m.deleted ? null : clipLine(m.body);
      const from = (looks: Looks) => (m.sender ? personOf({ membershipId: m.sender, name: m.sender_name }, looks) : null);
      out.set(nid, {
        people: m.sender ? [m.sender] : [],
        make: (looks) => kind === "message"
          ? { v: 1, kind: "message", from: from(looks), preview, where: m.kind === "direct" ? null : whereOf(m.kind, m.conv_name), direct: m.kind === "direct", task: clipLine(m.task_title) }
          : { v: 1, kind: "mention", from: from(looks), preview, where: whereOf(m.kind, m.conv_name) },
      });
    }
    return out;
  };
}

const comments: Resolver = async (ctx, rows) => {
  const want = new Map<string, string>();
  for (const n of rows) { const id = commentIdOf(n.deduplication_key); if (id) want.set(n.id, id); }
  const out = new Map<string, Built>();
  if (!want.size) return out;
  const found = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; author: string; author_name: string | null; body: string; task_title: string | null }>(
    `SELECT c.id, c.author_membership_id AS author, p.display_name AS author_name, c.body, t.title AS task_title
     FROM task_comments c
     JOIN tasks t ON t.id = c.task_id
     LEFT JOIN memberships ms ON ms.id = c.author_membership_id
     LEFT JOIN profiles p ON p.id = ms.user_id
     WHERE c.id = ANY($1::uuid[]) AND c.organisation_id = $2`, [[...new Set(want.values())], ctx.org.id]));
  const byId = new Map(found.map((r) => [r.id, r]));
  for (const [nid, cid] of want) {
    const c = byId.get(cid);
    if (!c) continue;
    out.set(nid, { people: [c.author], make: (looks) => ({ v: 1, kind: "comment", from: personOf({ membershipId: c.author, name: c.author_name }, looks), preview: clipLine(c.body), task: clipLine(c.task_title) }) });
  }
  return out;
};

const ANSWER_STATUSES = ["answered", "expired", "declined", "failed"] as const;
const answers: Resolver = (ctx, rows) => each(ctx, "answer", rows, (id) => getFollowUp(ctx, id), (v) => {
  const status = (ANSWER_STATUSES as readonly string[]).includes(v.status) ? v.status as (typeof ANSWER_STATUSES)[number] : null;
  if (!status) return null;
  const f = v.facts;
  return ready({
    v: 1, kind: "answer", subject: refPerson(v.subject), question: clipLine(v.question) ?? "", task: clipLine(v.task?.title), status,
    result: answerResult(v),
    // Time only as the asker may see it (the facts say so); open work only for a person's follow-up.
    time: f?.timeVisible && f.time ? { todaySeconds: Math.max(0, f.time.todaySeconds), weekSeconds: Math.max(0, f.time.weekSeconds) } : null,
    openTasks: f?.kind === "person" && Array.isArray(f.openTasks) ? f.openTasks.length + Math.max(0, f.openMore ?? 0) : null,
    engine: status === "failed" ? null : v.answerEngine, href: v.href,
  });
});

const batches: Resolver = (ctx, rows) => each(ctx, "batch", rows, (id) => getFollowUpBatch(ctx, id), (b) => {
  const c = b.counts;
  return ready({ v: 1, kind: "batch", counts: { total: c.total, answered: c.answered, replied: c.replied, noReply: c.noReply, declined: c.declined, failed: c.failed } });
});

/**
 * The team report (the reader's own log row): its counts (0052), else its snapshot's. Found by the document the
 * notification points at, or by the day in its key (`brenda.daily_report:<date>`) when the report was written again as a
 * new document since (the person had edited the first).
 */
const reports: Resolver = async (ctx, rows) => {
  const docs = [...new Set(rows.map((n) => n.resource_id).filter(isUuid))];
  const days = [...new Set(rows.map((n) => reportDayOf(n.deduplication_key)).filter((d): d is string => !!d))];
  const out = new Map<string, Built>();
  if (!docs.length && !days.length) return out;
  type LogRow = { doc_id: string | null; local_date: string; snapshot: unknown; facts: unknown };
  const read = () => withUser(ctx.user.profileId, async (db: Db) => {
    // The counts (0052) and the snapshot (0046) only once each column is there; the reader's own rows only.
    const withFacts = await schema0052Ready(db);
    const withSnapshot = await schema0046Ready(db);
    return db.query<LogRow>(
      `SELECT doc_id, local_date::text AS local_date, ${withSnapshot ? "snapshot" : "NULL::jsonb AS snapshot"}, ${withFacts ? "facts" : "NULL::jsonb AS facts"}
       FROM brenda_report_log WHERE membership_id = $2 AND organisation_id = $3 AND (doc_id = ANY($1::uuid[]) OR local_date = ANY($4::date[]))`,
      [docs, ctx.membership.id, ctx.org.id, days]);
  });
  let logs: LogRow[];
  try {
    logs = await retryWithout0046(() => retryWithout0052(read));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    // A database restored to before either migration while the process runs: once more without both.
    forget0052(); forget0046();
    logs = await read();
  }
  const byDoc = new Map(logs.filter((l) => l.doc_id).map((l) => [l.doc_id!, l]));
  const byDay = new Map(logs.map((l) => [l.local_date, l]));
  for (const n of rows) {
    const day = reportDayOf(n.deduplication_key);
    const l = (n.resource_id ? byDoc.get(n.resource_id) : undefined) ?? (day ? byDay.get(day) : undefined);
    if (!l) continue;
    const f = storedReportFacts(l.facts);
    if (f) {
      out.set(n.id, {
        people: [...f.missing, ...f.late].map((p) => p.membershipId),
        make: (looks) => ({
          v: 1, kind: "report", localDate: l.local_date, source: "facts", trackedSeconds: f.trackedSeconds, finished: f.finished, overdue: f.overdue, blocked: f.blocked,
          missing: { count: f.missingCount, people: f.missing.map((p) => personOf(p, looks)) },
          late: { count: f.lateCount, people: f.late.map((p) => ({ ...personOf(p, looks), minutes: p.minutes })) },
        }),
      });
      continue;
    }
    const s = snapshotOf(l.snapshot);
    if (s) out.set(n.id, ready({ v: 1, kind: "report", localDate: l.local_date, source: "snapshot", trackedSeconds: null, ...snapshotCounts(s), missing: null, late: null }));
  }
  return out;
};

type ReviewRow = { key: string; task_id: string; title: string; due_at: string | null; completed_at: string | null; revision: number; by: string | null; by_name: string | null; note: string | null };
const DECISIONS = { "review.requested": "requested", "review.approved": "approved", "review.changes_requested": "changes_requested", "review.question": "question" } as const;
/**
 * Reviews: the exact review (approved, changes requested, a question) or submission (review requested) the notification
 * was written for, by its key, and only on the task it points at: the reviewer and their note, or the submitter and
 * theirs; the revision; for approved work, how early or late it was done.
 */
const reviews: Resolver = async (ctx, rows) => {
  const decided = new Map<string, string>(), requested = new Map<string, string>();
  for (const n of rows) {
    if (n.type === "review.requested") { const s = submissionIdOf(n.deduplication_key); if (s) requested.set(n.id, s); }
    else { const r = reviewIdOf(n.deduplication_key); if (r) decided.set(n.id, r); }
  }
  const out = new Map<string, Built>();
  if (!decided.size && !requested.size) return out;
  const { byReview, bySubmission } = await withUser(ctx.user.profileId, async (db) => ({
    byReview: decided.size ? await db.query<ReviewRow>(
      `SELECT r.id AS key, t.id AS task_id, t.title, t.due_at, t.completed_at, s.revision, r.reviewer_membership_id AS by, p.display_name AS by_name, r.note
       FROM reviews r JOIN task_submissions s ON s.id = r.submission_id JOIN tasks t ON t.id = s.task_id
       LEFT JOIN memberships ms ON ms.id = r.reviewer_membership_id LEFT JOIN profiles p ON p.id = ms.user_id
       WHERE r.id = ANY($1::uuid[]) AND r.organisation_id = $2`, [[...new Set(decided.values())], ctx.org.id]) : [],
    bySubmission: requested.size ? await db.query<ReviewRow>(
      `SELECT s.id AS key, t.id AS task_id, t.title, t.due_at, t.completed_at, s.revision, s.submitted_by AS by, p.display_name AS by_name, s.note
       FROM task_submissions s JOIN tasks t ON t.id = s.task_id
       LEFT JOIN memberships ms ON ms.id = s.submitted_by LEFT JOIN profiles p ON p.id = ms.user_id
       WHERE s.id = ANY($1::uuid[]) AND s.organisation_id = $2`, [[...new Set(requested.values())], ctx.org.id]) : [],
  }));
  const found = new Map([...byReview, ...bySubmission].map((r) => [r.key, r]));
  for (const n of rows) {
    const key = decided.get(n.id) ?? requested.get(n.id);
    const r = key ? found.get(key) : undefined;
    const decision = DECISIONS[n.type as keyof typeof DECISIONS];
    if (!r || !decision || (n.resource_id && r.task_id !== n.resource_id)) continue;
    out.set(n.id, {
      people: r.by ? [r.by] : [],
      make: (looks) => ({
        v: 1, kind: "review", decision, task: { id: r.task_id, title: clipLine(r.title) ?? "A task" },
        by: r.by ? personOf({ membershipId: r.by, name: r.by_name }, looks) : null, revision: r.revision ?? null,
        daysEarly: decision === "approved" ? daysEarly(r.due_at, r.completed_at, ctx.org.timezone) : null, note: clipLine(r.note),
      }),
    });
  }
  return out;
};

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
/**
 * A task assigned: the task as the viewer sees it, who gave it (the creator, for "New task: …"; a reassignment names
 * nobody), and whether the notch may offer Start timer (a worker, their own task, to do or in progress).
 */
const assignments: Resolver = async (ctx, rows) => {
  const ids = [...new Set(rows.map((n) => n.resource_id).filter(isUuid))];
  const out = new Map<string, Built>();
  if (!ids.length) return out;
  const found = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; title: string; project: string | null; due_at: string | null; estimate_minutes: number | null; priority: string; status: string; archived: boolean; assignee: string; created_by: string; by_name: string | null }>(
    `SELECT t.id, t.title, pr.name AS project, t.due_at, t.estimate_minutes, t.priority, t.status, t.archived_at IS NOT NULL AS archived,
            t.assignee_membership_id AS assignee, t.created_by, p.display_name AS by_name
     FROM tasks t LEFT JOIN projects pr ON pr.id = t.project_id
     LEFT JOIN memberships ms ON ms.id = t.created_by LEFT JOIN profiles p ON p.id = ms.user_id
     WHERE t.id = ANY($1::uuid[]) AND t.organisation_id = $2`, [ids, ctx.org.id]));
  const byId = new Map(found.map((t) => [t.id, t]));
  const worker = ctx.membership.role === "employee" || ctx.membership.role === "manager";
  for (const n of rows) {
    const t = n.resource_id ? byId.get(n.resource_id) : undefined;
    if (!t) continue;
    const by = n.title.startsWith("New task:") && t.created_by !== ctx.membership.id ? t.created_by : null;
    const priority = (PRIORITIES as readonly string[]).includes(t.priority) ? t.priority as (typeof PRIORITIES)[number] : "normal";
    out.set(n.id, {
      people: by ? [by] : [],
      make: (looks) => ({
        v: 1, kind: "assignment",
        task: { id: t.id, title: clipLine(t.title) ?? "A task", project: clipLine(t.project, L.name), dueAt: t.due_at, estimateMinutes: t.estimate_minutes ?? null, priority, status: t.status },
        by: by ? personOf({ membershipId: by, name: t.by_name }, looks) : null,
        canStart: worker && t.assignee === ctx.membership.id && !t.archived && (t.status === "todo" || t.status === "in_progress"),
      }),
    });
  }
  return out;
};

/**
 * Requests between assistants (assistant.request, to the recipient) and their outcome (assistant.outcome, to the sender):
 * the other party, the change asked for, the sender's note to the recipient (or, for the sender, the recipient's reason
 * when they declined), and what was done.
 */
const requests: Resolver = (ctx, rows) => each(ctx, "request", rows, (id) => getAssistantItem(ctx, id), (it) => {
  if (it.kind !== "request") return null;
  const other = it.viewer === "recipient" ? it.sender : it.viewer === "sender" ? it.recipient : null;
  if (!other) return null;
  return ready({
    v: 1, kind: "request", from: refPerson(other), status: it.status, expiresAt: it.request?.expiresAt ?? null,
    note: it.viewer === "recipient" ? clipLine(it.body) : clipLine(it.declineReason), result: clipLine(it.result?.words),
    request: requestMove(it.request?.payload),
  });
});

// Whether it is overdue is worked out each time the facts are made (they are kept a while: `each`).
const commitments: Resolver = (ctx, rows) => each(ctx, "commitment", rows, (id) => getCommitment(ctx, id), (c) => ({ people: [], make: () => ({
  v: 1, kind: "commitment", title: clipLine(c.title) ?? "A commitment", dueAt: c.dueAt, dueLabel: c.dueLabel, status: c.status,
  overdue: c.status === "open" && !!c.dueAt && Date.parse(c.dueAt) < Date.now(),
  asker: c.asker ? refPerson(c.asker) : null, committer: refPerson(c.committer), canMarkDone: c.canMarkDone, href: c.href,
}) }));

/** A reminder's longest text (reminderSchema in services/brenda.ts). */
const REMINDER_TEXT_MAX = 500;
const reminders: Resolver = async (ctx, rows) => {
  const want = new Map<string, string>();
  for (const n of rows) { const id = reminderIdOf(n.deduplication_key); if (id) want.set(n.id, id); }
  const out = new Map<string, Built>();
  if (!want.size) return out;
  const found = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; body: string; remind_at: string; created_at: string; task_id: string | null; task_title: string | null }>(
    `SELECT r.id, r.body, r.remind_at, r.created_at, t.id AS task_id, t.title AS task_title
     FROM brenda_reminders r LEFT JOIN tasks t ON t.id = r.task_id
     WHERE r.id = ANY($1::uuid[]) AND r.membership_id = $2 AND r.organisation_id = $3`, [[...new Set(want.values())], ctx.membership.id, ctx.org.id]));
  const byId = new Map(found.map((r) => [r.id, r]));
  for (const [nid, rid] of want) {
    const r = byId.get(rid);
    // The whole reminder (at most REMINDER_TEXT_MAX, as reminders are written) and its task when the person can still see
    // it: the card's Snooze 10 min writes the same reminder again from these (integration, 9 October 2026), so a preview's
    // 160 characters would cut it short. The card clamps it to its lines either way.
    const text = r ? clipLine(r.body, REMINDER_TEXT_MAX) : null;
    if (!r || !text) continue;
    out.set(nid, ready({ v: 1, kind: "reminder", text, at: r.remind_at, setAt: r.created_at ?? null, taskTitle: clipLine(r.task_title), taskId: r.task_id ?? null }));
  }
  return out;
};

/** A routine run delivered to the person (their own runs only): its name, its lead and up to 4 sections' counts. */
const routines: Resolver = async (ctx, rows) => {
  const ids = [...new Set(rows.map((n) => n.resource_id).filter(isUuid))];
  const out = new Map<string, Built>();
  if (!ids.length) return out;
  const found = await withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0046Ready(db))) return [];
    return db.query<{ id: string; name: string; output: unknown }>(
      `SELECT rr.id, ro.name, rr.output FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id
       WHERE rr.id = ANY($1::uuid[]) AND rr.membership_id = $2 AND rr.organisation_id = $3`, [ids, ctx.membership.id, ctx.org.id]);
  });
  const byId = new Map(found.map((r) => [r.id, r]));
  for (const n of rows) {
    const r = n.resource_id ? byId.get(n.resource_id) : undefined;
    const o = r?.output as Record<string, unknown> | null | undefined;
    if (!r || !o || typeof o !== "object" || o.v !== 1) continue;
    const lead = clipLine(o.empty === true && typeof o.calm === "string" ? o.calm : typeof o.lead === "string" ? o.lead : null) ?? "";
    const sections = (Array.isArray(o.sections) ? o.sections : []).flatMap((s): { id: string; label: string; count: number }[] => {
      const x = s as Record<string, unknown> | null;
      if (!x || typeof x !== "object" || typeof x.id !== "string" || typeof x.label !== "string") return [];
      const items = Array.isArray(x.items) ? x.items.length : 0;
      return [{ id: x.id.slice(0, 64), label: clipLine(x.label, L.name) ?? "", count: items + (count(x.more) ? x.more : 0) }];
    }).slice(0, 4);
    out.set(n.id, ready({ v: 1, kind: "routine", name: nameOf(r.name), lead, sections }));
  }
  return out;
};

const rollups: Resolver = (ctx, rows) => each(ctx, "rollup", rows, (id) => getStandupRollup(ctx, id), (r) => {
  const c = r.content;
  if (!c) return null;
  const noUpdate = (c.noUpdate ?? []).slice(0, L.people), late = (c.late ?? []).slice(0, L.people);
  return {
    people: [...noUpdate, ...late].map((p) => p.membershipId),
    make: (looks) => ({
      v: 1, kind: "rollup", team: nameOf(c.team?.name ?? r.team.name), posted: c.counts.posted, members: c.counts.members, blockers: (c.blockers ?? []).length,
      noUpdate: noUpdate.map((p) => personOf(p, looks)), late: late.map((p) => personOf(p, looks)),
    }),
  };
});

/**
 * A missed call (phase 8): the call the notification points at, as the viewer reads it (row-level security: the people it
 * rang and its conversation's readers), with who started it and where. `live` (the card's Join) only while the call is
 * on, the viewer is not in it already and still reads its conversation (fix review, 10 October 2026: the card kept
 * offering Join after a late join). None before migration 0054.
 */
const calls: Resolver = async (ctx, rows) => {
  const ids = [...new Set(rows.filter((n) => n.resource_type === "call").map((n) => n.resource_id).filter(isUuid))];
  const out = new Map<string, Built>();
  if (!ids.length) return out;
  const found = await retryWithout0054(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0054Ready(db))) return [];
    return db.query<{ id: string; kind: string; state: string; started_by: string; by_name: string | null; created_at: string; conv_kind: string | null; conv_name: string | null; joinable: boolean }>(
      `SELECT c.id, c.kind, c.state, c.started_by, p.display_name AS by_name, c.created_at, cv.kind AS conv_kind,
              CASE cv.kind WHEN 'team' THEN t.name WHEN 'channel' THEN cv.title END AS conv_name,
              (app_can_read_conversation(c.conversation_id) AND NOT EXISTS (
                 SELECT 1 FROM call_participants x WHERE x.call_id = c.id AND x.membership_id = $3 AND x.state = 'joined')) AS joinable
       FROM calls c
       LEFT JOIN memberships ms ON ms.id = c.started_by LEFT JOIN profiles p ON p.id = ms.user_id
       LEFT JOIN conversations cv ON cv.id = c.conversation_id LEFT JOIN teams t ON t.id = cv.team_id
       WHERE c.id = ANY($1::uuid[]) AND c.organisation_id = $2`, [ids, ctx.org.id, ctx.membership.id]);
  }));
  const byId = new Map(found.map((c) => [c.id, c]));
  for (const n of rows) {
    const c = n.resource_id ? byId.get(n.resource_id) : undefined;
    if (!c) continue;
    const direct = c.kind === "direct";
    out.set(n.id, {
      people: [c.started_by],
      make: (looks) => ({
        v: 1, kind: "call", callId: c.id, from: personOf({ membershipId: c.started_by, name: c.by_name }, looks),
        where: direct ? null : whereOf(c.conv_kind ?? "channel", c.conv_name), direct, at: c.created_at, live: c.state !== "ended" && c.joinable,
        callBack: direct && c.started_by !== ctx.membership.id ? { membershipId: c.started_by } : null,
      }),
    });
  }
  return out;
};

/**
 * Each kind's resolver (contract B.2), looked up when the facts are read: the integration test replaces one for a moment
 * to see a failure stay contained.
 */
export const NOTICE_RESOLVERS: Record<NoticeKind, Resolver> = {
  message: messagesBy("message"), mention: messagesBy("mention"), comment: comments, answer: answers, batch: batches, report: reports,
  review: reviews, assignment: assignments, request: requests, commitment: commitments, reminder: reminders, routine: routines, rollup: rollups,
  call: calls,
};

// ---- The whole -----------------------------------------------------------------------------------------------------------

/** Faces for everyone the facts name, in one read as the viewer (as desktop.ts reads teammates'); Brenda for the rest. */
async function looksFor(ctx: OrgContext, ids: string[]): Promise<Looks> {
  const brenda = lookOf(DEFAULT_ASSISTANT);
  const got = new Map<string, DesktopAssistant>();
  const unique = [...new Set(ids.filter(isUuid))];
  if (unique.length) {
    try {
      const rows = await withUser(ctx.user.profileId, (db) => db.query<{ membership_id: string; name: string; colour: string; visor: string; eyes: string }>(
        `SELECT membership_id, name, colour, visor, eyes FROM assistant_profiles WHERE organisation_id = $1 AND membership_id = ANY($2::uuid[])`, [ctx.org.id, unique]));
      for (const r of rows) got.set(r.membership_id, lookOf(r as unknown as AssistantProfile));
    } catch (err) {
      // A problem reading their looks never takes the facts down: they show as Brenda.
      if (!isMissingSchema(err)) console.warn(`[desktop] notice facts faces: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  return (id) => got.get(id) ?? brenda;
}

/** Runs the tasks at most `n` at a time (each kind holds a connection while it reads). */
async function inTurns(tasks: (() => Promise<void>)[], n: number): Promise<void> {
  let next = 0;
  const lane = async () => { while (next < tasks.length) await tasks[next++](); };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, lane));
}

/**
 * The facts for the person's unread notifications (`rows`: theirs, newest first), by notification id. Notifications with
 * no facts kind, past the per-kind limit, or whose resource the person cannot read are absent (the plain card). Never
 * throws: a kind that fails logs and is absent.
 */
export async function noticeFacts(ctx: OrgContext, rows: NoticeRow[]): Promise<Map<string, NoticeFacts>> {
  const out = new Map<string, NoticeFacts>();
  try {
    const groups = new Map<NoticeKind, NoticeRow[]>();
    for (const n of rows) {
      const kind = noticeKindOf(n);
      if (!kind) continue;
      const g = groups.get(kind) ?? [];
      if (g.length < L.perKind) g.push(n);
      groups.set(kind, g);
    }
    if (!groups.size) return out;
    const built = new Map<string, Built>();
    await inTurns([...groups].map(([kind, list]) => async () => {
      try {
        for (const [id, b] of await NOTICE_RESOLVERS[kind](ctx, list)) built.set(id, b);
      } catch (err) {
        console.warn(`[desktop] notice facts ${kind}: ${(err as Error)?.message ?? String(err)}`);
      }
    }), L.concurrency);
    if (!built.size) return out;
    const looks = await looksFor(ctx, [...built.values()].flatMap((b) => b.people));
    for (const [id, b] of built) {
      try {
        const f = b.make(looks);
        if (f) out.set(id, f);
      } catch (err) {
        console.warn(`[desktop] notice facts ${id}: ${(err as Error)?.message ?? String(err)}`);
      }
    }
  } catch (err) {
    console.warn(`[desktop] notice facts: ${(err as Error)?.message ?? String(err)}`);
  }
  return out;
}
