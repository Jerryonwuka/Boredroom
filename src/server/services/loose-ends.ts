/**
 * Loose ends (owner decisions, 8 October 2026: phase 7b, "Brenda keeps the loops closed", second part). The person's
 * own assistant looks through the conversations the person can read (direct messages and channels) for three kinds of
 * loose end that never became a to-do, reminder, follow-up or commitment: promises the person made ("I'll send the deck
 * Thursday"), things asked of them ("Olu, can you review X by Friday?") and things they asked of others ("Ben, can you
 * fix the login bug?"). Finding them is loose-end-detect's (as the person, prefilter then the model as quoted data);
 * this file keeps what was found and does what the person chooses with each:
 * - Make it a to-do: ALWAYS asked first, even in "Act without asking" (owner decision: a private to-do from someone
 *   else's words); here it is the person's own press or confirmed card, through the same quickTodo their buttons use;
 * - Remind me: a reminder at the time they pick (createReminder);
 * - Hand it to someone's assistant: an ordinary assistant request (`add_todo`) the other person accepts first, through
 *   phase 6's planRequest and sendAssistantItem (their refusals as words);
 * - Follow up later: on the time they pick, the person's assistant asks the other person's assistant about it (a phase 4
 *   follow-up, made then by the worker as the person, within every limit). Their press is the consent for exactly that
 *   one question to exactly that person; the question is the fixed "About “{title}”: where is it?";
 * - Not a commitment: closed, and the message is remembered for good so it is never suggested again.
 *
 * Private to the person (row-level security, migration 0048): nobody else reads their loose ends, not their lead, not
 * the owner, not HR, and nothing here writes an audit row or an activity line others could read. A loose end is only
 * ever about a message the person can read (the insert's policy checks the conversation). Before migration 0048
 * everything here is absent and says so (server/lib/schema-0048).
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { forget0048, isMissingSchema, retryWithout0048, schema0048Ready } from "@/server/lib/schema-0048";
import { memberContext } from "@/server/lib/member-context";
import { enqueueJob } from "@/server/services/common";
import { createReminder } from "@/server/services/brenda";
import { quickTodo } from "@/server/services/tasks";
import { planRequest, sendAssistantItem } from "@/server/services/assistant-items";
import { createFollowUps } from "@/server/services/follow-ups";
import { toProfile } from "@/lib/assistant-look";
import { clip, firstName, type PersonRef } from "@/lib/follow-ups";
import {
  LOOP_LIMITS as L, LOOP_WORDS as W, LOOPS_NOT_READY_SHORT, LOOSE_END_ACTIONS, isLooseEndKind, loopDueLabel, loopTitle, looseEndHref,
  type DetectedLooseEnd, type LooseEndAction, type LooseEndKind, type LooseEndList, type LooseEndStatus, type LooseEndView,
} from "@/lib/commitments";

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
const notHere = () => notFound(W.errors.notFound);
const warn = (what: string) => (err: unknown) => console.warn(`[loose ends] ${what}: ${(err as Error)?.message ?? String(err)}`);
const oneLine = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const isOrgAccount = (role: string) => role === "owner" || role === "hr";
const appOrigin = () => process.env.APP_ORIGIN ?? "http://localhost:3000";
const messageHref = (slug: string, conversationId: string, messageId: string) => `/app/${slug}/messages?c=${conversationId}#m-${messageId}`;
/** A follow-up later is at least this far ahead, and at most this far. */
const FOLLOW_UP_MIN_MS = 5 * 60_000;
const FOLLOW_UP_MAX_MS = 60 * 86_400_000;
/** How long the worker holds a follow-up it is asking (pushed forward while it runs, so a second worker leaves it). */
const FOLLOW_UP_LEASE_MS = 10 * 60_000;

function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated(firstName(ctx.user.displayName)));
}

/** The question a follow-up later asks (owner decision, 8 October 2026: fixed words, from the loose end's own title). */
const followUpQuestion = (title: string) => clip(`About “${loopTitle(title)}”: where is it?`, 280);

// ---- Views --------------------------------------------------------------------------------------------------------------

