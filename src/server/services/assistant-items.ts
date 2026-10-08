/**
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6). "I want all the bots to
 * be able to communicate with each other." Everything one person's assistant brings another is an item in an assistant
 * inbox ("Between assistants"), never a Messages thread:
 * - a MESSAGE passed on ("Tell Ben's assistant the client moved the deadline to Friday"): Olu's words as sent, which Ben
 *   marks seen (opening it counts) and may answer with one line (a REPLY, which goes back to Olu the same way);
 * - a REQUEST handed over ("Ask Ada's assistant to add “Review pricing” to her to-dos"): a validated structured payload
 *   that changes NOTHING until Ada accepts; then her own assistant does it as her, through the same services her
 *   buttons use (assistant-request-exec), and Olu is told the outcome. It expires after three days unanswered; Olu may
 *   cancel it while it is open;
 * - a REPORT NOTE ("Tell Brenda to put this in today's team report"): the person's note in today's end-of-day report,
 *   read by the report's existing audience only, withdrawable until the report is written.
 *
 * A fixed protocol, no model: nothing that arrives through an item ever starts an assistant run or a model call
 * (principle 1). Every send waits for the sender's Confirm in her chat (copilot); every change to the recipient's account
 * waits for the recipient's Accept and runs as them. Who may send is checked when the Confirm is prepared (`plan…`), again
 * when it is pressed (`sendAssistantItem` re-plans everything, under the advisory locks `aitem.send:{sender}` then
 * `aitem.recv:{recipient}`), and by the insert's row-level security (migration 0043). The recipient's own steps (seen,
 * accept, decline) and the sender's (cancel, withdraw) are definer functions with explicit checks; Boredroom's worker
 * role does the rest (finishing an accepted request, expiry, settling notes). Every worker transition is one guarded
 * statement: no row back means someone moved it first, and the caller stops quietly. Reads settle overdue rows on the
 * spot, so expiry works even with a worker that predates this phase.
 *
 * Other people's words are plain text, quoted, never instructions. Audit rows hold ids and codes, never words: owners
 * and HR see that something passed between two assistants, not what was said.
 */
import { withUser, withWorker, isRlsViolation, isUniqueViolation, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0043, isMissingSchema, retryWithout0043, schema0043Ready } from "@/server/lib/schema-0043";
import { localMidnight, localTimeOn, todayLocal } from "@/server/lib/time";
import { audit, notify } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import { matchPerson } from "@/server/services/assistant";
import { executeRequest, type ExecOutcome } from "@/server/services/assistant-request-exec";
import type { DesktopAssistant } from "@/server/services/desktop";
import { PALETTE, toProfile, type AssistantProfile } from "@/lib/assistant-look";
import { clip, firstName, type PersonRef } from "@/lib/follow-ups";
import {
  ASSISTANT_ITEM_LIMITS as L, ASSISTANT_ITEM_NOTIFICATION_TYPES as NT, ASSISTANT_ITEM_WORDS as W, ASSISTANT_TALK_NOT_READY, ASSISTANT_TALK_NOT_READY_SHORT,
  HOLDER_MOVES, STATUS_WORDS, assistantOf, dateTimeLabel, doneWords, isIsoInstant, isRequestTaskStatus, isResultCode, itemBadge, payloadOrNull, requestLines, timeLabel,
  type AssistantItemKind, type AssistantItemStatus, type AssistantItemView, type RequestKind, type RequestPayload, type RequestTaskStatus, type ResultCode,
} from "@/lib/assistant-items";

// ---- Types (the contract, G.1) ----------------------------------------------------------------------------------------

export type Origin = { conversationId: string; mentionId: string };
export type SendRefusal = "not_member" | "self" | "muted" | "limit_pair" | "limit_recipient" | "limit_sender" | "limit_notes" | "notes_off" | "report_off" | "too_late"
  | "no_report_today" | "no_reader"
  | "no_todos" | "task_not_found" | "not_theirs" | "not_visible" | "bad_transition" | "in_past" | "invalid" | "not_ready";
export type RecipientRef = { membershipId: string; name: string; firstName: string; assistant: AssistantProfile };
export type RequestInput = { kind: RequestKind; title?: string | null; due?: string | null; text?: string | null; at?: string | null; task?: string | null /* id or words */; status?: string | null; reason?: string | null };
export type SendInput =
  | { kind: "message"; recipientMembershipId: string; body: string; tidied?: boolean; origin?: Origin | null }
  | { kind: "request"; recipientMembershipId: string; payload: RequestPayload; note?: string | null; origin?: Origin | null }
  | { kind: "report_note"; body: string };
type Refused = { ok: false; code: SendRefusal; error: string };

export type DesktopAssistantItems = {
  ready: boolean;
  /** Waiting for this person, oldest first, max 5. */
  waiting: { id: string; kind: "message" | "request" | "reply"; title: string; body: string | null; lines: string[]; note: string | null;
             sender: { name: string; assistant: DesktopAssistant }; createdAt: string; expiresAt: string | null; canReply: boolean; tidied: boolean; href: string }[];
  /** This person's requests decided or expired and replies to their messages in the last 24 hours, newest first, max 5. */
  updates: { id: string; kind: "request" | "reply"; title: string; body: string | null; status: AssistantItemStatus;
             other: { name: string; assistant: DesktopAssistant }; at: string; href: string }[];
};

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", ASSISTANT_TALK_NOT_READY_SHORT);
const notHere = () => notFound(W.steps.notHere);
const warn = (what: string) => (err: unknown) => console.warn(`[assistant items] ${what}: ${(err as Error)?.message ?? String(err)}`);
const itemHref = (slug: string, id: string) => `/app/${slug}/home/assistants/items/${id}`;
const refused = (code: SendRefusal, error: string): Refused => ({ ok: false, code, error });
const NOT_READY_PLAN: Refused = { ok: false, code: "not_ready", error: ASSISTANT_TALK_NOT_READY };
const forNotch = (p: AssistantProfile): DesktopAssistant => ({ name: p.name, colour: p.colour, visor: p.visor, eyes: p.eyes, face: PALETTE[p.colour].face });
const meFirst = (ctx: OrgContext) => firstName(ctx.user.displayName);
/** The organisation's local midnight today: the daily counts start here. */
const todayStart = (ctx: OrgContext, now = new Date()) => localMidnight(todayLocal(ctx.org.timezone, now), ctx.org.timezone).toISOString();

/** One line of someone's words: control characters (line breaks included) become spaces, runs of spaces one, trimmed. */
const oneLine = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
/** Words that may run over lines (a message, a comment, a note): line breaks kept, other control characters spaces. */
const multiLine = (s: unknown) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
/** Quotes a person put around a title ("“Review pricing”"), taken off. */
const unquote = (s: string) => s.replace(/^["“'‘]+|["”'’]+$/g, "").trim();

/** Refused while an administrator is signed in as the person (support): the inbox stays exactly as the person left it. */
function notWhileImpersonated(ctx: OrgContext, words: (first: string) => string) {
  if (ctx.user.impersonation) throw forbidden(words(meFirst(ctx)));
}

/** A refusal as the error `sendAssistantItem` throws (contract G.1). */
function refusalError(r: Refused): AppError {
  switch (r.code) {
    case "not_ready": return notReady();
    case "muted": return new AppError(403, "MUTED", r.error);
    case "limit_pair": case "limit_recipient": case "limit_sender": case "limit_notes": return conflict("ASSISTANT_ITEM_LIMIT", r.error);
    case "too_late": return conflict("TOO_LATE", r.error);
    default: return new AppError(422, "INVALID_INPUT", r.error, { details: { reason: r.code } });
  }
}

// ---- Who it goes to ---------------------------------------------------------------------------------------------------

type Member = { id: string; name: string; status: string; role: string; a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null };
const MEMBER_SQL = `
  SELECT m.id, p.display_name AS name, m.status, m.role, ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes
  FROM memberships m JOIN profiles p ON p.id = m.user_id LEFT JOIN assistant_profiles ap ON ap.membership_id = m.id
  WHERE m.organisation_id = $1`;
const recipientRef = (m: Member): RecipientRef => ({ membershipId: m.id, name: m.name, firstName: firstName(m.name), assistant: toProfile({ name: m.a_name, colour: m.a_colour, visor: m.a_visor, eyes: m.a_eyes }) });

/** "Ben's assistant", "Ben Okafor's Brenda", "@Ben" → "Ben" / "Ben Okafor". */
function namesToTry(raw: string): string[] {
  const out = [raw];
  const m = raw.match(/^(.+?)['’]s(?:\s+[\p{L}\p{M}\p{N}' .-]{1,30})?$/u);
  if (m && m[1].trim() && m[1].trim() !== raw) out.push(m[1].trim());
  return out;
}

/**
 * `to` as a person: a membership id, or an exact name (`matchPerson` over the active members, as phase 4's plans: an
 * exact full name, else a first name only one person has). Several fit: the words list them; a former member: not_member.
 */
async function findRecipient(db: Db, ctx: OrgContext, to: string): Promise<{ ok: true; member: Member } | Refused> {
  const raw = oneLine(to).replace(/^@+/, "");
  if (!raw) return refused("not_member", W.refusals.sayWho());
  const members = await db.query<Member>(`${MEMBER_SQL} ORDER BY p.display_name`, [ctx.org.id]);
  const active = members.filter((m) => m.status === "active");
  if (UUID.test(raw)) {
    const hit = members.find((m) => m.id.toLowerCase() === raw.toLowerCase());
    if (!hit) return refused("not_member", W.refusals.notMember("That person"));
    if (hit.status !== "active") return refused("not_member", W.refusals.notMember(hit.name));
    return { ok: true, member: hit };
  }
  for (const name of namesToTry(raw)) {
    const p = matchPerson(name, active.map((m) => ({ id: m.id, display_name: m.name })));
    if (p) return { ok: true, member: active.find((m) => m.id === p.id)! };
  }
  for (const name of namesToTry(raw)) {
    const lower = name.toLowerCase();
    const several = active.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === lower.split(/\s+/)[0] || m.name.toLowerCase().includes(lower));
    if (several.length > 1) return refused("not_member", W.refusals.severalPeople(name, several.map((m) => m.name)));
    const gone = members.find((m) => m.status !== "active" && m.name.toLowerCase() === lower);
    if (gone) return refused("not_member", W.refusals.notMember(gone.name));
  }
  return refused("not_member", W.refusals.noPerson(raw));
}

