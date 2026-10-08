/**
 * Undo (owner decision, 8 October 2026: act without asking). When the person's assistant acts without a Confirm press
 * (they chose "Act without asking", or the action was one it always does at once in their own chat), the done line
 * offers Undo for UNDO_WINDOW_MINUTES. This is that Undo.
 *
 * The rule (act-mode contract, D.1): an Undo is the person acting again as themself (the request's own `orgContext`; the
 * token is bound to the organisation and the membership), through the same services the buttons use, with exactly
 * their permissions, at most once (`idempotency_keys (actor_user_id, 'brenda-undo', sha256(token))`), within the window
 * (the token's expiry). It refuses, in words, when the thing has moved on since (seen, answered, started, changed, the
 * report written). Nothing is deleted: everything is archived, withdrawn, cancelled or put back. Logged in the person's
 * log as tool 'undo' (a PRIVATE_TOOL: owners and HR read "Undid a message", the person "Undid: Sent Ben …").
 *
 * The token says WHAT to undo (ids, versions, the fields as they were), signed by the server when the action ran; the
 * words shown after an Undo name people from the services' own views, never from the token. Undoing never needs the
 * plan (a workspace that lost the assistant can still take back what it did).
 */
import { withSystem, withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden } from "@/server/lib/errors";
import { randomToken, sha256, signPayload, verifySignedPayload } from "@/server/lib/crypto";
import { todayLocal } from "@/server/lib/time";
import { cancelReminder, recordAction, restoreReminder } from "@/server/services/brenda";
import { setConversationPrefs, withdrawMessage } from "@/server/services/messaging";
import { setMyPresence } from "@/server/services/profile";
import { setDailyPlan, updateTask } from "@/server/services/tasks";
import { archiveDoc } from "@/server/services/docs";
import { cancelFollowUp } from "@/server/services/follow-ups";
import { cancelItem, getAssistantItem, unsendAssistantMessage, withdrawReportNote } from "@/server/services/assistant-items";
import { PRESENCE, isPresence, type Presence } from "@/lib/presence";
import { firstName } from "@/lib/follow-ups";
import { UNDO_WINDOW_MINUTES, type UndoOffer } from "@/lib/act-mode";

// ---- Types (the contract, D.2) ----------------------------------------------------------------------------------------

/** A task's fields as they were before the change (only those the change touched). `reason`: the old blocked reason. */
export type TaskBefore = {
  title?: string; expectedOutput?: string; dueAt?: string | null; estimateMinutes?: number | null;
  priority?: "low" | "normal" | "high" | "urgent"; status?: "todo" | "in_progress" | "blocked"; reason?: string | null; progressPercent?: number;
};
export type UndoSpec =
  | { kind: "todo_created"; tasks: { id: string; version: number }[] }
  | { kind: "task_changed"; taskId: string; version: number; before: TaskBefore }
  | { kind: "task_assigned"; taskId: string; version: number; previousAssignee: string }
  | { kind: "reminder_set"; reminderId: string }
  | { kind: "reminder_cancelled"; reminderId: string }
  | { kind: "message_sent"; messageId: string; conversationId: string }
  | { kind: "conversations_read"; conversationIds: string[] }
  // `set`, `planned`, `updatedAt` (review, 8 October 2026): what the action left, so Undo refuses once it moved on since
  // (UNDO_CHANGED). Optional: a token signed before they existed still undoes as before.
  | { kind: "status_set"; previous: Presence; set?: Presence }
  | { kind: "day_planned"; localDate: string; previous: string[]; planned?: string[] }
  | { kind: "doc_created"; docId: string; updatedAt?: string }
  | { kind: "follow_up_asked"; batchId: string; followUpIds: string[] }
  | { kind: "assistant_message"; itemId: string }
  | { kind: "assistant_request"; itemId: string }
  | { kind: "report_note"; itemId: string };
export type UndoKind = UndoSpec["kind"];
export const UNDO_KINDS = ["todo_created", "task_changed", "task_assigned", "reminder_set", "reminder_cancelled", "message_sent", "conversations_read",
  "status_set", "day_planned", "doc_created", "follow_up_asked", "assistant_message", "assistant_request", "report_note"] as const satisfies readonly UndoKind[];