type Row = {
  id: string; kind: LooseEndKind; status: LooseEndStatus; title: string; due_at: string | null; due_words: string | null; confidence: number;
  detected_by: "claude" | "builtin"; source: "on_demand" | "routine"; message_id: string; conversation_id: string; counterpart_membership_id: string | null;
  task_id: string | null; reminder_id: string | null; assistant_item_id: string | null; follow_up_id: string | null; follow_up_at: string | null;
  follow_up_error: string | null; acted_at: string | null; created_at: string;
  cp_name: string | null; cp_a_name: string | null; cp_a_colour: string | null; cp_a_visor: string | null; cp_a_eyes: string | null;
  msg_visible: boolean; msg_at: string | null; msg_body: string | null; msg_deleted: boolean; conv_name: string | null;
};

/** As the person ($1 organisation, $2 the person's membership): their own loose ends only. */
const VIEW_SQL = `
  SELECT le.id, le.kind, le.status, le.title, le.due_at, le.due_words, le.confidence, le.detected_by, le.source, le.message_id, le.conversation_id,
         le.counterpart_membership_id, le.task_id, le.reminder_id, le.assistant_item_id, le.follow_up_id, le.follow_up_at, le.follow_up_error, le.acted_at, le.created_at,
         pp.display_name AS cp_name, pa.name AS cp_a_name, pa.colour AS cp_a_colour, pa.visor AS cp_a_visor, pa.eyes AS cp_a_eyes,
         (m.id IS NOT NULL) AS msg_visible, m.created_at AS msg_at, CASE WHEN m.deleted_at IS NULL THEN m.body END AS msg_body, (m.deleted_at IS NOT NULL) AS msg_deleted,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || ct.name WHEN 'channel' THEN '#' || c.title
                     WHEN 'direct' THEN (SELECT op.display_name FROM conversation_participants dp JOIN memberships om ON om.id = dp.membership_id JOIN profiles op ON op.id = om.user_id
                                         WHERE dp.conversation_id = c.id AND dp.membership_id <> $2 LIMIT 1) END AS conv_name
  FROM loose_ends le
  LEFT JOIN memberships pm ON pm.id = le.counterpart_membership_id LEFT JOIN profiles pp ON pp.id = pm.user_id
  LEFT JOIN assistant_profiles pa ON pa.membership_id = le.counterpart_membership_id
  LEFT JOIN messages m ON m.id = le.message_id
  LEFT JOIN conversations c ON c.id = le.conversation_id
  LEFT JOIN teams ct ON ct.id = c.team_id`;

function toView(r: Row, ctx: OrgContext): LooseEndView {
  const counterpart: PersonRef | null = r.counterpart_membership_id
    ? { membershipId: r.counterpart_membership_id, name: r.cp_name ?? "Someone", firstName: firstName(r.cp_name ?? "Someone"), assistant: toProfile({ name: r.cp_a_name, colour: r.cp_a_colour, visor: r.cp_a_visor, eyes: r.cp_a_eyes }) }
    : null;
  const actions: LooseEndAction[] = r.status !== "open" ? [] : LOOSE_END_ACTIONS[r.kind].filter((a) =>
    (a !== "todo" || !isOrgAccount(ctx.membership.role)) && (a !== "follow_up" || !!counterpart));
  const result: NonNullable<LooseEndView["result"]> = {};
  if (r.task_id) result.taskId = r.task_id;
  if (r.reminder_id) result.reminderId = r.reminder_id;
  if (r.assistant_item_id) result.itemId = r.assistant_item_id;
  if (r.follow_up_id) result.followUpId = r.follow_up_id;
  if (r.follow_up_at) result.followUpAt = r.follow_up_at;
  if (r.follow_up_error) result.error = r.follow_up_error;
  return {
    id: r.id, kind: r.kind, status: r.status,
    title: r.title, dueAt: r.due_at, dueWords: r.due_words, dueLabel: loopDueLabel(r.due_at, ctx.org.timezone),
    counterpart,
    message: {
      id: r.message_id, conversationId: r.conversation_id, at: r.msg_at ?? r.created_at, href: messageHref(ctx.org.slug, r.conversation_id, r.message_id),
      quote: r.msg_visible && !r.msg_deleted && r.msg_body ? clip(oneLine(r.msg_body), L.quoteMax) : null,
      withdrawn: r.msg_visible && r.msg_deleted, where: r.conv_name ?? "Messages",
    },
    detectedBy: r.detected_by, confidence: Number(r.confidence), source: r.source,
    actions,
    result: Object.keys(result).length ? result : null,
    headline: W.looseEnds.headline(r.kind, loopTitle(r.title), counterpart?.firstName ?? null),
    createdAt: r.created_at, actedAt: r.acted_at,
    href: looseEndHref(ctx.org.slug, r.id),
  };
}