/** The database's answer to "may I send this kind to them?" (app_assistant_item_refusal), in words. */
async function refusalOf(db: Db, ctx: OrgContext, recipient: Member | null, kind: AssistantItemKind): Promise<Refused | null> {
  const r = await db.one<{ reason: string | null }>(`SELECT app_assistant_item_refusal($1, $2, $3) AS reason`, [ctx.org.id, recipient?.id ?? null, kind]);
  if (!r.reason) return null;
  const first = recipient ? firstName(recipient.name) : "";
  switch (r.reason) {
    case "self": return refused("self", W.refusals.self());
    case "muted": return refused("muted", W.refusals.muted(first));
    case "notes_off": return refused("notes_off", W.refusals.notesOff());
    case "report_off": return refused("report_off", W.refusals.reportOff());
    case "too_late": return refused("too_late", W.refusals.tooLate());
    // Migration 0044's codes (the service checks the same before it: noteCoverage).
    case "no_report_today": return refused("no_report_today", W.refusals.noReportToday());
    case "no_reader": return refused("no_reader", W.refusals.noReader());
    case "bad_kind": return refused("invalid", W.refusals.badKind());
    default: return refused("not_member", W.refusals.notMember(recipient?.name ?? "That person"));
  }
}

// ---- Whether a note can be read (review, 8 October 2026) ---------------------------------------------------------------

/**
 * Whether a report goes out on `date` that could carry a note by `author`: the day is one of the organisation's working
 * days (as scheduleDailyReports reads them: the latest organisation-wide schedule, Monday to Friday without one), and
 * someone other than the author receives a report that covers them (a lead of a live team they are in, or the owner and
 * HR while the report goes organisation-wide; reportRecipients and app_can_view_records). Read by Boredroom's worker
 * role: it answers with two booleans, nothing else. Migration 0044 makes the database refuse the same.
 */
const NOTE_COVERAGE_SQL = `
  SELECT (COALESCE(s.working_days::int[], '{1,2,3,4,5}'::int[]) @> ARRAY[EXTRACT(DOW FROM $3::date)::int]) AS working_day,
         EXISTS (SELECT 1 FROM memberships r
                 WHERE r.organisation_id = o.id AND r.status = 'active' AND r.id <> $2
                   AND ((r.role = 'manager' AND EXISTS (
                          SELECT 1 FROM team_members mgr JOIN teams t ON t.id = mgr.team_id AND t.archived_at IS NULL
                          JOIN team_members tm ON tm.team_id = mgr.team_id
                          WHERE mgr.membership_id = r.id AND mgr.is_manager AND tm.membership_id = $2))
                     OR (COALESCE(b.daily_report_org_wide, true) AND r.role IN ('owner', 'hr')))) AS has_reader
  FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id
  LEFT JOIN LATERAL (SELECT working_days FROM schedules WHERE organisation_id = o.id AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1) s ON true
  WHERE o.id = $1`;

async function noteCoverage(db: Db, orgId: string, author: string, date: string): Promise<{ working_day: boolean; has_reader: boolean }> {
  return (await db.maybeOne<{ working_day: boolean; has_reader: boolean }>(NOTE_COVERAGE_SQL, [orgId, author, date])) ?? { working_day: false, has_reader: false };
}

/** Why a note today would never be read, or null. */
async function coverageRefusal(ctx: OrgContext): Promise<Refused | null> {
  const c = await withWorker((w) => noteCoverage(w, ctx.org.id, ctx.membership.id, todayLocal(ctx.org.timezone)));
  if (!c.working_day) return refused("no_report_today", W.refusals.noReportToday());
  if (!c.has_reader) return refused("no_reader", W.refusals.noReader());
  return null;
}

/**
 * Notes a report has just carried (daily-report's deliver, either mode): "In the report" from now on, so the author can
 * no longer withdraw what a lead may already have read. Never throws.
 */
export async function markNotesInReport(ids: string[]): Promise<void> {
  const list = ids.filter(isUuid);
  if (!list.length) return;
  try {
    await withWorker((db) => db.query(
      `UPDATE assistant_items SET status = 'done', finished_at = now() WHERE id = ANY($1::uuid[]) AND kind = 'report_note' AND status = 'delivered'`, [list]));
  } catch (err) {
    if (isMissingSchema(err)) forget0043();
    else warn("marking notes as in the report")(err);
  }
}

// ---- Limits (B.2) -----------------------------------------------------------------------------------------------------

/**
 * Today's counts (from the organisation's local midnight). The sender's own are read as the sender; the recipient's
 * incoming count covers everyone's items to them, which only Boredroom's worker role reads (a separate short read: it
 * answers with a number, nothing else). Under the send's advisory locks the second sender to the same person waits, so
 * the count includes every committed item.
 */
async function limitRefusal(db: Db, ctx: OrgContext, recipient: Member | null, kind: AssistantItemKind): Promise<Refused | null> {
  const since = todayStart(ctx);
  if (kind === "reply") return null;
  if (kind === "report_note") {
    const n = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM assistant_items WHERE organisation_id = $1 AND sender_membership_id = $2 AND kind = 'report_note' AND status <> 'withdrawn'
         AND report_date = (now() AT TIME ZONE $3)::date`, [ctx.org.id, ctx.membership.id, ctx.org.timezone]);
    return n.n >= L.reportNotesPerPersonPerDay ? refused("limit_notes", W.refusals.limitNotes()) : null;
  }
  if (!recipient) return null;
  const first = firstName(recipient.name);
  const mine = await db.one<{ pair_messages: number; pair_requests: number; sent: number }>(
    `SELECT count(*) FILTER (WHERE kind = 'message' AND recipient_membership_id = $3)::int AS pair_messages,
            count(*) FILTER (WHERE kind = 'request' AND recipient_membership_id = $3)::int AS pair_requests,
            count(*) FILTER (WHERE kind IN ('message', 'request'))::int AS sent
     FROM assistant_items WHERE organisation_id = $1 AND sender_membership_id = $2 AND created_at >= $4::timestamptz`,
    [ctx.org.id, ctx.membership.id, recipient.id, since]);
  if (kind === "message" && mine.pair_messages >= L.messagesPerPairPerDay) return refused("limit_pair", W.refusals.limitPairMessages(first));
  if (kind === "request" && mine.pair_requests >= L.requestsPerPairPerDay) return refused("limit_pair", W.refusals.limitPairRequests(first));
  const incoming = await withWorker((w) => w.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM assistant_items WHERE recipient_membership_id = $1 AND kind IN ('message', 'request') AND created_at >= $2::timestamptz`, [recipient.id, since]));
  if (incoming.n >= L.incomingPerRecipientPerDay) return refused("limit_recipient", W.refusals.limitRecipient(first));
  if (mine.sent >= L.perSenderPerDay) return refused("limit_sender", W.refusals.limitSender());
  return null;
}

// ---- Plans (no writes) ------------------------------------------------------------------------------------------------

/** Who and what, checked, for the Confirm card: "Pass this to Ben's Brenda?". Writes nothing. */
export async function planMessage(ctx: OrgContext, input: { to: string; body: string }): Promise<{ ok: true; recipient: RecipientRef; body: string } | Refused> {
  const body = multiLine(input.body);
  if (!body) return refused("invalid", W.refusals.emptyMessage());
  if (body.length > L.messageMax) return refused("invalid", W.refusals.longMessage());
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return NOT_READY_PLAN;
      const who = await findRecipient(db, ctx, input.to);
      if (!who.ok) return who;
      const no = (await refusalOf(db, ctx, who.member, "message")) ?? (await limitRefusal(db, ctx, who.member, "message"));
      if (no) return no;
      return { ok: true as const, recipient: recipientRef(who.member), body };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0043(); return NOT_READY_PLAN; }
    throw err;
  }
}

const STATUS_ALIASES: Record<string, RequestTaskStatus> = {
  todo: "todo", "to do": "todo", "to-do": "todo", "not started": "todo",
  in_progress: "in_progress", "in progress": "in_progress", started: "in_progress", doing: "in_progress",
  blocked: "blocked",
  in_review: "in_review", "in review": "in_review", review: "in_review", "for review": "in_review",
  completed: "completed", complete: "completed", done: "completed", finished: "completed",
};
const statusOf = (v: unknown): RequestTaskStatus | null => {
  const s = oneLine(v).toLowerCase();
  if (isRequestTaskStatus(s)) return s;
  return STATUS_ALIASES[s] ?? null;
};

/** An instant from the tool (ISO 8601 with an offset), or a date alone ("2026-10-09": 17:00 that day). Null when it is neither. */
function instantOf(v: unknown, timeZone: string): string | null {
  const s = oneLine(v);
  if (!s) return null;
  if (isIsoInstant(s)) return new Date(s).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return localTimeOn(s, "17:00", timeZone).toISOString();
  return null;
}

type TaskRow = { id: string; title: string; status: string; assignee_membership_id: string; reviewer_membership_id: string | null };

/** A task from an id or the words of its title, among the tasks the sender can see (preferring the recipient's). */
async function findTask(db: Db, ctx: OrgContext, words: string, recipient: Member): Promise<{ ok: true; task: TaskRow } | Refused> {
  const raw = unquote(oneLine(words)).replace(/\s+(?:task|card)$/i, "").trim();
  if (!raw) return refused("task_not_found", W.refusals.sayTask());
  if (UUID.test(raw)) {
    const t = await db.maybeOne<TaskRow>(
      `SELECT id, title, status, assignee_membership_id, reviewer_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`, [raw, ctx.org.id]);
    return t ? { ok: true, task: t } : refused("task_not_found", W.refusals.taskNotFound());
  }
  const esc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
  const hits = await db.query<TaskRow>(
    `SELECT t.id, t.title, t.status, t.assignee_membership_id, t.reviewer_membership_id FROM tasks t
     WHERE t.organisation_id = $1 AND t.archived_at IS NULL
       AND (t.title ILIKE '%' || $2 || '%' OR (cardinality($3::text[]) > 0 AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) w WHERE t.title NOT ILIKE '%' || w || '%')))
     ORDER BY (lower(t.title) = lower($4)) DESC, (t.assignee_membership_id = $5) DESC, (t.reviewer_membership_id IS NOT DISTINCT FROM $5) DESC,
              (t.status <> 'completed') DESC, t.updated_at DESC LIMIT 6`,
    [ctx.org.id, esc(raw), raw.toLowerCase().split(/\s+/).filter((w) => w.length > 2).map(esc), raw, recipient.id]);
  if (!hits.length) return refused("task_not_found", W.refusals.noTask(raw, "you"));
  const exact = hits.filter((h) => h.title.toLowerCase() === raw.toLowerCase());
  if (exact.length === 1) return { ok: true, task: exact[0] };
  if (hits.length === 1) return { ok: true, task: hits[0] };
  // Several: the recipient's own one, when exactly one of them is theirs.
  const theirs = (exact.length ? exact : hits).filter((h) => h.assignee_membership_id === recipient.id);
  if (theirs.length === 1) return { ok: true, task: theirs[0] };
  return refused("task_not_found", W.refusals.severalTasks(raw, (exact.length ? exact : hits).map((h) => h.title)));
}