/** The longest Undo token the route takes (its body cap is a little more). An offer that would be longer is not made. */
export const UNDO_TOKEN_MAX = 16_000;
const LABEL_MAX = 300;
const TOKEN_KIND = "brenda-undo";
const CLAIM_ROUTE = "brenda-undo";

type UndoPayload = { k: string; o: string; m: string; s: unknown; l: unknown; n: string; a?: true; exp: number };

// ---- The words (D.3) --------------------------------------------------------------------------------------------------

export const UNDO_WORDS = {
  invalid: "That undo is not valid.",
  someoneElses: "That belongs to someone else.",
  expired: `It's been more than ${UNDO_WINDOW_MINUTES} minutes, so it can't be undone here.`,
  already: "That was already undone.",
  todoChanged: "It has changed since (started or edited), so it stays.",
  taskChanged: "Someone changed it since, so it stays. Open the task to change it back.",
  statusChanged: "Your status changed since, so it stays.",
  dayChanged: "Today's list changed since, so it stays.",
  docChanged: "It has been changed since, so it stays. Archive it from the document if you no longer want it.",
  reminderWentOff: "That reminder already went off.",
  messageGone: "That message was already withdrawn.",
  otherDay: "That was another day's list.",
  docGone: "That document is already gone.",
  allAnswered: "Already answered: there is nothing left to cancel.",
  seenIt: (first: string) => `${first} has already seen it, so it stays.`,
  answeredIt: (first: string) => `${first} has already answered it.`,
  reportWritten: "Today's report is already written.",
  noteGone: "That note was already withdrawn.",
  done: {
    todos: (n: number) => (n === 1 ? "Removed the to-do" : `Removed ${n} to-dos`),
    toldAbout: (names: string[], n: number) => names.length === 1
      ? `${names[0]} was already told about ${n === 1 ? "it" : "them"}.`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} were already told about them.`,
    task: "Put the task back as it was",
    assigned: (first: string) => `Gave the task back to ${first}`,
    reminderCancelled: "Cancelled the reminder",
    reminderBack: "Put the reminder back",
    message: "Withdrew the message. They may have seen it already.",
    unread: "Marked them as unread again",
    status: (label: string) => `Status back to ${label}`,
    day: "Put today's list back as it was",
    doc: "Removed the document",
    followUp: "Cancelled the follow-up",
    someAnswered: (n: number) => `${n} had already been answered.`,
    assistantMessage: (first: string, assistant: string) => `Withdrew your message to ${first}'s ${assistant}`,
    request: (first: string) => `Cancelled your request to ${first}`,
    note: "Withdrew your note from today's team report",
  },
  /** What owners and HR read in Settings → Brenda's log (the person reads "Undid: <the done line>"). */
  logged: {
    todo_created: "Undid a to-do", task_changed: "Undid a task change", task_assigned: "Undid an assignment", reminder_set: "Undid a reminder",
    reminder_cancelled: "Undid a cancelled reminder", message_sent: "Undid a message", conversations_read: "Undid mark as read",
    status_set: "Undid a status change", day_planned: "Undid a day plan", doc_created: "Undid a document", follow_up_asked: "Undid a follow-up",
    assistant_message: "Undid a message to an assistant", assistant_request: "Undid a request", report_note: "Undid a report note",
  } satisfies Record<UndoKind, string>,
  personal: (label: string) => `Undid: ${label}`,
} as const;

const invalidUndo = () => new AppError(400, "INVALID", UNDO_WORDS.invalid);
const changed = (words: string) => conflict("UNDO_CHANGED", words);
const tooLate = (words: string) => conflict("UNDO_TOO_LATE", words);
const expiredUndo = () => conflict("UNDO_EXPIRED", UNDO_WORDS.expired);
/** Two sentences joined: "Removed the to-do" + "Ben was already told about it." */
const join = (a: string, b: string | null) => (b ? `${a.replace(/[.\s]+$/, "")}. ${b}` : a);