async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[], tail: string): Promise<LooseEndView[]> {
  const rows = await db.query<Row>(`${VIEW_SQL} WHERE le.organisation_id = $1 AND le.membership_id = $2 AND (${where}) ${tail}`, [ctx.org.id, ctx.membership.id, ...params]);
  return rows.map((r) => toView(r, ctx));
}

/** Runs `fn` as the person, 503 before 0048. */
async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); throw notReady(); }
    throw err;
  }
}

async function viewOrThrow(ctx: OrgContext, id: string): Promise<LooseEndView> {
  const v = await asPerson(ctx, async (db) => (await loadViews(db, ctx, "le.id = $3", [id], ""))[0] ?? null);
  if (!v) throw notHere();
  return v;
}

// ---- Reading -------------------------------------------------------------------------------------------------------------

/**
 * Open loose ends whose message has since become a commitment the person owes or asked (noted in a tracked
 * conversation): done elsewhere ("resolved"). As the person, only rows whose conversation they still read.
 */
/** What a twin was turned into that settles its other half too (RESOLVE_SQL, actOnOpen). */
const TWIN_ACTED: LooseEndStatus[] = ["todo", "reminder", "handed", "follow_up_scheduled", "follow_up", "resolved"];

const RESOLVE_SQL = `
  UPDATE loose_ends le SET status = 'resolved', acted_at = now()
  WHERE le.organisation_id = $1 AND le.membership_id = $2 AND le.status = 'open' AND app_can_read_conversation(le.conversation_id)
    AND EXISTS (SELECT 1 FROM commitments cm WHERE (cm.source_message_id = le.message_id OR cm.agreement_message_id = le.message_id)
                  AND (cm.committer_membership_id = $2 OR cm.asker_membership_id = $2) AND cm.status NOT IN ('declined', 'dismissed', 'expired', 'cancelled'))
    -- Its twin was acted on (review, 9 October 2026): an ask of the person and their own "On it" to it are one loose end.
    OR (le.organisation_id = $1 AND le.membership_id = $2 AND le.status = 'open' AND EXISTS (
          SELECT 1 FROM loose_ends tw WHERE tw.membership_id = le.membership_id AND tw.id <> le.id
            AND (tw.message_id = le.context_message_id OR tw.context_message_id = le.message_id)
            AND tw.status IN ('todo', 'reminder', 'handed', 'follow_up_scheduled', 'follow_up', 'resolved')))`;

/**
 * The person's loose ends, as them: `open` (the default list), `acted` (what they did something with) or `all`; open
 * first, newest first; the quote read live (a withdrawn message reads withdrawn, no words). `lastScanAt`: when the
 * newest one was found. Before 0048: `ready: false`, empty.
 */
export async function listLooseEnds(ctx: OrgContext, o: { status?: "open" | "acted" | "all"; limit?: number } = {}): Promise<LooseEndList> {
  const none: LooseEndList = { ready: false, items: [], counts: { open: 0 }, lastScanAt: null };
  const limit = Math.min(L.listMax, Math.max(1, Math.round(Number.isFinite(o.limit) ? (o.limit as number) : L.listMax)));
  const status = o.status === "acted" || o.status === "all" ? o.status : "open";
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db): Promise<LooseEndList> => {
      if (!(await schema0048Ready(db))) return none;
      await db.query(RESOLVE_SQL, [ctx.org.id, ctx.membership.id]);
      const where = status === "open" ? "le.status = 'open'" : status === "acted" ? "le.status <> 'open'" : "true";
      const items = await loadViews(db, ctx, where, [], `ORDER BY (le.status = 'open') DESC, le.created_at DESC, le.id DESC LIMIT ${limit}`);
      const c = await db.one<{ open: number; last: string | null }>(
        `SELECT count(*) FILTER (WHERE status = 'open')::int AS open, max(created_at) AS last FROM loose_ends WHERE organisation_id = $1 AND membership_id = $2`,
        [ctx.org.id, ctx.membership.id]);
      return { ready: true, items, counts: { open: c.open }, lastScanAt: c.last };
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return none; }
    throw err;
  }
}

/** One loose end, the person's own; null otherwise (and before 0048). */
export async function getLooseEnd(ctx: OrgContext, id: string): Promise<LooseEndView | null> {
  if (!isUuid(id)) return null;
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return null;
      return (await loadViews(db, ctx, "le.id = $3", [id], ""))[0] ?? null;
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return null; }
    throw err;
  }
}