/** The database's answer to "may the sender ask this of them about this task?" (app_assistant_item_task_refusal), in words. */
async function taskRefusal(db: Db, task: TaskRow, recipient: Member, req: "task_status" | "task_comment"): Promise<Refused | null> {
  const r = await db.one<{ reason: string | null }>(`SELECT app_assistant_item_task_refusal($1, $2, $3) AS reason`, [task.id, recipient.id, req]);
  if (!r.reason) return null;
  const first = firstName(recipient.name);
  if (r.reason === "not_theirs") return refused("not_theirs", W.refusals.notTheirs(first));
  if (r.reason === "not_visible") return refused("not_visible", W.refusals.notVisible(first));
  if (r.reason === "bad_kind") return refused("invalid", W.refusals.badKind());
  return refused("task_not_found", W.refusals.taskNotFound());
}

/** The structured payload for a request, checked as the sender (B.1). */
async function payloadFor(db: Db, ctx: OrgContext, recipient: Member, req: RequestInput): Promise<{ ok: true; payload: RequestPayload } | Refused> {
  const first = firstName(recipient.name);
  const tz = ctx.org.timezone;
  switch (req.kind) {
    case "add_todo": {
      const title = unquote(oneLine(req.title));
      if (!title) return refused("invalid", W.refusals.emptyTodo());
      if (title.length > L.todoTitleMax) return refused("invalid", W.refusals.longTodo());
      if (recipient.role !== "employee" && recipient.role !== "manager") return refused("no_todos", W.refusals.noTodos(first));
      let dueAt: string | null = null;
      if (oneLine(req.due)) {
        dueAt = instantOf(req.due, tz);
        if (!dueAt) return refused("invalid", W.refusals.badTime(oneLine(req.due)));
      }
      return { ok: true, payload: { v: 1, kind: "add_todo", title, dueAt } };
    }
    case "set_reminder": {
      const text = unquote(oneLine(req.text));
      if (!text) return refused("invalid", W.refusals.emptyReminder());
      if (text.length > L.reminderTextMax) return refused("invalid", W.refusals.longReminder());
      if (!oneLine(req.at)) return refused("invalid", W.refusals.sayWhen());
      const at = instantOf(req.at, tz);
      if (!at) return refused("invalid", W.refusals.badTime(oneLine(req.at)));
      const ms = Date.parse(at);
      if (ms <= Date.now() + 60_000) return refused("in_past", W.refusals.inPast());
      if (ms >= Date.now() + 366 * 86_400_000) return refused("invalid", W.refusals.tooFar());
      return { ok: true, payload: { v: 1, kind: "set_reminder", text, at } };
    }
    case "task_status": {
      const to = statusOf(req.status);
      if (!to) return refused("invalid", W.refusals.sayStatus());
      const reason = oneLine(req.reason) || null;
      if (reason && reason.length > L.reasonMax) return refused("invalid", W.refusals.longReason());
      if (to === "blocked" && !reason) return refused("invalid", W.refusals.blockedWithoutReason());
      const found = await findTask(db, ctx, String(req.task ?? ""), recipient);
      if (!found.ok) return found;
      const no = await taskRefusal(db, found.task, recipient, "task_status");
      if (no) return no;
      const from = statusOf(found.task.status);
      if (!from || from === to || !HOLDER_MOVES[from].includes(to)) {
        return refused("bad_transition", W.refusals.badTransition(first, found.task.title, from ? STATUS_WORDS[from] : found.task.status, STATUS_WORDS[to]));
      }
      return { ok: true, payload: { v: 1, kind: "task_status", taskId: found.task.id, taskTitle: clip(oneLine(found.task.title), L.todoTitleMax), from, to, reason } };
    }
    case "task_comment": {
      const text = multiLine(req.text);
      if (!text) return refused("invalid", W.refusals.emptyComment());
      if (text.length > L.commentMax) return refused("invalid", W.refusals.longComment());
      const found = await findTask(db, ctx, String(req.task ?? ""), recipient);
      if (!found.ok) return found;
      const no = await taskRefusal(db, found.task, recipient, "task_comment");
      if (no) return no;
      return { ok: true, payload: { v: 1, kind: "task_comment", taskId: found.task.id, taskTitle: clip(oneLine(found.task.title), L.todoTitleMax), text } };
    }
    default:
      return refused("invalid", W.refusals.badKind());
  }
}

/**
 * A request, checked as the sender: who, the kind and its fields, a task they can see and the recipient could act on, a
 * move the holder may make, the limits. Returns the payload the Confirm carries and its words. Writes nothing.
 */
export async function planRequest(ctx: OrgContext, input: { to: string; request: RequestInput; note?: string | null }): Promise<{ ok: true; recipient: RecipientRef; payload: RequestPayload; note: string | null; summary: string; lines: string[] } | Refused> {
  const note = oneLine(input.note) || null;
  if (note && note.length > L.requestNoteMax) return refused("invalid", W.refusals.longRequestNote());
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return NOT_READY_PLAN;
      const who = await findRecipient(db, ctx, input.to);
      if (!who.ok) return who;
      const no = await refusalOf(db, ctx, who.member, "request");
      if (no) return no;
      const made = await payloadFor(db, ctx, who.member, input.request ?? ({} as RequestInput));
      if (!made.ok) return made;
      const limit = await limitRefusal(db, ctx, who.member, "request");
      if (limit) return limit;
      const { summary, lines } = requestLines(made.payload, { timeZone: ctx.org.timezone });
      return { ok: true as const, recipient: recipientRef(who.member), payload: made.payload, note, summary, lines };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0043(); return NOT_READY_PLAN; }
    throw err;
  }
}

/** A note for today's team report, checked: the switches, the time, the cap. Writes nothing. */
export async function planReportNote(ctx: OrgContext, input: { body: string }): Promise<{ ok: true; body: string; cutoffAt: string; reportTime: string } | Refused> {
  const body = multiLine(input.body);
  if (!body) return refused("invalid", W.refusals.emptyNote());
  if (body.length > L.reportNoteMax) return refused("invalid", W.refusals.longNote());
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return NOT_READY_PLAN;
      const no = (await refusalOf(db, ctx, null, "report_note")) ?? (await coverageRefusal(ctx)) ?? (await limitRefusal(db, ctx, null, "report_note"));
      if (no) return no;
      const c = await db.one<{ cutoff: string }>(`SELECT app_report_cutoff($1, (now() AT TIME ZONE $2)::date) AS cutoff`, [ctx.org.id, ctx.org.timezone]);
      return { ok: true as const, body, cutoffAt: c.cutoff, reportTime: timeLabel(c.cutoff, ctx.org.timezone) };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0043(); return NOT_READY_PLAN; }
    throw err;
  }
}

// ---- Sending (the sender's Confirm) -------------------------------------------------------------------------------------

/** The payload as the plan's input again, so a Confirm re-plans exactly what the card showed (against things as they are now). */
function inputOf(p: RequestPayload): RequestInput {
  switch (p.kind) {
    case "add_todo": return { kind: "add_todo", title: p.title, due: p.dueAt };
    case "set_reminder": return { kind: "set_reminder", text: p.text, at: p.at };
    case "task_status": return { kind: "task_status", task: p.taskId, status: p.to, reason: p.reason };
    case "task_comment": return { kind: "task_comment", task: p.taskId, text: p.text };
  }
}

/**
 * The Confirm press: re-plans everything (the card may be minutes old), then, under the advisory locks
 * `aitem.send:{sender}` and `aitem.recv:{recipient}`, checks the database's refusal and the limits once more, inserts the
 * item as the sender (its row-level security checks it a third time), notifies the recipient (messages and requests) and
 * audits it with ids and codes only. Throws AppError: 403 MUTED, 409 ASSISTANT_ITEM_LIMIT, 409 TOO_LATE, 422 (words),
 * 503 NOT_READY. The chat's done line logs it in her activity (copilot), not here.
 */