// ---- The token ----------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const uuids = (v: unknown, max = 100): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(isUuid);
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["todo", "in_progress", "blocked"];
const optStr = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.trim().length > 0 && v.length <= max);
const optNullable = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || v === null || ok(v);

function isTaskBefore(b: unknown): b is TaskBefore {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const t = b as Record<string, unknown>;
  const keys = ["title", "expectedOutput", "dueAt", "estimateMinutes", "priority", "status", "reason", "progressPercent"];
  if (Object.keys(t).some((k) => !keys.includes(k))) return false;
  return optStr(t.title, 200) && optStr(t.expectedOutput, 4000)
    && optNullable(t.dueAt, (x) => typeof x === "string" && !Number.isNaN(Date.parse(x)))
    && optNullable(t.estimateMinutes, (x) => typeof x === "number" && Number.isInteger(x) && x > 0)
    && (t.priority === undefined || PRIORITIES.includes(t.priority as string))
    && (t.status === undefined || STATUSES.includes(t.status as string))
    && optNullable(t.reason, (x) => typeof x === "string" && x.length <= 2000)
    && (t.progressPercent === undefined || (typeof t.progressPercent === "number" && Number.isInteger(t.progressPercent) && t.progressPercent >= 0 && t.progressPercent <= 100));
}

/** The spec as signed, checked strictly (the token is ours, but it is read back from a client). */
export function isUndoSpec(v: unknown): v is UndoSpec {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  switch (s.kind) {
    case "todo_created": return Array.isArray(s.tasks) && s.tasks.length > 0 && s.tasks.length <= 50
      && s.tasks.every((t) => !!t && typeof t === "object" && isUuid((t as Record<string, unknown>).id) && isVersion((t as Record<string, unknown>).version));
    case "task_changed": return isUuid(s.taskId) && isVersion(s.version) && isTaskBefore(s.before) && Object.keys(s.before as object).length > 0;
    case "task_assigned": return isUuid(s.taskId) && isVersion(s.version) && isUuid(s.previousAssignee);
    case "reminder_set": case "reminder_cancelled": return isUuid(s.reminderId);
    case "message_sent": return isUuid(s.messageId) && isUuid(s.conversationId);
    case "conversations_read": return uuids(s.conversationIds, 50);
    case "status_set": return isPresence(s.previous) && (s.set === undefined || isPresence(s.set));
    case "day_planned": return typeof s.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.localDate)
      && Array.isArray(s.previous) && s.previous.length <= 50 && s.previous.every(isUuid)
      && (s.planned === undefined || (Array.isArray(s.planned) && s.planned.length <= 50 && s.planned.every(isUuid)));
    case "doc_created": return isUuid(s.docId) && (s.updatedAt === undefined || (typeof s.updatedAt === "string" && !Number.isNaN(Date.parse(s.updatedAt))));
    case "follow_up_asked": return isUuid(s.batchId) && uuids(s.followUpIds, 50);
    case "assistant_message": case "assistant_request": case "report_note": return isUuid(s.itemId);
    default: return false;
  }
}

/**
 * Signs an Undo token: `{ k: "brenda-undo", o, m, s: spec, l: label (≤ 300), n: nonce, a?: true }`, for `ttlSeconds`
 * (UNDO_WINDOW_MINUTES by default; the tests sign a shorter one). `auto`: the action ran because the person chose Act
 * without asking, so the Undo's log row is marked the same way.
 */
export function signUndoToken(ctx: Pick<OrgContext, "org" | "membership">, spec: UndoSpec, label: string, ttlSeconds = UNDO_WINDOW_MINUTES * 60, opts: { auto?: boolean } = {}): string {
  const l = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return signPayload({ k: TOKEN_KIND, o: ctx.org.id, m: ctx.membership.id, s: spec, l, n: randomToken(8), ...(opts.auto ? { a: true } : {}) }, ttlSeconds);
}

/**
 * What a done line carries so it can be undone for UNDO_WINDOW_MINUTES: the token and when the offer ends. Null when the
 * spec is not one this service can undo, or the token would pass UNDO_TOKEN_MAX (the line then simply has no Undo).
 * Synchronous: copilot's done() attaches it as the action is recorded.
 */