/**
 * The messages among `messageIds` that are already known for this person, so a scan never suggests them again: a loose
 * end of theirs on it (the message, or the ask an agreement answered), one they said was not a commitment, or a
 * commitment they owe or asked on it (any status: noted, declined or dismissed alike). As the person. Empty before 0048.
 */
export async function knownLooseEndMessages(ctx: OrgContext, messageIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(messageIds.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!ids.length) return new Set();
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return new Set<string>();
      const rows = await db.query<{ id: string }>(
        `SELECT x.id::text AS id FROM unnest($2::uuid[]) AS x(id)
         WHERE EXISTS (SELECT 1 FROM loose_ends le WHERE le.membership_id = $1 AND (le.message_id = x.id OR le.context_message_id = x.id))
            OR EXISTS (SELECT 1 FROM loose_end_dismissals d WHERE d.membership_id = $1 AND d.message_id = x.id)
            OR EXISTS (SELECT 1 FROM commitments cm WHERE (cm.source_message_id = x.id OR cm.agreement_message_id = x.id)
                         AND (cm.committer_membership_id = $1 OR cm.asker_membership_id = $1))`, [ctx.membership.id, ids]);
      return new Set(rows.map((r) => r.id));
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return new Set(); }
    throw err;
  }
}

/** A detected loose end as it may be stored, or null. */
function cleanDetected(r: DetectedLooseEnd, me: string) {
  if (!r || typeof r !== "object" || !isUuid(r.messageId) || !isUuid(r.conversationId) || !isLooseEndKind(r.kind)) return null;
  const title = clip(oneLine(r.title), L.titleMax);
  if (!title) return null;
  const counterpart = isUuid(r.counterpartMembershipId) && r.counterpartMembershipId.toLowerCase() !== me.toLowerCase() ? r.counterpartMembershipId : null;
  const c = Number(r.confidence);
  return {
    messageId: r.messageId, conversationId: r.conversationId, contextMessageId: isUuid(r.contextMessageId) ? r.contextMessageId : null, kind: r.kind,
    counterpart, title,
    dueAt: typeof r.dueAt === "string" && !Number.isNaN(Date.parse(r.dueAt)) ? new Date(r.dueAt).toISOString() : null,
    dueWords: clip(oneLine(r.dueWords), L.dueWordsMax) || null,
    detectedBy: r.detectedBy === "claude" ? "claude" as const : "builtin" as const,
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
  };
}

/**
 * Keeps what a scan found, as the person: only about messages they can read (each checked here, and by the insert's
 * policy), never a message they said was not a commitment, one per message and kind (`loose_ends_one`). The counterpart
 * must be another member of the workspace (else none). Returns the new ones' views. [] before 0048.
 */
export async function insertLooseEnds(ctx: OrgContext, rows: DetectedLooseEnd[], o: { source: "on_demand" | "routine" }): Promise<LooseEndView[]> {
  const source = o?.source === "routine" ? "routine" : "on_demand";
  const clean = (Array.isArray(rows) ? rows : []).map((r) => cleanDetected(r, ctx.membership.id)).filter((r): r is NonNullable<typeof r> => !!r);
  if (!clean.length) return [];
  try {
    return await retryWithout0048(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0048Ready(db))) return [];
      const created: string[] = [];
      for (const r of clean) {
        const ok = await db.maybeOne<{ readable: boolean; in_conv: boolean; context_ok: boolean; counterpart_ok: boolean; dismissed: boolean }>(
          `SELECT app_can_read_conversation($2) AS readable,
                  EXISTS (SELECT 1 FROM messages m WHERE m.id = $1 AND m.conversation_id = $2 AND m.organisation_id = $5) AS in_conv,
                  ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM messages m WHERE m.id = $3 AND m.conversation_id = $2)) AS context_ok,
                  ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM memberships mm WHERE mm.id = $4 AND mm.organisation_id = $5)) AS counterpart_ok,
                  EXISTS (SELECT 1 FROM loose_end_dismissals d WHERE d.membership_id = $6 AND d.message_id = $1) AS dismissed`,
          [r.messageId, r.conversationId, r.contextMessageId, r.counterpart, ctx.org.id, ctx.membership.id]);
        if (!ok?.readable || !ok.in_conv || ok.dismissed) continue;
        try {
          await db.query(`SAVEPOINT loose_end_insert`);
          const ins = await db.maybeOne<{ id: string }>(
            `INSERT INTO loose_ends(organisation_id, membership_id, message_id, conversation_id, context_message_id, kind, counterpart_membership_id, title,
                                    due_at, due_words, confidence, detected_by, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT ON CONSTRAINT loose_ends_one DO NOTHING RETURNING id`,
            [ctx.org.id, ctx.membership.id, r.messageId, r.conversationId, ok.context_ok ? r.contextMessageId : null, r.kind, ok.counterpart_ok ? r.counterpart : null,
             r.title, r.dueAt, r.dueWords, r.confidence, r.detectedBy, source]);
          await db.query(`RELEASE SAVEPOINT loose_end_insert`);
          if (ins) created.push(ins.id);
        } catch (err) {
          await db.query(`ROLLBACK TO SAVEPOINT loose_end_insert`).catch(() => undefined);
          warn("keeping a loose end")(err);
        }
      }
      if (!created.length) return [];
      return loadViews(db, ctx, "le.id = ANY($3::uuid[])", [created], "ORDER BY le.created_at DESC, le.id DESC");
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0048(); return []; }
    throw err;
  }
}