export async function sendAssistantItem(ctx: OrgContext, input: SendInput): Promise<AssistantItemView> {
  if (!input || !["message", "request", "report_note"].includes(input.kind)) throw invalid(W.refusals.badKind());
  // 1. Re-plan.
  let recipientId: string | null = null;
  let body: string | null = null;
  let tidied = false;
  let payload: RequestPayload | null = null;
  let summary = "";
  if (input.kind === "message") {
    if (!isUuid(input.recipientMembershipId)) throw invalid(W.refusals.sayWho());
    const plan = await planMessage(ctx, { to: input.recipientMembershipId, body: input.body });
    if (!plan.ok) throw refusalError(plan);
    recipientId = plan.recipient.membershipId; body = plan.body; tidied = !!input.tidied;
  } else if (input.kind === "request") {
    if (!isUuid(input.recipientMembershipId)) throw invalid(W.refusals.sayWho());
    const given = payloadOrNull(input.payload);
    if (!given) throw invalid(W.results.invalid);
    const plan = await planRequest(ctx, { to: input.recipientMembershipId, request: inputOf(given), note: input.note ?? null });
    if (!plan.ok) throw refusalError(plan);
    recipientId = plan.recipient.membershipId; body = plan.note; payload = plan.payload; summary = plan.summary;
  } else {
    const plan = await planReportNote(ctx, { body: input.body });
    if (!plan.ok) throw refusalError(plan);
    body = plan.body; tidied = false;
  }
  const kind = input.kind;
  const origin = kind !== "report_note" && input.origin && isUuid(input.origin.conversationId) && isUuid(input.origin.mentionId) ? input.origin : null;

  // 2. Lock, check again, insert, notify, audit.
  const out = await retryWithout0043(() => withUser(ctx.user.profileId, async (db): Promise<{ id: string } | { refused: Refused }> => {
    if (!(await schema0043Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`aitem.send:${ctx.membership.id}`]);
    if (recipientId) await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`aitem.recv:${recipientId}`]);
    const recipient = recipientId ? await db.maybeOne<Member>(`${MEMBER_SQL} AND m.id = $2`, [ctx.org.id, recipientId]) : null;
    if (recipientId && !recipient) return { refused: refused("not_member", W.refusals.notMember("That person")) };
    const no = (await refusalOf(db, ctx, recipient, kind)) ?? (await limitRefusal(db, ctx, recipient, kind));
    if (no) return { refused: no };
    // The origin must be the sender's own mention in that conversation (the insert's policy says so too); anything else
    // is dropped rather than refused: the item is the same without it.
    let from: Origin | null = null;
    if (origin) {
      const m = await db.maybeOne(`SELECT 1 FROM assistant_mentions WHERE id = $1 AND conversation_id = $2 AND tagger_membership_id = $3`, [origin.mentionId, origin.conversationId, ctx.membership.id]);
      if (m) from = origin;
    }
    let row: { id: string; expires_at: string | null };
    try {
      await db.query(`SAVEPOINT aitem_insert`);
      row = kind === "report_note"
        ? await db.one<{ id: string; expires_at: string }>(
            `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body, tidied, report_date, expires_at)
             SELECT $1, 'report_note', $2, NULL, $3, false, d, app_report_cutoff($1, d)
             FROM (SELECT (now() AT TIME ZONE o.timezone)::date AS d FROM organisations o WHERE o.id = $1) x
             RETURNING id, expires_at`, [ctx.org.id, ctx.membership.id, body])
        : await db.one<{ id: string; expires_at: string | null }>(
            `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, body, tidied, request_kind, payload, task_id,
                                         conversation_id, mention_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, CASE WHEN $2 = 'request' THEN now() + make_interval(days => $12) END)
             RETURNING id, expires_at`,
            [ctx.org.id, kind, ctx.membership.id, recipientId, body, kind === "message" ? tidied : false, payload?.kind ?? null, JSON.stringify(payload ?? {}),
             payload && "taskId" in payload ? payload.taskId : null, from?.conversationId ?? null, from?.mentionId ?? null, L.requestTtlDays]);
      await db.query(`RELEASE SAVEPOINT aitem_insert`);
    } catch (err) {
      await db.query(`ROLLBACK TO SAVEPOINT aitem_insert`).catch(() => undefined);
      // The database said no although every check here passed: something changed in between (a switch, a task moved).
      if (isRlsViolation(err)) return { refused: refused("invalid", "That can't be sent now: something changed since you asked. Ask me again.") };
      throw err;
    }
    if (recipient) {
      const me = await db.one<{ a_name: string | null }>(`SELECT ap.name AS a_name FROM (SELECT 1) one LEFT JOIN assistant_profiles ap ON ap.membership_id = $1`, [ctx.membership.id]);
      const mine = toProfile({ name: me.a_name }).name;
      const href = itemHref(ctx.org.slug, row.id);
      if (kind === "message") {
        await notify(db, {
          organisationId: ctx.org.id, recipientMembershipId: recipient.id, type: NT.message,
          title: W.notifications.messageTitle(meFirst(ctx), mine), body: W.notifications.messageBody(body ?? ""),
          resourceType: "assistant_item", resourceId: row.id, href, dedupKey: `aitem:${row.id}`,
        });
      } else {
        await notify(db, {
          organisationId: ctx.org.id, recipientMembershipId: recipient.id, type: NT.request,
          title: W.notifications.requestTitle(meFirst(ctx), mine, summary), body: W.notifications.requestBody(dateTimeLabel(row.expires_at!, ctx.org.timezone)),
          resourceType: "assistant_item", resourceId: row.id, href, dedupKey: `aitem:${row.id}`,
        });
      }
    }
    await audit(db, {
      organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant_item.sent", subjectType: "assistant_item", subjectId: row.id,
      subjectMembershipId: recipient?.id ?? ctx.membership.id, metadata: { itemId: row.id, kind, requestKind: payload?.kind ?? null, fromMessages: !!from },
    });
    return { id: row.id };
  }));
  if ("refused" in out) throw refusalError(out.refused);
  const view = await getAssistantItem(ctx, out.id);
  if (!view) throw notHere();
  return view;
}

// ---- Views --------------------------------------------------------------------------------------------------------------

type ViewRow = {
  id: string; kind: AssistantItemKind; status: AssistantItemStatus; sender_membership_id: string; recipient_membership_id: string | null; parent_id: string | null;
  body: string | null; tidied: boolean; request_kind: RequestKind | null; payload: unknown; task_id: string | null; report_date: string | null;
  decline_reason: string | null; result_code: string | null; result: Record<string, unknown> | null;
  seen_at: string | null; decided_at: string | null; finished_at: string | null; expires_at: string | null; created_at: string; updated_at: string;
  sender_name: string; recipient_name: string | null;
  sa_name: string | null; sa_colour: string | null; sa_visor: string | null; sa_eyes: string | null;
  ra_name: string | null; ra_colour: string | null; ra_visor: string | null; ra_eyes: string | null;
  reply_id: string | null; reply_body: string | null; reply_created_at: string | null; reply_seen_at: string | null;
  parent_body: string | null;
  conv_id: string | null; conv_name: string | null; origin_message_id: string | null;
};

/** As the viewer ($1 organisation, $2 the viewer's membership): their items under row-level security. */
const VIEW_SQL = `
  SELECT i.id, i.kind, i.status, i.sender_membership_id, i.recipient_membership_id, i.parent_id, i.body, i.tidied, i.request_kind, i.payload, i.task_id,
         i.report_date, i.decline_reason, i.result_code, i.result, i.seen_at, i.decided_at, i.finished_at, i.expires_at, i.created_at, i.updated_at,
         sp.display_name AS sender_name, rp.display_name AS recipient_name,
         sa.name AS sa_name, sa.colour AS sa_colour, sa.visor AS sa_visor, sa.eyes AS sa_eyes,
         ra.name AS ra_name, ra.colour AS ra_colour, ra.visor AS ra_visor, ra.eyes AS ra_eyes,
         r.id AS reply_id, r.body AS reply_body, r.created_at AS reply_created_at, r.seen_at AS reply_seen_at,
         par.body AS parent_body,
         c.id AS conv_id,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || ct.name WHEN 'channel' THEN '#' || c.title
                     WHEN 'direct' THEN (SELECT op.display_name FROM conversation_participants cp JOIN memberships om ON om.id = cp.membership_id JOIN profiles op ON op.id = om.user_id
                                         WHERE cp.conversation_id = c.id AND cp.membership_id <> $2 LIMIT 1) END AS conv_name,
         am.message_id AS origin_message_id
  FROM assistant_items i
  JOIN memberships sm ON sm.id = i.sender_membership_id JOIN profiles sp ON sp.id = sm.user_id
  LEFT JOIN memberships rm ON rm.id = i.recipient_membership_id LEFT JOIN profiles rp ON rp.id = rm.user_id
  LEFT JOIN assistant_profiles sa ON sa.membership_id = i.sender_membership_id
  LEFT JOIN assistant_profiles ra ON ra.membership_id = i.recipient_membership_id
  LEFT JOIN assistant_items r ON r.parent_id = i.id AND r.kind = 'reply'
  LEFT JOIN assistant_items par ON par.id = i.parent_id
  LEFT JOIN conversations c ON c.id = i.conversation_id
  LEFT JOIN teams ct ON ct.id = c.team_id
  LEFT JOIN assistant_mentions am ON am.id = i.mention_id`;

const person = (id: string, name: string | null, r: Record<string, unknown>, p: "sa" | "ra"): PersonRef => ({
  membershipId: id, name: name ?? "Someone", firstName: firstName(name ?? "Someone"),
  assistant: toProfile({ name: r[`${p}_name`], colour: r[`${p}_colour`], visor: r[`${p}_visor`], eyes: r[`${p}_eyes`] }),
});

function toView(r: ViewRow, ctx: OrgContext, o: { muted: Set<string>; now: number }): AssistantItemView {
  const me = ctx.membership.id;
  const tz = ctx.org.timezone;
  const viewer: AssistantItemView["viewer"] = r.sender_membership_id === me ? "sender" : r.recipient_membership_id === me ? "recipient" : "reader";
  const expires = r.expires_at ? Date.parse(r.expires_at) : null;
  const payload = r.kind === "request" ? payloadOrNull(r.payload) : null;
  const request = r.kind === "request" && payload && r.request_kind && r.expires_at
    ? { kind: r.request_kind, payload, ...requestLines(payload, { timeZone: tz }), expiresAt: r.expires_at }
    : null;
  const reqOpen = r.kind === "request" && (r.status === "delivered" || r.status === "seen") && expires !== null && expires > o.now;
  const reply = r.kind === "message" && r.reply_id && r.reply_body !== null && r.reply_created_at
    ? { id: r.reply_id, body: r.reply_body, createdAt: r.reply_created_at, seenAt: r.reply_seen_at } : null;
  const report = r.kind === "report_note" && r.report_date && r.expires_at
    ? { date: r.report_date, cutoffAt: r.expires_at, open: r.status === "delivered" && (expires ?? 0) > o.now } : null;
  const resultWords = typeof r.result?.words === "string" ? (r.result.words as string) : null;
  const result = r.result_code && isResultCode(r.result_code)
    ? { code: r.result_code as ResultCode, words: resultWords ?? (r.result_code === "done" ? "done" : W.results.error), ...(r.result?.sentForCheck === true ? { sentForCheck: true } : {}) } : null;
  const sender = person(r.sender_membership_id, r.sender_name, r as unknown as Record<string, unknown>, "sa");
  const recipient = r.recipient_membership_id ? person(r.recipient_membership_id, r.recipient_name, r as unknown as Record<string, unknown>, "ra") : null;
  const base = {
    kind: r.kind, status: r.status, viewer, reply, recipient, report,
  };
  return {
    id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    viewer, sender, recipient,
    body: r.body, tidied: !!r.tidied,
    request,
    reply,
    replyTo: r.kind === "reply" && r.parent_id && r.parent_body !== null ? { id: r.parent_id, body: clip(r.parent_body, 140) } : null,
    seenAt: r.seen_at, decidedAt: r.decided_at, finishedAt: r.finished_at,
    declineReason: r.decline_reason,
    result,
    report,
    origin: r.conv_id ? {
      conversationId: r.conv_id, name: r.conv_name ?? "Messages",
      href: `/app/${ctx.org.slug}/messages?c=${r.conv_id}${r.origin_message_id ? `#m-${r.origin_message_id}` : ""}`,
    } : null,
    badge: itemBadge(base, { reportTime: r.kind === "report_note" && r.expires_at ? timeLabel(r.expires_at, tz) : undefined }),
    canSeen: viewer === "recipient" && r.status === "delivered" && (r.kind === "message" || r.kind === "reply" || reqOpen),
    canReply: viewer === "recipient" && r.kind === "message" && !reply && (r.status === "delivered" || r.status === "seen"),
    canAccept: viewer === "recipient" && reqOpen,
    canDecline: viewer === "recipient" && reqOpen,
    canCancel: viewer === "sender" && reqOpen,
    canWithdraw: viewer === "sender" && r.kind === "report_note" && r.status === "delivered" && (expires ?? 0) > o.now,
    canMute: viewer === "recipient" && (r.kind === "message" || r.kind === "request") && !o.muted.has(r.sender_membership_id),
    href: itemHref(ctx.org.slug, r.id),
  };
}