export function undoOffer(ctx: Pick<OrgContext, "org" | "membership">, spec: UndoSpec, label: string, opts: { auto?: boolean } = {}): UndoOffer | null {
  if (!isUndoSpec(spec)) return null;
  const token = signUndoToken(ctx, spec, label, UNDO_WINDOW_MINUTES * 60, opts);
  if (token.length > UNDO_TOKEN_MAX) return null;
  const p = verifySignedPayload<UndoPayload>(token, { allowExpired: true });
  if (!p) return null;
  return { token, until: new Date(p.exp * 1000).toISOString() };
}

// ---- Running it -----------------------------------------------------------------------------------------------------------

/**
 * Runs an Undo (D.3) as the person. Throws AppError: 400 INVALID (not an Undo token, or not ours), 403 FORBIDDEN
 * (someone else's), 409 ALREADY_UNDONE (a second press), 409 UNDO_EXPIRED (past the window), 409 UNDO_CHANGED or
 * UNDO_TOO_LATE (it moved on since: the words say how), 503 NOT_READY (a message to an assistant before 0045). The claim
 * is taken first and given back whenever nothing was undone, so the same words come back on a second press; after a
 * success a second press is ALREADY_UNDONE.
 */
export async function undoAction(ctx: OrgContext, token: string): Promise<{ undone: true; summary: string }> {
  if (typeof token !== "string" || token.length < 10 || token.length > UNDO_TOKEN_MAX) throw invalidUndo();
  const p = verifySignedPayload<UndoPayload>(token, { allowExpired: true });
  if (!p || p.k !== TOKEN_KIND || typeof p.o !== "string" || typeof p.m !== "string" || !isUndoSpec(p.s)) throw invalidUndo();
  if (p.o !== ctx.org.id || p.m !== ctx.membership.id) throw forbidden(UNDO_WORDS.someoneElses);
  const spec = p.s;
  const label = typeof p.l === "string" ? p.l : "";

  // At most once: the claim outlives the token (24 hours), and is given back when nothing was undone.
  const claim = [ctx.user.profileId, CLAIM_ROUTE, sha256(token)];
  const claimed = await withSystem((db) => db.maybeOne(
    `INSERT INTO idempotency_keys(actor_user_id, route, key, request_hash) VALUES ($1, $2, $3, $3) ON CONFLICT (actor_user_id, route, key) DO NOTHING RETURNING id`, claim));
  if (!claimed) throw conflict("ALREADY_UNDONE", UNDO_WORDS.already);
  const release = () => withSystem((db) => db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = $1 AND route = $2 AND key = $3`, claim)).catch(() => undefined);

  let summary: string;
  try {
    if (p.exp * 1000 < Date.now()) throw expiredUndo();
    summary = await run(ctx, spec);
  } catch (err) {
    await release();
    throw err;
  }
  await recordAction(ctx, {
    tool: "undo", outcome: "done", source: "chat", summary: UNDO_WORDS.logged[spec.kind],
    detail: { personalSummary: UNDO_WORDS.personal(label || UNDO_WORDS.logged[spec.kind]), undoOf: spec.kind, ...(p.a === true ? { auto: true } : {}) },
  });
  return { undone: true, summary };
}

/** An AppError's status and code, for mapping a service's refusal to the Undo's words. */
const errOf = (err: unknown) => (err instanceof AppError ? { status: err.status, code: err.code } : null);

/** A task service refusal that means "it moved on" (version, transition, an open session, gone, no longer valid). */
function taskMovedOn(err: unknown): boolean {
  const e = errOf(err);
  return !!e && (e.status === 404 || e.status === 409 || e.status === 422);
}

async function run(ctx: OrgContext, spec: UndoSpec): Promise<string> {
  switch (spec.kind) {
    case "todo_created": return undoTodos(ctx, spec.tasks);
    case "task_changed": {
      const { status, reason, ...fields } = spec.before;
      const input: Parameters<typeof updateTask>[2] = { expectedVersion: spec.version, ...fields };
      if (status) {
        input.status = status;
        if (status === "blocked" && typeof reason === "string" && reason.trim()) input.reason = reason;
      }
      try { await updateTask(ctx, spec.taskId, input); }
      catch (err) { if (taskMovedOn(err)) throw changed(UNDO_WORDS.taskChanged); throw err; }
      return UNDO_WORDS.done.task;
    }
    case "task_assigned": {
      try { await updateTask(ctx, spec.taskId, { expectedVersion: spec.version, assigneeMembershipId: spec.previousAssignee }); }
      catch (err) { if (taskMovedOn(err)) throw changed(UNDO_WORDS.taskChanged); throw err; }
      const who = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ name: string }>(
        `SELECT p.display_name AS name FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.id = $1 AND m.organisation_id = $2`, [spec.previousAssignee, ctx.org.id]));
      return UNDO_WORDS.done.assigned(who ? firstName(who.name) : "them");
    }
    case "reminder_set": {
      try { await cancelReminder(ctx, spec.reminderId); }
      catch (err) { if (errOf(err)?.status === 404) throw tooLate(UNDO_WORDS.reminderWentOff); throw err; }
      return UNDO_WORDS.done.reminderCancelled;
    }
    case "reminder_cancelled": {
      await restoreReminder(ctx, spec.reminderId); // 409 UNDO_TOO_LATE in its own words
      return UNDO_WORDS.done.reminderBack;
    }
    case "message_sent": {
      try { await withdrawMessage(ctx, spec.messageId); }
      catch (err) { if (errOf(err)?.status === 404) throw tooLate(UNDO_WORDS.messageGone); throw err; }
      return UNDO_WORDS.done.message;
    }
    case "conversations_read": {
      let done = 0;
      for (const id of spec.conversationIds) {
        try { await setConversationPrefs(ctx, id, { unread: true }); done++; }
        catch (err) { if (errOf(err)?.status !== 404) throw err; }
      }
      if (!done) throw tooLate("Those conversations aren't yours to change any more.");
      return UNDO_WORDS.done.unread;
    }
    case "status_set": {
      // Only while it is still what the action set (review, 8 October 2026).
      if (spec.set) {
        const now = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ presence: string }>(`SELECT presence FROM profiles WHERE id = $1`, [ctx.user.profileId]));
        if (now?.presence !== spec.set) throw changed(UNDO_WORDS.statusChanged);
      }
      await setMyPresence(ctx.user, spec.previous);
      return UNDO_WORDS.done.status(PRESENCE[spec.previous].label.toLowerCase());
    }
    case "day_planned": {
      if (spec.localDate !== todayLocal(ctx.org.timezone)) throw tooLate(UNDO_WORDS.otherDay);
      if (spec.planned) {
        const rows = await withUser(ctx.user.profileId, (db) => db.query<{ task_id: string }>(
          `SELECT task_id FROM daily_plan_items WHERE membership_id = $1 AND local_date = $2 ORDER BY position`, [ctx.membership.id, spec.localDate]));
        if (rows.map((r) => r.task_id).join(",") !== spec.planned.join(",")) throw changed(UNDO_WORDS.dayChanged);
      }
      await setDailyPlan(ctx, { localDate: spec.localDate, taskIds: spec.previous });
      return UNDO_WORDS.done.day;
    }
    case "doc_created": {
      // Written in, renamed or shared since: it stays (review, 8 October 2026). Archived documents have no restore.
      if (spec.updatedAt) {
        const d = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ same: boolean }>(
          `SELECT abs(extract(epoch FROM updated_at - $3::timestamptz)) < 0.001 AS same FROM documents WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`, [spec.docId, ctx.org.id, spec.updatedAt]));
        if (!d) throw tooLate(UNDO_WORDS.docGone);
        if (!d.same) throw changed(UNDO_WORDS.docChanged);
      }
      try { await archiveDoc(ctx, spec.docId); }
      catch (err) { if (errOf(err)?.status === 404) throw tooLate(UNDO_WORDS.docGone); throw err; }
      return UNDO_WORDS.done.doc;
    }
    case "follow_up_asked": {
      let cancelled = 0;
      let closed = 0;
      let other: unknown = null;
      for (const id of spec.followUpIds) {
        try { await cancelFollowUp(ctx, id); cancelled++; }
        catch (err) { if (errOf(err)?.code === "FOLLOW_UP_CLOSED") closed++; else other ??= err; }
      }
      if (!cancelled) throw other ?? tooLate(UNDO_WORDS.allAnswered);
      return join(UNDO_WORDS.done.followUp, closed ? UNDO_WORDS.done.someAnswered(closed) : null);
    }
    case "assistant_message": {
      try {
        const v = await unsendAssistantMessage(ctx, spec.itemId);
        return UNDO_WORDS.done.assistantMessage(v.recipient?.firstName ?? "them", v.recipient?.assistant.name ?? "assistant");
      } catch (err) {
        const e = errOf(err);
        if (e?.code === "ITEM_CLOSED") throw tooLate(UNDO_WORDS.seenIt(await recipientFirst(ctx, spec.itemId)));
        if (e?.code === "TOO_LATE") throw expiredUndo();
        throw err;
      }
    }
    case "assistant_request": {
      try {
        const v = await cancelItem(ctx, spec.itemId);
        return UNDO_WORDS.done.request(v.recipient?.firstName ?? "them");
      } catch (err) {
        if (errOf(err)?.code === "ITEM_CLOSED") throw tooLate(UNDO_WORDS.answeredIt(await recipientFirst(ctx, spec.itemId)));
        throw err;
      }
    }
    case "report_note": {
      try {
        await withdrawReportNote(ctx, spec.itemId);
        return UNDO_WORDS.done.note;
      } catch (err) {
        const e = errOf(err);
        if (e?.code === "TOO_LATE") throw tooLate(UNDO_WORDS.reportWritten);
        if (e?.code === "ITEM_CLOSED") {
          const v = await getAssistantItem(ctx, spec.itemId).catch(() => null);
          throw tooLate(v?.status === "withdrawn" ? UNDO_WORDS.noteGone : UNDO_WORDS.reportWritten);
        }
        throw err;
      }
    }
  }
}

/** The other person's first name, from the item as the sender reads it now (never from the token). */
async function recipientFirst(ctx: OrgContext, itemId: string): Promise<string> {
  const v = await getAssistantItem(ctx, itemId).catch(() => null);
  return v?.recipient?.firstName ?? "They";
}

/**
 * The to-dos the assistant added, archived as the person (`updateTask … archive`), each only while it is still a to-do
 * nobody has started or edited since (its version as it was made). Any one changed: nothing is removed, and the words
 * say so. Handed to someone else: they were already notified, and the words say that too.
 */
async function undoTodos(ctx: OrgContext, tasks: { id: string; version: number }[]): Promise<string> {
  const rows = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; version: number; status: string; archived_at: string | null; assignee_membership_id: string; name: string }>(
    `SELECT t.id, t.version, t.status, t.archived_at, t.assignee_membership_id, p.display_name AS name
     FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles p ON p.id = m.user_id
     WHERE t.organisation_id = $1 AND t.id = ANY($2::uuid[])`, [ctx.org.id, tasks.map((t) => t.id)]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const t of tasks) {
    const r = byId.get(t.id);
    if (!r || r.archived_at || r.status !== "todo" || r.version !== t.version) throw changed(UNDO_WORDS.todoChanged);
  }
  // Checked above; one that moves between the check and its turn (a race) is left, and the words count what was removed.
  let removed = 0;
  let first: unknown = null;
  for (const t of tasks) {
    try { await updateTask(ctx, t.id, { expectedVersion: t.version, archive: true }); removed++; }
    catch (err) { first ??= err; }
  }
  if (!removed) throw taskMovedOn(first) ? changed(UNDO_WORDS.todoChanged) : first;
  const told = [...new Set(tasks.map((t) => byId.get(t.id)!).filter((r) => r.assignee_membership_id !== ctx.membership.id).map((r) => firstName(r.name)))];
  return join(UNDO_WORDS.done.todos(removed), told.length ? UNDO_WORDS.done.toldAbout(told, removed) : null);
}