// ---- The person's actions -----------------------------------------------------------------------------------------------------

export const looseEndTodoSchema = z.object({ title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({ offset: true }).nullable().optional() });
export const looseEndRemindSchema = z.object({ at: z.string().datetime({ offset: true }), text: z.string().trim().min(1).max(500).optional() });
export const looseEndHandOverSchema = z.object({ to: z.string().uuid(), title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({ offset: true }).nullable().optional(), note: z.string().trim().max(280).optional() });
export const looseEndFollowUpSchema = z.object({ at: z.string().datetime({ offset: true }), question: z.string().trim().min(1).max(280).optional() });

type ActRow = { id: string; kind: LooseEndKind; status: LooseEndStatus; title: string; conversation_id: string; message_id: string; counterpart_membership_id: string | null; readable: boolean };

/**
 * The loose end, the person's own and still open (`allowScheduled`: or with a follow-up scheduled), about a conversation
 * they still read. 404 otherwise (another person's id reads exactly as a missing one), 409 when something was done
 * with it already, 503 before 0048.
 */
async function openRow(ctx: OrgContext, id: string, o: { allowScheduled?: boolean } = {}): Promise<ActRow> {
  if (!isUuid(id)) throw notHere();
  return asPerson(ctx, async (db) => {
    const r = await db.maybeOne<ActRow>(
      `SELECT id, kind, status, title, conversation_id, message_id, counterpart_membership_id, app_can_read_conversation(conversation_id) AS readable
       FROM loose_ends WHERE id = $1 AND organisation_id = $2 AND membership_id = $3`, [id, ctx.org.id, ctx.membership.id]);
    if (!r || !r.readable) throw notHere();
    if (r.status !== "open" && !(o.allowScheduled && r.status === "follow_up_scheduled")) throw conflict("ITEM_CLOSED", W.errors.closed);
    return r;
  });
}

/**
 * Does one action on an open loose end while holding it (review, 9 October 2026): the row is locked as the person
 * (`FOR UPDATE`) and stays locked while `act` makes the to-do, the reminder or the request in its own transaction, then
 * it is marked in the same transaction as the lock. Two presses that do not share an idempotency key (the Home panel and
 * the Loose ends page, a chat Confirm and the web) therefore never both act: the second waits, then finds it closed
 * (409). Anything `act` throws leaves the loose end open and unchanged. 404 / 409 / 503 as openRow.
 */