async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[], tail: string): Promise<AssistantItemView[]> {
  const rows = await db.query<ViewRow>(`${VIEW_SQL} WHERE i.organisation_id = $1 AND (${where}) ${tail}`, [ctx.org.id, ctx.membership.id, ...params]);
  const muted = rows.some((r) => r.recipient_membership_id === ctx.membership.id)
    ? new Set((await db.query<{ sender_membership_id: string }>(`SELECT sender_membership_id FROM assistant_item_mutes WHERE recipient_membership_id = $1 AND muted`, [ctx.membership.id])).map((m) => m.sender_membership_id))
    : new Set<string>();
  const now = Date.now();
  return rows.map((r) => toView(r, ctx, { muted, now }));
}

// ---- Settling (worker transitions; also run at read time) ---------------------------------------------------------------

type SettleRow = {
  id: string; organisation_id: string; kind: AssistantItemKind; status: AssistantItemStatus; sender_membership_id: string; recipient_membership_id: string | null;
  request_kind: RequestKind | null; payload: unknown; expires_at: string | null; decided_at: string | null; lease_until: string | null; decline_reason: string | null;
  report_date: string | null;
  slug: string; timezone: string; sender_name: string; recipient_name: string | null; recipient_profile_id: string | null;
  sa_name: string | null; ra_name: string | null;
};
const SETTLE_SQL = `
  SELECT i.id, i.organisation_id, i.kind, i.status, i.sender_membership_id, i.recipient_membership_id, i.request_kind, i.payload, i.expires_at, i.decided_at, i.lease_until,
         i.decline_reason, to_char(i.report_date, 'YYYY-MM-DD') AS report_date, o.slug, o.timezone, sp.display_name AS sender_name, rp.display_name AS recipient_name, rm.user_id AS recipient_profile_id,
         sa.name AS sa_name, ra.name AS ra_name
  FROM assistant_items i
  JOIN organisations o ON o.id = i.organisation_id
  JOIN memberships sm ON sm.id = i.sender_membership_id JOIN profiles sp ON sp.id = sm.user_id
  LEFT JOIN memberships rm ON rm.id = i.recipient_membership_id LEFT JOIN profiles rp ON rp.id = rm.user_id
  LEFT JOIN assistant_profiles sa ON sa.membership_id = i.sender_membership_id
  LEFT JOIN assistant_profiles ra ON ra.membership_id = i.recipient_membership_id
  WHERE i.id = $1`;

/**
 * The recipient's request notification, closed once it no longer needs them (cancelled, expired): marked read and its
 * words say why, so the bell, the Notifications page and the notch stop offering Accept. Written as the recipient
 * (notifications are updated only by their recipient, migration 0005; as phase 4's closeAsk). Never throws.
 */