async function actOnOpen<T>(ctx: OrgContext, id: string, act: (r: ActRow) => Promise<T>, markAs: (made: T) => { set: string; params: unknown[] }): Promise<void> {
  if (!isUuid(id)) throw notHere();
  await asPerson(ctx, async (db) => {
    // The row and its twin (an ask of the person and their own "On it" to it: one loose end) are locked together, in id
    // order, for the whole action (review, 9 October 2026): a press on each of the two never makes two to-dos. The
    // second waits, then finds its twin acted on (409; the list then shows it done elsewhere, RESOLVE_SQL).
    const group = await db.query<{ id: string; status: LooseEndStatus }>(
      `SELECT le.id, le.status FROM loose_ends le
       JOIN loose_ends me ON me.id = $1 AND me.organisation_id = $2 AND me.membership_id = $3
       WHERE le.membership_id = me.membership_id AND le.organisation_id = me.organisation_id
         AND (le.id = me.id OR le.message_id = me.context_message_id OR le.context_message_id = me.message_id)
       ORDER BY le.id FOR UPDATE OF le`, [id, ctx.org.id, ctx.membership.id]);
    const r = await db.maybeOne<ActRow>(
      `SELECT id, kind, status, title, conversation_id, message_id, counterpart_membership_id, app_can_read_conversation(conversation_id) AS readable
       FROM loose_ends WHERE id = $1 AND organisation_id = $2 AND membership_id = $3`, [id, ctx.org.id, ctx.membership.id]);
    if (!r || !r.readable) throw notHere();
    if (r.status !== "open") throw conflict("ITEM_CLOSED", W.errors.closed);
    if (group.some((g) => g.id !== id && TWIN_ACTED.includes(g.status))) throw conflict("ITEM_CLOSED", W.errors.closed);
    const made = await act(r);
    const m = markAs(made);
    const ok = await db.maybeOne(
      `UPDATE loose_ends SET ${m.set} WHERE id = $1 AND organisation_id = $2 AND membership_id = $3 AND status = 'open' RETURNING id`,
      [id, ctx.org.id, ctx.membership.id, ...m.params]);
    if (!ok) throw conflict("ITEM_CLOSED", W.errors.closed);
  });
}

/** Marks what was done, guarded on the status it had; 409 when it moved in between. */
async function mark(ctx: OrgContext, id: string, from: LooseEndStatus[], set: string, params: unknown[]): Promise<void> {
  await asPerson(ctx, async (db) => {
    const ok = await db.maybeOne(
      `UPDATE loose_ends SET ${set} WHERE id = $1 AND organisation_id = $2 AND membership_id = $3 AND status = ANY($4::text[]) RETURNING id`,
      [id, ctx.org.id, ctx.membership.id, from, ...params]);
    if (!ok) throw conflict("ITEM_CLOSED", W.errors.closed);
  });
}

/**
 * Make it a to-do: the person's own press (or their confirmed card; the chat always asks first, even in "Act without
 * asking"), through quickTodo as them, with the message's link in its details. Owners and HR hold no to-dos (403, the
 * to-do service's words).
 */
export async function looseEndToTodo(ctx: OrgContext, id: string, input: z.infer<typeof looseEndTodoSchema>): Promise<LooseEndView> {
  notWhileImpersonated(ctx);
  const p = looseEndTodoSchema.safeParse(input);
  if (!p.success) throw invalid("Give the to-do a title (at most 200 characters).", { title: ["Between 1 and 200 characters."] });
  await actOnOpen(ctx, id,
    (r) => quickTodo(ctx, {
      title: oneLine(p.data.title), dueAt: p.data.dueAt ?? null,
      description: `From Messages: ${appOrigin()}${messageHref(ctx.org.slug, r.conversation_id, r.message_id)}`,
    }),
    (t) => ({ set: `status = 'todo', task_id = $4, acted_at = now()`, params: [t.id] }));
  return viewOrThrow(ctx, id);
}

/** Remind me: a reminder for the person at `at` (createReminder: in the past or over a year ahead, 422). */
export async function looseEndRemind(ctx: OrgContext, id: string, input: z.infer<typeof looseEndRemindSchema>): Promise<LooseEndView> {
  notWhileImpersonated(ctx);
  const p = looseEndRemindSchema.safeParse(input);
  if (!p.success) throw invalid("Pick when to remind you.", { at: ["Pick a date and time."] });
  await openRow(ctx, id);
  const v = await viewOrThrow(ctx, id);
  const body = clip(oneLine(p.data.text) || v.headline, 500);
  await actOnOpen(ctx, id,
    () => createReminder(ctx, { body, remindAt: p.data.at, taskId: null }),
    (reminder) => ({ set: `status = 'reminder', reminder_id = $4, acted_at = now()`, params: [reminder.id] }));
  return viewOrThrow(ctx, id);
}

/** A planRequest refusal as the error the route answers (as sendAssistantItem's own). */
function refusalError(r: { code: string; error: string }): AppError {
  switch (r.code) {
    case "not_ready": return new AppError(503, "NOT_READY", r.error);
    case "muted": return new AppError(403, "MUTED", r.error);
    case "limit_pair": case "limit_recipient": case "limit_sender": case "limit_notes": return conflict("ASSISTANT_ITEM_LIMIT", r.error);
    case "too_late": return conflict("TOO_LATE", r.error);
    default: return new AppError(422, "INVALID_INPUT", r.error, { details: { reason: r.code } });
  }
}

/**
 * Hand it to someone's assistant: an ordinary request (`add_todo`) through phase 6, checked as the person and sent
 * after their press; nothing changes for the other person until they accept. Refusals (muted, limits, not a member, no
 * to-dos) as the request's own words. Returns the loose end; the route reads the item it sent (`result.itemId`).
 */
export async function looseEndHandOver(ctx: OrgContext, id: string, input: z.infer<typeof looseEndHandOverSchema>): Promise<LooseEndView> {
  notWhileImpersonated(ctx);
  const p = looseEndHandOverSchema.safeParse(input);
  if (!p.success) throw invalid("Say who it goes to and what the to-do is.", { title: ["Between 1 and 200 characters."] });
  await openRow(ctx, id);
  const plan = await planRequest(ctx, { to: p.data.to, request: { kind: "add_todo", title: oneLine(p.data.title), due: p.data.dueAt ?? null }, note: p.data.note ?? null });
  if (!plan.ok) throw refusalError(plan);
  await actOnOpen(ctx, id,
    () => sendAssistantItem(ctx, { kind: "request", recipientMembershipId: plan.recipient.membershipId, payload: plan.payload, note: plan.note }),
    (item) => ({ set: `status = 'handed', assistant_item_id = $4, acted_at = now()`, params: [item.id] }));
  return viewOrThrow(ctx, id);
}

/**
 * Follow up later: on `at` (at least 5 minutes ahead, at most 60 days), the person's assistant asks the other person's
 * assistant "About “{title}”: where is it?" (a phase 4 follow-up the worker makes then, as the person). Needs someone to
 * ask (the counterpart). Nothing is asked before then. The question is always that fixed one: 0048 keeps no question
 * of the person's own (a `question` given here is not used).
 */
export async function looseEndFollowUpLater(ctx: OrgContext, id: string, input: z.infer<typeof looseEndFollowUpSchema>): Promise<LooseEndView> {
  notWhileImpersonated(ctx);
  const p = looseEndFollowUpSchema.safeParse(input);
  if (!p.success) throw invalid("Pick when to follow up.", { at: ["Pick a date and time."] });
  const at = Date.parse(p.data.at);
  if (at < Date.now() + FOLLOW_UP_MIN_MS) throw invalid("Pick a time at least 5 minutes from now.", { at: ["At least 5 minutes from now."] });
  if (at > Date.now() + FOLLOW_UP_MAX_MS) throw invalid("Pick a time within the next 60 days.", { at: ["Within 60 days."] });
  const r = await openRow(ctx, id);
  if (!r.counterpart_membership_id) throw invalid("There's nobody to follow up with on this one. Hand it to someone's assistant instead.");
  await mark(ctx, r.id, ["open"], `status = 'follow_up_scheduled', follow_up_at = $5::timestamptz, follow_up_error = NULL, acted_at = now()`, [new Date(at).toISOString()]);
  return viewOrThrow(ctx, id);
}