async function closeRequestNotice(recipientProfileId: string | null, recipientMembershipId: string | null, id: string, body: string): Promise<void> {
  if (!recipientProfileId || !recipientMembershipId) return;
  await withUser(recipientProfileId, (db) => db.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now()), body = $3 WHERE recipient_membership_id = $1 AND deduplication_key = $2`,
    [recipientMembershipId, `aitem:${id}`, clip(body, 300)])).catch(warn("closing a request notification"));
}

/** One row in someone's "What … did", written by the worker (as phase 4's logForSubject). */
async function logFor(db: Db, organisationId: string, membershipId: string, e: { summary: string; personal: string; outcome: "done" | "confirmed" | "failed"; source: "automatic" | "confirm"; href: string; itemId: string }) {
  await db.query(
    `INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES ($1, $2, 'assistant_request', $3, $4, $5, $6::jsonb)`,
    [organisationId, membershipId, clip(e.summary, 500), e.outcome, e.source, JSON.stringify({ href: e.href, personalSummary: clip(e.personal, 500), assistantItemId: e.itemId })]);
}

/** The sender's "Ada accepted: …" notification and activity row, for every way a request closes (C.5). */
async function tellSender(db: Db, r: SettleRow, how: "done" | "failed" | "declined" | "expired", o: { payload: RequestPayload | null; words?: string | null; reason?: string | null; sentForCheck?: boolean }) {
  const first = firstName(r.recipient_name ?? "Someone");
  const summary = o.payload ? requestLines(o.payload, { timeZone: r.timezone }).summary : "do something";
  const done = o.payload ? doneWords(o.payload, r.timezone, { sentForCheck: o.sentForCheck }) : "done";
  const title = how === "done" ? W.notifications.outcomeDoneTitle(first, done)
    : how === "failed" ? W.notifications.outcomeFailedTitle(first)
    : how === "declined" ? W.notifications.outcomeDeclinedTitle(first)
    : W.notifications.outcomeExpiredTitle(first);
  const body = how === "done" ? summary.charAt(0).toUpperCase() + summary.slice(1)
    : how === "failed" ? (o.words ?? W.results.error)
    : how === "declined" ? W.notifications.declinedBody(o.reason ?? null)
    : W.notifications.expiredBody(summary);
  const href = itemHref(r.slug, r.id);
  await notify(db, {
    organisationId: r.organisation_id, recipientMembershipId: r.sender_membership_id, type: NT.outcome,
    title: clip(title, 200), body: clip(body, 300), resourceType: "assistant_item", resourceId: r.id, href, dedupKey: `aitem.outcome:${r.id}`,
  });
  await logFor(db, r.organisation_id, r.sender_membership_id, { summary: W.activity.answeredSummary, personal: title, outcome: "done", source: "automatic", href, itemId: r.id });
}

/** A request past its time: expired, the sender told, the recipient's notification closed. */
async function expireRequest(r: SettleRow, now: Date): Promise<boolean> {
  const moved = await withWorker(async (db) => {
    const ok = await db.maybeOne(`UPDATE assistant_items SET status = 'expired', finished_at = now(), lease_until = NULL WHERE id = $1 AND status IN ('delivered', 'seen') AND expires_at <= $2::timestamptz RETURNING id`, [r.id, now.toISOString()]);
    if (!ok) return false;
    await audit(db, { organisationId: r.organisation_id, action: "assistant_item.expired", subjectType: "assistant_item", subjectId: r.id, subjectMembershipId: r.recipient_membership_id, metadata: { itemId: r.id, kind: r.kind, requestKind: r.request_kind } });
    await tellSender(db, r, "expired", { payload: payloadOrNull(r.payload) });
    return true;
  });
  if (moved) await closeRequestNotice(r.recipient_profile_id, r.recipient_membership_id, r.id, W.notifications.requestExpired);
  return moved;
}

/**
 * Accepted, but nothing recorded it done or failed (the web process stopped between the Accept and the result): failed
 * 'interrupted', never re-run (a second to-do would be worse than a question). The recipient can check.
 */
async function interruptRequest(r: SettleRow, now: Date): Promise<boolean> {
  const first = firstName(r.recipient_name ?? "Someone");
  const words = W.results.interrupted(first, r.request_kind ?? "add_todo");
  return withWorker(async (db) => {
    const ok = await db.maybeOne(
      `UPDATE assistant_items SET status = 'failed', result_code = 'interrupted', result = $2::jsonb, finished_at = now(), lease_until = NULL
       WHERE id = $1 AND status = 'accepted' AND decided_at < $3::timestamptz - make_interval(mins => $4) AND (lease_until IS NULL OR lease_until < $3::timestamptz) RETURNING id`,
      [r.id, JSON.stringify({ words }), now.toISOString(), L.stuckAcceptedMinutes]);
    if (!ok) return false;
    await audit(db, { organisationId: r.organisation_id, actorMembershipId: r.recipient_membership_id, action: "assistant_item.failed", subjectType: "assistant_item", subjectId: r.id, subjectMembershipId: r.recipient_membership_id, metadata: { itemId: r.id, requestKind: r.request_kind, code: "interrupted" } });
    await tellSender(db, r, "failed", { payload: payloadOrNull(r.payload), words });
    return true;
  });
}

/**
 * How long after the report's time a note still waiting is left for the reports being written (their jobs run at that
 * time; each marks the notes it carried "In the report": markNotesInReport). A note no report carried by then is "Not
 * sent": not a working day, nobody covering its author, the report or notes switched off, or a report written by a
 * worker that does not know notes (review, 8 October 2026: never "In the report" for a note nobody was given).
 */
export const NOTE_SETTLE_GRACE_MINUTES = 60;

/** A report note no report carried, NOTE_SETTLE_GRACE_MINUTES past the report's time: not sent (expired). */
async function settleNote(r: SettleRow, now: Date): Promise<"done" | "expired" | null> {
  return withWorker(async (db) => {
    const row = await db.maybeOne<{ status: "done" | "expired" }>(
      `UPDATE assistant_items i SET status = 'expired', finished_at = now()
       WHERE i.id = $1 AND i.status = 'delivered' AND i.kind = 'report_note' AND i.expires_at <= $2::timestamptz - make_interval(mins => $3) RETURNING i.status`,
      [r.id, now.toISOString(), NOTE_SETTLE_GRACE_MINUTES]);
    return row?.status ?? null;
  });
}

type Settled = "expired" | "interrupted" | "note_done" | "note_expired" | null;

/** Moves one item as far as its time says (expiry, a stuck Accept, a note's report). Safe to call any number of times. */
async function settleItem(id: string, now: Date): Promise<Settled> {
  const r = await withWorker((db) => db.maybeOne<SettleRow>(SETTLE_SQL, [id]));
  if (!r) return null;
  const t = now.getTime();
  if (r.kind === "request" && (r.status === "delivered" || r.status === "seen") && r.expires_at && Date.parse(r.expires_at) <= t) {
    return (await expireRequest(r, now)) ? "expired" : null;
  }
  if (r.kind === "request" && r.status === "accepted" && r.decided_at && Date.parse(r.decided_at) < t - L.stuckAcceptedMinutes * 60_000 && (!r.lease_until || Date.parse(r.lease_until) < t)) {
    return (await interruptRequest(r, now)) ? "interrupted" : null;
  }
  if (r.kind === "report_note" && r.status === "delivered" && r.expires_at && Date.parse(r.expires_at) + NOTE_SETTLE_GRACE_MINUTES * 60_000 <= t) {
    const s = await settleNote(r, now);
    return s === "done" ? "note_done" : s === "expired" ? "note_expired" : null;
  }
  return null;
}

const OVERDUE_SQL = `((i.kind = 'request' AND i.status IN ('delivered', 'seen') AND i.expires_at <= now())
  OR (i.kind = 'request' AND i.status = 'accepted' AND i.decided_at < now() - make_interval(mins => ${L.stuckAcceptedMinutes}) AND (i.lease_until IS NULL OR i.lease_until < now()))
  OR (i.kind = 'report_note' AND i.status = 'delivered' AND i.expires_at <= now() - make_interval(mins => ${NOTE_SETTLE_GRACE_MINUTES})))`;

/**
 * Settles overdue items this person can see before a read (at most 5), so an expired request reads as expired even
 * before the worker's sweep has run (as phase 4's settle). Never throws.
 */
async function settle(ctx: OrgContext, where: string, params: unknown[]): Promise<void> {
  try {
    const ids = await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return [];
      return (await db.query<{ id: string }>(
        `SELECT i.id FROM assistant_items i WHERE i.organisation_id = $1 AND (${where}) AND ${OVERDUE_SQL} ORDER BY i.created_at LIMIT 5`, [ctx.org.id, ...params])).map((r) => r.id);
    });
    const now = new Date();
    for (const id of ids) await settleItem(id, now).catch(warn(`settling ${id}`));
  } catch (err) {
    if (isMissingSchema(err)) { forget0043(); return; }
    warn("settling overdue items")(err);
  }
}

/**
 * One sweep (the worker's `assistant_item.sweep`, at most `limit` of each): open requests past their time expire (the
 * sender told, the recipient's notification closed), accepted requests stuck past five minutes fail 'interrupted', and
 * report notes past the report's time go in (done) or are not sent (expired). Never throws.
 */
export async function sweepAssistantItems(opts: { now?: Date; limit?: number } = {}): Promise<{ expired: number; interrupted: number; notesSettled: number }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(200, Math.max(1, Math.round(opts.limit ?? 50)));
  const out = { expired: 0, interrupted: 0, notesSettled: 0 };
  try {
    const rows = await withWorker(async (db) => {
      if (!(await schema0043Ready(db))) return null;
      const at = now.toISOString();
      return db.query<{ id: string }>(
        `(SELECT id, expires_at AS due FROM assistant_items WHERE kind = 'request' AND status IN ('delivered', 'seen') AND expires_at <= $1::timestamptz ORDER BY expires_at LIMIT $2)
         UNION ALL
         (SELECT id, decided_at AS due FROM assistant_items WHERE status = 'accepted' AND decided_at < $1::timestamptz - make_interval(mins => $3) AND (lease_until IS NULL OR lease_until < $1::timestamptz) ORDER BY decided_at LIMIT $2)
         UNION ALL
         (SELECT id, expires_at AS due FROM assistant_items WHERE kind = 'report_note' AND status = 'delivered' AND expires_at <= $1::timestamptz - make_interval(mins => $4) ORDER BY expires_at LIMIT $2)`,
        [at, limit, L.stuckAcceptedMinutes, NOTE_SETTLE_GRACE_MINUTES]);
    });
    if (!rows) return out;
    for (const r of rows) {
      const s = await settleItem(r.id, now).catch((err) => { warn(`sweeping ${r.id}`)(err); return null; });
      if (s === "expired") out.expired++;
      else if (s === "interrupted") out.interrupted++;
      else if (s === "note_done" || s === "note_expired") out.notesSettled++;
    }
  } catch (err) {
    if (isMissingSchema(err)) forget0043();
    else warn("sweeping items")(err);
  }
  return out;
}

// ---- Reading -------------------------------------------------------------------------------------------------------------

/** Whether this exists here yet (migration 0043), for the routes' `ready: false` answers. */
export async function assistantItemsReady(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0043Ready(db)); } catch (err) { if (isMissingSchema(err)) return false; throw err; }
}

/** One item, for its sender, its recipient, or (a report note) someone who may view its author's records; null otherwise. */
export async function getAssistantItem(ctx: OrgContext, id: string): Promise<AssistantItemView | null> {
  if (!isUuid(id)) return null;
  await settle(ctx, "i.id = $2", [id]);
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return null;
      return (await loadViews(db, ctx, "i.id = $3", [id], ""))[0] ?? null;
    }));
  } catch (err) {
    if (isMissingSchema(err)) return null;
    throw err;
  }
}

const WAITING_SQL = `(i.recipient_membership_id = $2 AND ((i.kind = 'request' AND i.status IN ('delivered', 'seen') AND i.expires_at > now()) OR (i.kind IN ('message', 'reply') AND i.status = 'delivered')))`;
const OPEN_SQL = `((i.kind = 'request' AND i.status IN ('delivered', 'seen', 'accepted')) OR (i.kind <> 'request' AND i.status = 'delivered'))`;

/**
 * A box of the inbox, as the person: `waiting` (open requests, unseen messages and replies brought to them; requests
 * first, oldest first), `sent` (what their assistant sent: messages, requests and report notes, newest first) or
 * `received` (messages, requests and replies brought to them, newest first). Filters: `kind`, `status` (open, done,
 * all), paged by `before` (newest-first boxes). Before 0043: `ready: false`, empty.
 */
export async function listAssistantItems(ctx: OrgContext, opts: { box: "waiting" | "sent" | "received"; kind?: AssistantItemKind | null; status?: "open" | "done" | "all"; before?: string | null; limit?: number }): Promise<{ ready: boolean; items: AssistantItemView[]; nextBefore: string | null }> {
  const limit = Math.min(L.listMax, Math.max(1, Math.round(Number.isFinite(opts.limit) ? (opts.limit as number) : 20)));
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before).toISOString() : null;
  const box = opts.box === "sent" || opts.box === "received" ? opts.box : "waiting";
  const mine = box === "sent" ? "i.sender_membership_id = $2" : "i.recipient_membership_id = $2";
  await settle(ctx, box === "sent" ? "i.sender_membership_id = $2" : "i.recipient_membership_id = $2", [ctx.membership.id]);
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return { ready: false, items: [], nextBefore: null };
      const params: unknown[] = [];
      const kinds = box === "sent" ? (opts.kind ? [opts.kind] : ["message", "request", "report_note"]) : (opts.kind ? [opts.kind] : ["message", "request", "reply"]);
      if (box !== "sent" && kinds.includes("report_note")) return { ready: true, items: [], nextBefore: null };
      params.push(kinds);
      let where = `${box === "waiting" ? WAITING_SQL : mine} AND i.kind = ANY($3::text[])`;
      if (opts.status === "open") where += ` AND ${OPEN_SQL}`;
      if (opts.status === "done") where += ` AND NOT ${OPEN_SQL}`;
      if (box === "waiting") {
        const items = await loadViews(db, ctx, where, params, `ORDER BY (i.kind <> 'request'), i.created_at, i.id LIMIT ${limit}`);
        return { ready: true, items, nextBefore: null };
      }
      if (before) { params.push(before); where += ` AND i.created_at < $${params.length + 2}::timestamptz`; }
      const rows = await loadViews(db, ctx, where, params, `ORDER BY i.created_at DESC, i.id DESC LIMIT ${limit + 1}`);
      const items = rows.slice(0, limit);
      return { ready: true, items, nextBefore: rows.length > limit ? items[items.length - 1].createdAt : null };
    }));
  } catch (err) {
    if (isMissingSchema(err)) return { ready: false, items: [], nextBefore: null };
    throw err;
  }
}

/** What waits for this person (open requests, unseen messages and replies to them): requests first, oldest first, at most 10; [] before 0043. */
export async function waitingItems(ctx: OrgContext): Promise<AssistantItemView[]> {
  const r = await listAssistantItems(ctx, { box: "waiting", limit: L.waitingMax });
  return r.items;
}

// ---- The recipient's steps ------------------------------------------------------------------------------------------------

async function viewOrThrow(ctx: OrgContext, id: string): Promise<AssistantItemView> {
  const v = await getAssistantItem(ctx, id);
  if (!v) throw notHere();
  return v;
}

/** "Mark as seen" (or opening it): the recipient alone (definer app_assistant_item_seen); their notification is read. */
export async function markItemSeen(ctx: OrgContext, id: string): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx, W.steps.impersonatedSeen);
  await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_assistant_item_seen($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `aitem:${id}`]);
  }));
  return viewOrThrow(ctx, id);
}

/**
 * One line back to the person who passed on a message: the recipient of a `message` alone, at most once (409
 * ALREADY_REPLIED), 1 to 280 characters on one line. Inserted as the recipient (row-level security checks the message);
 * the message is marked seen; the original sender is notified. Returns the message, with its reply.
 */
export async function replyToItem(ctx: OrgContext, id: string, body: string): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx, W.steps.impersonatedReply);
  const text = oneLine(body);
  if (!text) throw invalid(W.steps.replyEmpty, { body: [W.steps.replyEmpty] });
  if (text.length > L.replyMax) throw invalid(W.steps.replyTooLong, { body: [W.steps.replyTooLong] });
  await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const parent = await db.maybeOne<{ id: string; sender_membership_id: string; kind: string }>(
      // No FOR UPDATE: under row-level security it would also apply the worker-only UPDATE policy and hide the row. The
      // unique index on a message's reply keeps it to one.
      `SELECT id, sender_membership_id, kind FROM assistant_items WHERE id = $1 AND organisation_id = $2 AND recipient_membership_id = $3`, [id, ctx.org.id, ctx.membership.id]);
    if (!parent || parent.kind !== "message") throw notHere();
    if (await db.maybeOne(`SELECT 1 FROM assistant_items WHERE parent_id = $1 AND kind = 'reply'`, [id])) throw conflict("ALREADY_REPLIED", W.steps.alreadyReplied);
    const sender = await db.maybeOne<Member>(`${MEMBER_SQL} AND m.id = $2`, [ctx.org.id, parent.sender_membership_id]);
    const no = await refusalOf(db, ctx, sender, "reply");
    if (no) throw refusalError(no);
    let reply: { id: string };
    try {
      await db.query(`SAVEPOINT aitem_reply`);
      reply = await db.one<{ id: string }>(
        `INSERT INTO assistant_items(organisation_id, kind, sender_membership_id, recipient_membership_id, parent_id, body) VALUES ($1, 'reply', $2, $3, $4, $5) RETURNING id`,
        [ctx.org.id, ctx.membership.id, parent.sender_membership_id, id, text]);
      await db.query(`RELEASE SAVEPOINT aitem_reply`);
    } catch (err) {
      await db.query(`ROLLBACK TO SAVEPOINT aitem_reply`).catch(() => undefined);
      if (isUniqueViolation(err)) throw conflict("ALREADY_REPLIED", W.steps.alreadyReplied);
      throw err;
    }
    await db.query(`SELECT app_assistant_item_seen($1)`, [id]);
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `aitem:${id}`]);
    await notify(db, {
      organisationId: ctx.org.id, recipientMembershipId: parent.sender_membership_id, type: NT.reply,
      title: W.notifications.replyTitle(meFirst(ctx)), body: W.notifications.replyBody(text),
      resourceType: "assistant_item", resourceId: reply.id, href: itemHref(ctx.org.slug, reply.id), dedupKey: `aitem:${reply.id}`,
    });
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant_item.replied", subjectType: "assistant_item", subjectId: reply.id, subjectMembershipId: parent.sender_membership_id, metadata: { itemId: reply.id, parentId: id } });
  }));
  return viewOrThrow(ctx, id);
}

/** The definer's word for accept or decline, as the error the routes answer. */
function decideError(word: string): AppError | null {
  switch (word) {
    case "ok": return null;
    case "not_found": return notHere();
    case "closed": return conflict("ITEM_CLOSED", W.steps.closed);
    case "expired": return conflict("ITEM_EXPIRED", W.steps.expired);
    case "too_long": return invalid(W.steps.reasonTooLong, { reason: [W.steps.reasonTooLong] });
    default: return invalid(W.steps.notHere);
  }
}

/** What the recipient reads in their own activity after accepting ("Added “Review pricing” to your to-dos for Olu"). */
function didWords(p: RequestPayload, senderFirst: string, tz: string, sentForCheck = false): string {
  switch (p.kind) {
    case "add_todo": return `Added “${clip(p.title, 80)}” to your to-dos for ${senderFirst}`;
    case "set_reminder": return `Set a reminder for ${dateTimeLabel(p.at, tz)} for ${senderFirst}`;
    case "task_status": return sentForCheck ? `Sent “${clip(p.taskTitle, 80)}” for a check for ${senderFirst}` : `Moved “${clip(p.taskTitle, 80)}” to ${STATUS_WORDS[p.to]} for ${senderFirst}`;
    case "task_comment": return `Commented on “${clip(p.taskTitle, 80)}” for ${senderFirst}`;
  }
}

/** The worker records what happened to an accepted request (guarded on 'accepted'), tells the sender and logs both sides. */
async function finishAccepted(id: string, outcome: ExecOutcome, payload: RequestPayload | null): Promise<void> {
  await withWorker(async (db) => {
    const r = await db.maybeOne<SettleRow>(SETTLE_SQL, [id]);
    if (!r) return;
    const tz = r.timezone;
    const donePayload = outcome.code === "done" ? payload : null;
    const done = !!donePayload;
    const sentForCheck = !!outcome.refs.sentForCheck;
    const words = donePayload ? doneWords(donePayload, tz, { sentForCheck }) : outcome.words;
    const moved = await db.maybeOne(
      `UPDATE assistant_items SET status = $2, result_code = $3, result = $4::jsonb, finished_at = now(), lease_until = NULL WHERE id = $1 AND status = 'accepted' RETURNING id`,
      [id, done ? "done" : "failed", done ? "done" : outcome.code === "done" ? "invalid" : outcome.code, JSON.stringify({ words, ...outcome.refs })]);
    if (!moved) return;
    await audit(db, {
      organisationId: r.organisation_id, actorMembershipId: r.recipient_membership_id, action: done ? "assistant_item.done" : "assistant_item.failed",
      subjectType: "assistant_item", subjectId: id, subjectMembershipId: r.recipient_membership_id, metadata: { itemId: id, requestKind: r.request_kind, code: done ? "done" : outcome.code },
    });
    await tellSender(db, r, done ? "done" : "failed", { payload, words, sentForCheck });
    const senderFirst = firstName(r.sender_name);
    const href = itemHref(r.slug, id);
    if (r.recipient_membership_id) {
      await logFor(db, r.organisation_id, r.recipient_membership_id, donePayload
        ? { summary: W.activity.didRequestSummary, personal: didWords(donePayload, senderFirst, tz, sentForCheck), outcome: "confirmed", source: "confirm", href, itemId: id }
        : { summary: W.activity.failedRequestSummary, personal: `Couldn't do ${senderFirst}'s request: ${words}`, outcome: "failed", source: "confirm", href, itemId: id });
    }
  });
}

/**
 * Accept (C.2): the recipient alone, never while someone else is signed in as them. The definer moves it to 'accepted'
 * (a two-minute lease); then the payload, and only the payload, is done AS THE RECIPIENT through the same services their
 * buttons use (assistant-request-exec); the worker records done or failed, the sender is told, both activity logs say
 * it. A payload that does not read back exactly (kind, task) fails 'invalid' and runs nothing. Returns the item: 200
 * even when it could not be done (its status says so).
 */
export async function acceptItem(ctx: OrgContext, id: string): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx, W.steps.impersonatedAccept);
  const row = await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_assistant_item_decide($1, 'accept', NULL) AS r`, [id]);
    const e = decideError(r.r);
    if (e) throw e;
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `aitem:${id}`]);
    return db.one<{ request_kind: string | null; payload: unknown; task_id: string | null; sender_name: string }>(
      `SELECT i.request_kind, i.payload, i.task_id, p.display_name AS sender_name
       FROM assistant_items i JOIN memberships m ON m.id = i.sender_membership_id JOIN profiles p ON p.id = m.user_id WHERE i.id = $1`, [id]);
  }));
  const payload = payloadOrNull(row.payload);
  const taskOf = (p: RequestPayload) => ("taskId" in p ? p.taskId : null);
  const readable = payload && payload.kind === row.request_kind && (taskOf(payload) ?? null) === (row.task_id ? row.task_id.toLowerCase() : null);
  const outcome: ExecOutcome = readable
    ? await executeRequest(ctx, payload, { senderFirst: firstName(row.sender_name) })
    : { code: "invalid", words: W.results.invalid, refs: {} };
  await finishAccepted(id, outcome, readable ? payload : null).catch(warn(`finishing ${id}`));
  return viewOrThrow(ctx, id);
}