/** Not a commitment: closed for good, and the message remembered so it is never suggested again (also a scheduled follow-up). */
export async function dismissLooseEnd(ctx: OrgContext, id: string): Promise<LooseEndView> {
  notWhileImpersonated(ctx);
  const r = await openRow(ctx, id, { allowScheduled: true });
  await asPerson(ctx, async (db) => {
    await db.query(`INSERT INTO loose_end_dismissals(membership_id, message_id, organisation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [ctx.membership.id, r.message_id, ctx.org.id]);
    const ok = await db.maybeOne(
      `UPDATE loose_ends SET status = 'dismissed', acted_at = now() WHERE id = $1 AND membership_id = $2 AND status IN ('open', 'follow_up_scheduled') RETURNING id`,
      [r.id, ctx.membership.id]);
    if (!ok) throw conflict("ITEM_CLOSED", W.errors.closed);
  });
  return viewOrThrow(ctx, id);
}

// ---- The worker ---------------------------------------------------------------------------------------------------------------

/**
 * Follow-ups the people scheduled, now due (the worker's `loose_ends.sweep`): each is made as its person
 * (`memberContext`, "routine": never an interactive Confirm) with exactly the stored question to exactly the stored
 * person, through createFollowUps' own permission checks and limits, then handed to `followup.process`. A refusal (or
 * the person gone) puts it back to open with why, shown on their Loose ends page; nothing is sent to anyone. Never throws.
 */
export async function runDueLooseEndFollowUps(o: { now?: Date; limit?: number } = {}): Promise<{ asked: number; failed: number }> {
  const now = o.now ?? new Date();
  const limit = Math.min(100, Math.max(1, Math.round(o.limit ?? 25)));
  const out = { asked: 0, failed: 0 };
  let rows: { id: string; organisation_id: string; membership_id: string; counterpart_membership_id: string | null; title: string }[] | null;
  try {
    rows = await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return null;
      return db.query(
        `SELECT id, organisation_id, membership_id, counterpart_membership_id, title FROM loose_ends
         WHERE status = 'follow_up_scheduled' AND follow_up_at <= $1::timestamptz ORDER BY follow_up_at, id LIMIT $2`, [now.toISOString(), limit]);
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("reading due follow-ups")(err);
    return out;
  }
  if (!rows) return out;
  const back = (id: string, why: string) => withWorker((db) => db.query(
    `UPDATE loose_ends SET status = 'open', follow_up_error = $2 WHERE id = $1 AND status = 'follow_up_scheduled'`, [id, clip(oneLine(why) || "It couldn't be asked.", 300)]))
    .catch(warn("putting a follow-up back"));
  for (const r of rows) {
    try {
      // Held while it runs: a second worker leaves it, and one that stopped halfway asks again in 10 minutes (an open
      // follow-up with the same person is reused, never repeated).
      const claimed = await withWorker((db) => db.maybeOne(
        `UPDATE loose_ends SET follow_up_at = $2::timestamptz WHERE id = $1 AND status = 'follow_up_scheduled' AND follow_up_at <= $3::timestamptz RETURNING id`,
        [r.id, new Date(now.getTime() + FOLLOW_UP_LEASE_MS).toISOString(), now.toISOString()]));
      if (!claimed) continue;
      const ctx = await withWorker((db) => memberContext(db, r.organisation_id, r.membership_id, { sessionId: "routine" }));
      if (!ctx) { await back(r.id, "You're no longer an active member of this workspace."); out.failed++; continue; }
      if (!r.counterpart_membership_id) { await back(r.id, "There's nobody to follow up with on this one."); out.failed++; continue; }
      // Asked while the row is held (review, 9 October 2026): "Not a commitment" pressed meanwhile waits, then finds it
      // asked (409); pressed first, it is found dismissed here and nothing is asked.
      const counterpart = r.counterpart_membership_id;
      const outcome = await withWorker(async (db): Promise<"asked" | "gone" | { failed: string }> => {
        const still = await db.maybeOne(`SELECT id FROM loose_ends WHERE id = $1 AND status = 'follow_up_scheduled' FOR UPDATE`, [r.id]);
        if (!still) return "gone";
        const res = await createFollowUps(ctx, { subjectMembershipIds: [counterpart], teamId: null, taskId: null, question: followUpQuestion(r.title) });
        const createdId = res.created[0]?.id ?? null;
        const followUpId = createdId ?? res.reused[0]?.id ?? null;
        if (!followUpId) {
          await db.query(`UPDATE loose_ends SET status = 'open', follow_up_error = $2 WHERE id = $1 AND status = 'follow_up_scheduled'`,
            [r.id, clip(oneLine(res.skipped[0]?.reason ?? "") || "It couldn't be asked.", 300)]);
          return { failed: res.skipped[0]?.reason ?? "It couldn't be asked." };
        }
        await db.query(`UPDATE loose_ends SET status = 'follow_up', follow_up_id = $2, follow_up_error = NULL WHERE id = $1 AND status = 'follow_up_scheduled'`, [r.id, followUpId]);
        if (createdId) await enqueueJob(db, "followup.process", { ids: [createdId] }, { dedupKey: `followup.process:loose:${r.id}` });
        return "asked";
      });
      if (outcome === "gone") continue;
      if (outcome !== "asked") { out.failed++; continue; }
      out.asked++;
    } catch (err) {
      await back(r.id, (err as Error)?.message ?? "It couldn't be asked.");
      out.failed++;
    }
  }
  return out;
}

/** Whether any scheduled follow-up is due (the scheduler's check). False before 0048 and on any error. */
export async function looseEndsDue(o: { now?: Date } = {}): Promise<boolean> {
  const now = o.now ?? new Date();
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return false;
      return !!(await db.maybeOne(`SELECT 1 FROM loose_ends WHERE status = 'follow_up_scheduled' AND follow_up_at <= $1::timestamptz LIMIT 1`, [now.toISOString()]));
    });
  } catch (err) {
    if (isMissingSchema(err)) forget0048();
    else warn("checking for due follow-ups")(err);
    return false;
  }
}