/** Decline (C.2): the recipient alone, with an optional reason (≤ 280); the sender is told (the reason quoted). */
export async function declineItem(ctx: OrgContext, id: string, reason?: string | null): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  notWhileImpersonated(ctx, W.steps.impersonatedDecline);
  const clean = oneLine(reason) || null;
  if (clean && clean.length > L.declineReasonMax) throw invalid(W.steps.reasonTooLong, { reason: [W.steps.reasonTooLong] });
  await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_assistant_item_decide($1, 'decline', $2) AS r`, [id, clean]);
    const e = decideError(r.r);
    if (e) throw e;
    await db.query(`UPDATE notifications SET read_at = now() WHERE recipient_membership_id = $1 AND deduplication_key = $2 AND read_at IS NULL`, [ctx.membership.id, `aitem:${id}`]);
  }));
  await withWorker(async (db) => {
    const r = await db.maybeOne<SettleRow>(SETTLE_SQL, [id]);
    if (!r || r.status !== "declined") return;
    await audit(db, { organisationId: r.organisation_id, actorMembershipId: r.recipient_membership_id, action: "assistant_item.declined", subjectType: "assistant_item", subjectId: id, subjectMembershipId: r.recipient_membership_id, metadata: { itemId: id, requestKind: r.request_kind, withReason: !!r.decline_reason } });
    await tellSender(db, r, "declined", { payload: payloadOrNull(r.payload), reason: r.decline_reason });
  }).catch(warn(`telling the sender about ${id}`));
  return viewOrThrow(ctx, id);
}

// ---- The sender's steps -------------------------------------------------------------------------------------------------

/** Cancel (C.3): the sender of a request alone, while it is open; the recipient's notification is closed and says so. */
export async function cancelItem(ctx: OrgContext, id: string): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  const row = await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const r = await db.one<{ r: string }>(`SELECT app_assistant_item_cancel($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    if (r.r === "closed") throw conflict("ITEM_CLOSED", W.steps.closed);
    const row = await db.one<{ recipient_membership_id: string; request_kind: string | null }>(`SELECT recipient_membership_id, request_kind FROM assistant_items WHERE id = $1`, [id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant_item.cancelled", subjectType: "assistant_item", subjectId: id, subjectMembershipId: row.recipient_membership_id, metadata: { itemId: id, requestKind: row.request_kind } });
    return row;
  }));
  const who = await withWorker((db) => db.maybeOne<{ user_id: string }>(`SELECT user_id FROM memberships WHERE id = $1`, [row.recipient_membership_id])).catch(() => null);
  await closeRequestNotice(who?.user_id ?? null, row.recipient_membership_id, id, W.notifications.requestCancelled(meFirst(ctx)));
  return viewOrThrow(ctx, id);
}

/** Whether a report for the note's day, written after the note and for someone who may read it, already exists (worker read: a boolean). */
async function noteInWrittenReport(n: { organisation_id: string; report_date: string; sender_membership_id: string; created_at: string }): Promise<boolean> {
  const r = await withWorker((w) => w.maybeOne(
    `SELECT 1 FROM brenda_report_log l JOIN memberships r ON r.id = l.membership_id
     WHERE l.organisation_id = $1 AND l.local_date = $2::date AND l.written_at IS NOT NULL AND l.written_at >= $4::timestamptz
       AND (l.membership_id = $3 OR r.role IN ('owner', 'hr')
            OR EXISTS (SELECT 1 FROM team_members mgr JOIN team_members tm ON tm.team_id = mgr.team_id
                       WHERE mgr.membership_id = l.membership_id AND mgr.is_manager AND tm.membership_id = $3))
     LIMIT 1`, [n.organisation_id, n.report_date, n.sender_membership_id, n.created_at]));
  return !!r;
}

/** Withdraw (C.3): the author of a report note alone, before the report is written (409 TOO_LATE after). */
export async function withdrawReportNote(ctx: OrgContext, id: string): Promise<AssistantItemView> {
  if (!isUuid(id)) throw notHere();
  await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    // Too late once the report's time has passed as it is set NOW (it may have moved earlier since the note was added),
    // or once any report holding it has been written (a lead's report asked for early; the note is then "In the
    // report"). Migration 0044's definer checks the same (review, 8 October 2026).
    const note = await db.maybeOne<{ status: string; past: boolean; organisation_id: string; report_date: string; sender_membership_id: string; created_at: string }>(
      `SELECT status, now() >= app_report_cutoff(organisation_id, report_date) AS past, organisation_id, to_char(report_date, 'YYYY-MM-DD') AS report_date,
              sender_membership_id, created_at
       FROM assistant_items WHERE id = $1 AND kind = 'report_note' AND sender_membership_id = $2`, [id, ctx.membership.id]);
    if (note && (note.status === "done" || (note.status === "delivered" && (note.past || (await noteInWrittenReport(note)))))) throw conflict("TOO_LATE", W.steps.tooLate);
    const r = await db.one<{ r: string }>(`SELECT app_assistant_item_withdraw($1) AS r`, [id]);
    if (r.r === "not_found") throw notHere();
    if (r.r === "too_late") throw conflict("TOO_LATE", W.steps.tooLate);
    if (r.r === "closed") throw conflict("ITEM_CLOSED", W.steps.closed);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant_item.withdrawn", subjectType: "assistant_item", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { itemId: id, kind: "report_note" } });
  }));
  return viewOrThrow(ctx, id);
}

// ---- Mutes and the person's switch ----------------------------------------------------------------------------------------

/** The colleagues whose assistants this person stopped (theirs alone to read, row-level security). */
export async function listMutes(ctx: OrgContext): Promise<{ ready: boolean; mutes: { membershipId: string; name: string; assistant: AssistantProfile; mutedAt: string }[] }> {
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return { ready: false, mutes: [] };
      const rows = await db.query<{ id: string; name: string; a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null; muted_at: string }>(
        `SELECT x.sender_membership_id AS id, p.display_name AS name, ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes, x.updated_at AS muted_at
         FROM assistant_item_mutes x JOIN memberships m ON m.id = x.sender_membership_id JOIN profiles p ON p.id = m.user_id
         LEFT JOIN assistant_profiles ap ON ap.membership_id = x.sender_membership_id
         WHERE x.organisation_id = $1 AND x.recipient_membership_id = $2 AND x.muted ORDER BY p.display_name`, [ctx.org.id, ctx.membership.id]);
      return { ready: true, mutes: rows.map((r) => ({ membershipId: r.id, name: r.name, assistant: toProfile({ name: r.a_name, colour: r.a_colour, visor: r.a_visor, eyes: r.a_eyes }), mutedAt: r.muted_at })) };
    }));
  } catch (err) {
    if (isMissingSchema(err)) return { ready: false, mutes: [] };
    throw err;
  }
}

/**
 * Stop (or allow again) new messages and requests from one colleague's assistant, and their tags of this person's
 * assistant in Messages. Replies to the person's own messages still arrive; items already delivered stay. Unmuting sets
 * `muted` false (no DELETE). Not logged: a personal preference. Refused while someone else is signed in as the person.
 */
export async function setMute(ctx: OrgContext, senderMembershipId: string, muted: boolean): Promise<{ muted: boolean }> {
  notWhileImpersonated(ctx, W.steps.impersonatedMute);
  if (!isUuid(senderMembershipId)) throw invalid(W.steps.muteNotMember, { senderMembershipId: [W.steps.muteNotMember] });
  if (senderMembershipId.toLowerCase() === ctx.membership.id.toLowerCase()) throw invalid(W.steps.muteSelf, { senderMembershipId: [W.steps.muteSelf] });
  return retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const m = await db.maybeOne(`SELECT 1 FROM memberships WHERE id = $1 AND organisation_id = $2`, [senderMembershipId, ctx.org.id]);
    if (!m) throw notFound(W.steps.muteNotMember);
    const r = await db.one<{ muted: boolean }>(
      `INSERT INTO assistant_item_mutes(organisation_id, recipient_membership_id, sender_membership_id, muted) VALUES ($1, $2, $3, $4)
       ON CONFLICT (recipient_membership_id, sender_membership_id) DO UPDATE SET muted = $4 RETURNING muted`, [ctx.org.id, ctx.membership.id, senderMembershipId, !!muted]);
    return { muted: r.muted };
  }));
}

/** "Let people tag {name} in Messages" (assistant_profiles.allow_thread_replies, on by default). */
export async function assistantTalkPreferences(ctx: OrgContext): Promise<{ ready: boolean; allowThreadReplies: boolean }> {
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return { ready: false, allowThreadReplies: true };
      const r = await db.maybeOne<{ allow: boolean }>(`SELECT allow_thread_replies AS allow FROM assistant_profiles WHERE membership_id = $1`, [ctx.membership.id]);
      return { ready: true, allowThreadReplies: r?.allow ?? true };
    }));
  } catch (err) {
    if (isMissingSchema(err)) return { ready: false, allowThreadReplies: true };
    throw err;
  }
}

/** Saved on its own, at once; a person with no profile row yet gets one with the look as it is. Not logged. */
export async function saveAssistantTalkPreferences(ctx: OrgContext, p: { allowThreadReplies: boolean }): Promise<{ allowThreadReplies: boolean }> {
  notWhileImpersonated(ctx, W.steps.impersonatedPreferences);
  return retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    const r = await db.one<{ allow: boolean }>(
      `INSERT INTO assistant_profiles(membership_id, organisation_id, allow_thread_replies, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (membership_id) DO UPDATE SET allow_thread_replies = $3, updated_at = now() RETURNING allow_thread_replies AS allow`,
      [ctx.membership.id, ctx.org.id, !!p.allowThreadReplies]);
    return { allowThreadReplies: r.allow };
  }));
}

// ---- Report notes ---------------------------------------------------------------------------------------------------------

/** "Let people add notes to the team report" (members may read it). `{ ready: false, enabled: true }` before 0043. */
export async function reportNoteSettings(db: Db, orgId: string): Promise<{ ready: boolean; enabled: boolean }> {
  if (!(await schema0043Ready(db))) return { ready: false, enabled: true };
  const r = await db.maybeOne<{ on: boolean }>(`SELECT report_notes AS on FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, enabled: r?.on ?? true };
}

/** Owners and HR, under the same lock as the organisation's other Brenda settings; logged in Settings → Brenda's log. */
export async function saveReportNoteSettings(ctx: OrgContext, p: { enabled: boolean }): Promise<{ ready: true; enabled: boolean }> {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden(W.steps.settingsForbidden);
  const enabled = !!p.enabled;
  return retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0043Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, report_notes, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organisation_id) DO UPDATE SET report_notes = $2, updated_by = $3, updated_at = now()`, [ctx.org.id, enabled, ctx.membership.id]);
    await logAction(db, ctx, { tool: "settings", outcome: "done", source: "confirm", summary: `Notes for the team report: ${enabled ? "on" : "off"}` });
    return { ready: true as const, enabled };
  }));
}

/**
 * Today's notes for a report, as its RECIPIENT reads them (row-level security: their own, and those of people whose
 * records they may view: their teams for a lead, everyone for the owner and HR), delivered or in the report, oldest
 * first. [] while notes are switched off, before 0043 and on any error (the report never fails because of its notes).
 */
export async function reportNotesFor(ctx: OrgContext, localDate: string): Promise<{ id: string; membershipId: string; name: string; assistantName: string; body: string; at: string }[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return [];
  try {
    return await retryWithout0043(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0043Ready(db))) return [];
      // Notes switched off before the report: none go in (at the report's time they settle as "Not sent").
      if (!(await reportNoteSettings(db, ctx.org.id)).enabled) return [];
      const rows = await db.query<{ id: string; membership_id: string; name: string; a_name: string | null; body: string; created_at: string }>(
        `SELECT i.id, i.sender_membership_id AS membership_id, p.display_name AS name, ap.name AS a_name, i.body, i.created_at
         FROM assistant_items i JOIN memberships m ON m.id = i.sender_membership_id JOIN profiles p ON p.id = m.user_id
         LEFT JOIN assistant_profiles ap ON ap.membership_id = i.sender_membership_id
         WHERE i.organisation_id = $1 AND i.kind = 'report_note' AND i.report_date = $2::date AND i.status IN ('delivered', 'done')
         ORDER BY i.created_at, i.id`, [ctx.org.id, localDate]);
      return rows.map((r) => ({ id: r.id, membershipId: r.membership_id, name: r.name, assistantName: toProfile({ name: r.a_name }).name, body: r.body, at: r.created_at }));
    }));
  } catch (err) {
    if (isMissingSchema(err)) forget0043();
    else warn("reading report notes")(err);
    return [];
  }
}

// ---- The notch ------------------------------------------------------------------------------------------------------------

/** What the notch shows (G.1): what waits for the person, and what came back to them in the last 24 hours. */
export async function assistantItemsForDesktop(ctx: OrgContext): Promise<DesktopAssistantItems> {
  const none: DesktopAssistantItems = { ready: false, waiting: [], updates: [] };
  try {
    const ready = await assistantItemsReady(ctx);
    if (!ready) return none;
    const waiting = (await waitingItems(ctx)).slice(0, 5);
    const updates = await retryWithout0043(() => withUser(ctx.user.profileId, (db) => loadViews(db, ctx,
      `((i.sender_membership_id = $2 AND i.kind = 'request' AND i.status IN ('declined', 'done', 'failed', 'expired'))
        OR (i.recipient_membership_id = $2 AND i.kind = 'reply'))
       AND COALESCE(i.finished_at, i.created_at) > now() - interval '24 hours'`, [], "ORDER BY COALESCE(i.finished_at, i.created_at) DESC, i.id DESC LIMIT 5")));
    return {
      ready: true,
      waiting: waiting.filter((v) => v.kind !== "report_note").map((v) => ({
        id: v.id, kind: v.kind as "message" | "request" | "reply",
        title: v.kind === "message" ? W.notch.messageTitle(v.sender.firstName, v.sender.assistant.name)
          : v.kind === "request" ? W.notch.requestTitle(v.sender.firstName, v.sender.assistant.name)
          : W.notch.replyTitle(v.sender.firstName),
        body: v.kind === "request" ? null : v.body,
        lines: v.request?.lines ?? [],
        note: v.kind === "request" ? v.body : null,
        sender: { name: v.sender.name, assistant: forNotch(v.sender.assistant) },
        createdAt: v.createdAt, expiresAt: v.request?.expiresAt ?? null, canReply: v.canReply, tidied: v.tidied, href: v.href,
      })),
      updates: updates.map((v) => {
        const other = v.kind === "reply" ? v.sender : (v.recipient ?? v.sender);
        const first = other.firstName;
        const title = v.kind === "reply" ? W.notifications.replyTitle(first)
          : v.status === "done" ? W.notifications.outcomeDoneTitle(first, v.request ? doneWords(v.request.payload, ctx.org.timezone, { sentForCheck: v.result?.sentForCheck }) : "done")
          : v.status === "failed" ? W.notifications.outcomeFailedTitle(first)
          : v.status === "declined" ? W.notifications.outcomeDeclinedTitle(first)
          : W.notifications.outcomeExpiredTitle(first);
        const body = v.kind === "reply" ? v.body
          : v.status === "failed" ? v.result?.words ?? null
          : v.status === "declined" ? W.notifications.declinedBody(v.declineReason)
          : v.request ? v.request.summary.charAt(0).toUpperCase() + v.request.summary.slice(1) : null;
        return {
          id: v.id, kind: v.kind as "request" | "reply", title, body, status: v.status,
          other: { name: other.name, assistant: forNotch(other.assistant) }, at: v.finishedAt ?? v.createdAt, href: v.href,
        };
      }),
    };
  } catch (err) {
    if (isMissingSchema(err)) { forget0043(); return none; }
    throw err;
  }
}

/** Re-exported for callers that need the item words with the service. */
export { ASSISTANT_TALK_NOT_READY, assistantOf };
