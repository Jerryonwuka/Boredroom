/**
 * Catching up on Messages (owner decision, 8 October 2026: personal assistants, phase 3). "What did I miss in #design?",
 * "Catch me up on messages", "What did Ben say about the landing page?": the person's own assistant reads their
 * conversations for them, in her private chat only (copilot's read tools and the built-in helper). There is no HTTP route
 * of its own (review, 8 October 2026: decision 3).
 *
 * - Everything runs as the person (`withUser`): row-level security (`app_can_read_conversation`) decides what can be
 *   read, so she reads exactly what they could open themselves, and nothing here uses the worker or system role.
 * - Reading never marks anything as read: `conversation_reads` is never written here.
 * - Withdrawn messages are left out (decision 5); a task attached to a message shows only when the person can see it.
 * - The caps keep the newest: at most 200 messages and about 12,000 characters of message text per read, each message
 *   at most 2,000 characters.
 * - What she read is logged in her activity (`brenda_actions`, source 'read', migration 0037), inside the same
 *   transaction, and only once 0037 is applied. Those rows are the person's alone: owners and HR do not see them.
 *
 * The message text returned here is other people's words. The copilot hands it to the model as quoted data
 * (copilot-excerpt), never as instructions.
 */
import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { retryWithout0037, schema0037Ready } from "@/server/lib/schema-0037";
import { logAction } from "@/server/services/brenda";
import { inbox, type AuthorKind, type ConversationKind, type ConversationSummary } from "@/server/services/messaging";
import { matchPerson } from "@/server/services/assistant";

export const CATCH_UP_LIMITS = {
  messages: 200, chars: 12_000, bodyChars: 2_000, contextWhenNothingNew: 10,
  searchResults: 30, searchDays: 90, digestConversations: 5, digestLines: 3, listDefault: 30, listMax: 50,
} as const;

export type CatchUpKind = "everyone" | "team" | "channel" | "direct";
export type CatchUpConversation = {
  id: string; kind: CatchUpKind;
  /** "Everyone", "#Design" (team or named channel: "#" and its title), "Ben Okafor" (direct: the other person). */
  name: string;
  /** As the inbox counts it (a conversation marked unread counts 1). */
  unread: number;
  markedUnread: boolean; muted: boolean; archived: boolean;
  lastMessageAt: string | null; lastReadAt: string | null;
  /** `/app/<slug>/messages?c=<id>` */
  href: string;
};

export type CatchUpMessage = {
  id: string; at: string; authorKind: AuthorKind;
  author: { membershipId: string; name: string; isYou: boolean };
  /** The sender's own assistant, when the message is not the person's own words. */
  assistantName: string | null;
  /** Clamped to CATCH_UP_LIMITS.bodyChars with "…". A voice note's body is its label ("Voice note (0:42)"). */
  body: string;
  edited: boolean; voiceSeconds: number | null;
  /** Only when the person can see the task (row-level security on tasks). */
  task: { id: string; title: string } | null;
  /** The message it replies to: its author and up to 120 characters; "" when that message was withdrawn. */
  replyTo: { author: string; body: string } | null;
};

export const readConversationSchema = z.object({
  conversation: z.string().trim().min(1).max(200),
  mode: z.enum(["unread", "last", "since"]).default("unread"),
  last: z.number().int().min(1).max(200).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

export type ConversationRead = {
  conversation: CatchUpConversation;
  mode: "unread" | "last" | "since";
  /** The unread count at the time of reading (reading does not change it). */
  unreadBefore: number;
  /** Oldest first; the newest are kept when capped. */
  messages: CatchUpMessage[];
  /** Matched but left out by the caps (200 messages, 12,000 characters of message text). */
  omittedOlder: number;
  /** Mode unread with nothing new: `messages` are the last 10, for context. */
  nothingNew: boolean;
  window: { from: string | null; to: string };
};

export const searchMessagesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().trim().max(100).optional(),
  conversation: z.string().trim().max(200).optional(),
  days: z.number().int().min(1).max(365).default(90),
}).refine((v) => (v.q && v.q.length >= 2) || !!v.from, { message: "Give words to look for, or whose messages." });

export type MessageHit = CatchUpMessage & { conversation: Pick<CatchUpConversation, "id" | "name" | "kind" | "href"> };

export type CatchUpDigest = { totalUnread: number; conversations: (CatchUpConversation & { latest: CatchUpMessage[] })[] };

// ---- The person's conversations -------------------------------------------------------------------------------------

const KIND: Record<ConversationKind, CatchUpKind> = { organisation: "everyone", team: "team", channel: "channel", direct: "direct" };
const KIND_WORD: Record<CatchUpKind, string> = { everyone: "everyone", team: "team channel", channel: "channel", direct: "direct thread" };
const EVERYONE = new Set(["everyone", "everybody", "all", "organisation", "organization"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toCatchUp(ctx: OrgContext, c: ConversationSummary): CatchUpConversation {
  const kind = KIND[c.kind];
  const title = (c.title ?? "").trim();
  const name = kind === "everyone" ? "Everyone" : kind === "direct" ? title || "Someone" : `#${title}`;
  return {
    id: c.id, kind, name, unread: c.unread ?? 0, markedUnread: !!c.marked_unread, muted: !!c.muted, archived: !!c.archived_at,
    lastMessageAt: c.last_message_at ?? null, lastReadAt: c.last_read_at ?? null, href: `/app/${ctx.org.slug}/messages?c=${c.id}`,
  };
}

/**
 * The person's inbox, as read once. The copilot reads it once per chat turn and hands it to every catch-up call in that
 * turn (review, 8 October 2026), instead of each name and each read rebuilding it.
 */
export type Inbox = Awaited<ReturnType<typeof inbox>>;
/** Optional on every reader here: the inbox already read in this turn; read afresh when not given. */
export type InboxOpt = { box?: Inbox | Promise<Inbox> };
const inboxOf = async (ctx: OrgContext, o?: InboxOpt) => (o?.box ? await o.box : await inbox(ctx));

/** Channels and direct threads, and the archived channels when asked. Hidden direct threads are not in the inbox. */
function conversationsOf(ctx: OrgContext, box: Inbox, withArchived: boolean): CatchUpConversation[] {
  return [...box.channels, ...box.direct, ...(withArchived ? box.archived : [])].map((c) => toCatchUp(ctx, c));
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);
/** Unread first; most recent activity first within each group. */
const byUnreadThenRecent = (a: CatchUpConversation, b: CatchUpConversation) =>
  Number(b.unread > 0) - Number(a.unread > 0) || time(b.lastMessageAt) - time(a.lastMessageAt);

/** Unread messages over conversations that are neither muted nor archived: the Messages badge's number. */
const unreadTotal = (all: CatchUpConversation[]) => all.reduce((n, c) => n + (c.muted || c.archived ? 0 : c.unread), 0);

const clampInt = (n: number | undefined, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? (n as number) : dflt)));

/** The person's conversations, unread first (most recent activity first within each group). Names and counts only. */
export async function listCatchUp(ctx: OrgContext, opts: { unreadOnly?: boolean; limit?: number } & InboxOpt = {}): Promise<{ totalUnread: number; conversations: CatchUpConversation[] }> {
  const box = await inboxOf(ctx, opts);
  const all = conversationsOf(ctx, box, !opts.unreadOnly);
  const limit = clampInt(opts.limit, 1, CATCH_UP_LIMITS.listMax, CATCH_UP_LIMITS.listDefault);
  const conversations = all.filter((c) => !opts.unreadOnly || c.unread > 0).sort(byUnreadThenRecent).slice(0, limit);
  return { totalUnread: unreadTotal(all), conversations };
}

const label = (c: CatchUpConversation) => `${c.name} (${KIND_WORD[c.kind]})`;
const bare = (c: CatchUpConversation) => c.name.replace(/^#/, "").toLowerCase();

/** The pure part of resolveConversation, over a list already read. */
function resolveIn(all: CatchUpConversation[], nameOrId: string): CatchUpConversation | { ambiguous: string[] } | null {
  const raw = nameOrId.trim();
  if (!raw) return null;
  if (UUID.test(raw)) return all.find((c) => c.id.toLowerCase() === raw.toLowerCase()) ?? null;
  const n = raw.replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return null;
  // "the design channel", "#design team": the words around a name are tried last, after the name as written.
  const short = n.replace(/^the\s+/, "").replace(/\s+(?:team\s+)?(?:channel|chat|thread|team)$/, "").trim();
  if (EVERYONE.has(n) || EVERYONE.has(short)) return all.find((c) => c.kind === "everyone") ?? null;
  const channels = all.filter((c) => c.kind === "team" || c.kind === "channel");
  for (const name of short && short !== n ? [n, short] : [n]) {
    const exact = channels.filter((c) => bare(c) === name);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return { ambiguous: exact.map(label) };
  }
  // A person's name: the direct thread with them.
  const direct = all.filter((c) => c.kind === "direct");
  const person = matchPerson(raw.replace(/^@/, ""), direct.map((c) => ({ id: c.id, display_name: c.name })));
  if (person) return direct.find((c) => c.id === person.id) ?? null;
  // Last, a channel whose name holds the words ("design" for "#Design team").
  const partial = channels.filter((c) => bare(c).includes(short || n));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return { ambiguous: partial.map(label) };
  return null;
}

/**
 * A conversation by id or by name among the person's own: "#design"/"design" (team or channel title, case-insensitive),
 * "everyone" | "all" | "organisation" | "organization", or a person's name (the direct thread with them).
 */
export async function resolveConversation(ctx: OrgContext, nameOrId: string, opts?: InboxOpt): Promise<CatchUpConversation | { ambiguous: string[] } | null> {
  return resolveIn(conversationsOf(ctx, await inboxOf(ctx, opts), true), nameOrId);
}

// ---- Reading messages ----------------------------------------------------------------------------------------------

type MessageSqlRow = {
  id: string; at: string; conversation_id: string; author_kind: AuthorKind; sender_membership_id: string; sender_name: string | null;
  assistant_name: string | null; body: string; edited_at: string | null; voice_seconds: number | null;
  task_id: string | null; task_title: string | null;
  reply_id: string | null; reply_deleted_at: string | null; reply_body: string | null; reply_sender_name: string | null;
  reply_author_kind: AuthorKind | null; reply_assistant_name: string | null;
};

/**
 * The columns and joins every read uses, for a message `m`. `ready`: migration 0037 (who wrote it, and the sender's
 * assistant's name); before it every message is the person's. Tasks join under row-level security, so a task the person
 * cannot see reads as none.
 */
const messageColumns = (ready: boolean) => `
  m.id, m.created_at AS at, m.conversation_id, ${ready ? "m.author_kind" : "'person'::text AS author_kind"},
  m.sender_membership_id, p.display_name AS sender_name,
  ${ready ? "CASE WHEN m.author_kind <> 'person' THEN COALESCE(ap.name, 'Brenda') END" : "NULL::text"} AS assistant_name,
  m.body, m.edited_at, m.voice_seconds, t.id AS task_id, t.title AS task_title,
  rm.id AS reply_id, rm.deleted_at AS reply_deleted_at, rm.body AS reply_body, rp.display_name AS reply_sender_name,
  ${ready ? "rm.author_kind" : "CASE WHEN rm.id IS NULL THEN NULL ELSE 'person' END"} AS reply_author_kind,
  ${ready ? "CASE WHEN rm.author_kind <> 'person' THEN COALESCE(rap.name, 'Brenda') END" : "NULL::text"} AS reply_assistant_name`;
const messageJoins = (ready: boolean) => `
  JOIN memberships sm ON sm.id = m.sender_membership_id
  LEFT JOIN profiles p ON p.id = sm.user_id
  LEFT JOIN tasks t ON t.id = m.task_id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN memberships rsm ON rsm.id = rm.sender_membership_id
  LEFT JOIN profiles rp ON rp.id = rsm.user_id
  ${ready ? `LEFT JOIN assistant_profiles ap ON ap.membership_id = m.sender_membership_id
  LEFT JOIN assistant_profiles rap ON rap.membership_id = rm.sender_membership_id` : ""}`;

/** Cuts text to `max` characters, ending with "…", without splitting a character made of two code units. */
function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max - 1;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${s.slice(0, cut)}…`;
}

function toMessage(r: MessageSqlRow, me: string): CatchUpMessage {
  const replyAuthor = r.reply_author_kind === "assistant" ? r.reply_assistant_name : r.reply_sender_name;
  return {
    id: r.id, at: r.at, authorKind: r.author_kind,
    author: { membershipId: r.sender_membership_id, name: r.sender_name ?? "Someone", isYou: r.sender_membership_id === me },
    assistantName: r.author_kind !== "person" ? r.assistant_name ?? "Brenda" : null,
    body: clampText(r.body ?? "", CATCH_UP_LIMITS.bodyChars),
    edited: !!r.edited_at, voiceSeconds: r.voice_seconds ?? null,
    task: r.task_id ? { id: r.task_id, title: r.task_title ?? "" } : null,
    replyTo: r.reply_id ? { author: replyAuthor ?? "Someone", body: r.reply_deleted_at ? "" : clampText(r.reply_body ?? "", 120) } : null,
  };
}

/** Rows newest first, kept while the running total of (clamped) message text stays within the cap. */
function keepNewest(rows: MessageSqlRow[], me: string): CatchUpMessage[] {
  const kept: CatchUpMessage[] = [];
  let chars = 0;
  for (const r of rows.slice(0, CATCH_UP_LIMITS.messages)) {
    const m = toMessage(r, me);
    if (kept.length && chars + m.body.length > CATCH_UP_LIMITS.chars) break;
    chars += m.body.length;
    kept.push(m);
  }
  return kept;
}

function parseOr<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of r.error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
    throw invalid(r.error.issues[0]?.message ?? "Check the request.", fieldErrors);
  }
  return r.data;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Tue 6 Oct, 09:00" in the organisation's time zone. */
function shortWhen(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** How a read is listed in the person's activity (owner decision, 8 October 2026: personal assistants, phase 3). */
function readSummary(conv: CatchUpConversation, read: { mode: ConversationRead["mode"]; count: number; nothingNew: boolean; since?: string }, timeZone: string): string {
  const where = conv.kind === "direct" ? `your messages with ${conv.name}` : conv.name;
  if (read.mode === "unread") {
    if (read.nothingNew) return `Read ${where} (nothing new; the last ${read.count === 1 ? "message" : `${read.count} messages`})`;
    return conv.kind === "direct" ? `Read ${where} (${read.count} new)` : `Read ${where} (${plural(read.count, "new message")})`;
  }
  if (read.mode === "last") return `Read the last ${read.count === 1 ? "message" : `${read.count} messages`} ${conv.kind === "direct" ? `with ${conv.name}` : `in ${conv.name}`}`;
  return `Read ${where} since ${shortWhen(read.since!, timeZone)} (${plural(read.count, "message")})`;
}

/** One 'read' row in the person's activity, in the caller's transaction; nothing before migration 0037. */
async function logRead(db: Db, ctx: OrgContext, ready: boolean, tool: "read_conversation" | "search_messages", summary: string, detail: Record<string, unknown>) {
  if (!ready) return;
  await logAction(db, ctx, { tool, summary, outcome: "done", source: "read", detail });
}

/**
 * Recent messages in one of the person's conversations: since they last read it (the default; the last 10 for context
 * when nothing is new), the last N, or since a time. Null when there is no such conversation for this person (not a
 * member, another organisation, a bad id). Throws invalid() for a bad input (mode since without since). Logs one 'read'
 * activity row when it returned any message.
 */
export async function readConversation(ctx: OrgContext, input: z.input<typeof readConversationSchema>, opts?: InboxOpt): Promise<ConversationRead | { ambiguous: string[] } | null> {
  const q = parseOr(readConversationSchema, input);
  if (q.mode === "since" && !q.since) throw invalid("Say from when to read: mode since needs since.", { since: ["Required for mode since."] });
  const found = resolveIn(conversationsOf(ctx, await inboxOf(ctx, opts), true), q.conversation);
  if (!found || "ambiguous" in found) return found;
  const conv = found;
  const me = ctx.membership.id;
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    const ready = await schema0037Ready(db);
    const to = new Date().toISOString();
    const base = `SELECT ${messageColumns(ready)}, count(*) OVER ()::int AS total FROM messages m ${messageJoins(ready)} WHERE m.conversation_id = $1 AND m.deleted_at IS NULL`;
    const order = `ORDER BY m.created_at DESC, m.id DESC`;
    let rows: (MessageSqlRow & { total: number })[];
    let from: string | null = null;
    if (q.mode === "unread") {
      // Since the person's own last read, else since they joined (as the inbox counts unread).
      const since = `COALESCE((SELECT last_read_at FROM conversation_reads WHERE conversation_id = $1 AND membership_id = $2), (SELECT created_at FROM memberships WHERE id = $2))`;
      from = (await db.one<{ at: string }>(`SELECT ${since} AS at`, [conv.id, me])).at;
      rows = await db.query(`${base} AND m.created_at > ${since} ${order} LIMIT ${CATCH_UP_LIMITS.messages}`, [conv.id, me]);
    } else if (q.mode === "last") {
      const n = Math.min(q.last ?? 30, CATCH_UP_LIMITS.messages);
      rows = await db.query(`${base} ${order} LIMIT $2`, [conv.id, n]);
      rows = rows.map((r) => ({ ...r, total: rows.length }));
    } else {
      from = new Date(q.since!).toISOString();
      rows = await db.query(`${base} AND m.created_at > $2::timestamptz ${order} LIMIT ${CATCH_UP_LIMITS.messages}`, [conv.id, q.since]);
    }
    let messages = keepNewest(rows, me);
    let omittedOlder = (rows[0]?.total ?? 0) - messages.length;
    let nothingNew = false;
    if (q.mode === "unread" && rows.length === 0) {
      // Nothing new: the last few messages, so the answer has some context.
      nothingNew = true;
      const recent = await db.query<MessageSqlRow & { total: number }>(`${base} ${order} LIMIT ${CATCH_UP_LIMITS.contextWhenNothingNew}`, [conv.id]);
      messages = keepNewest(recent, me);
      omittedOlder = 0;
    }
    messages.reverse();
    if (messages.length) {
      const summary = readSummary(conv, { mode: q.mode, count: messages.length, nothingNew, since: from ?? undefined }, ctx.org.timezone);
      await logRead(db, ctx, ready, "read_conversation", summary, { conversationId: conv.id, count: messages.length, mode: q.mode, href: conv.href });
    }
    return { conversation: conv, mode: q.mode, unreadBefore: conv.unread, messages, omittedOlder: Math.max(0, omittedOlder), nothingNew, window: { from: nothingNew ? null : from, to } };
  }));
}

// ---- Searching -------------------------------------------------------------------------------------------------------

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/**
 * The words to look for, without a leading "the", "a" or "an" (review, 8 October 2026): "the instructions" finds
 * "ignore previous instructions", as "instructions" does. The rest is matched as written, as one phrase.
 */
export function searchWords(q: string | undefined | null): string | null {
  const t = (q ?? "").trim().replace(/\s+/g, " ");
  const bare = t.replace(/^(?:the|a|an)\s+(?=\S)/i, "");
  return bare.length >= 2 ? bare : t.length >= 2 ? t : null;
}
const ME = new Set(["me", "myself", "i", "you", "mine"]);

/**
 * Messages the person can read, by words (`q`), by who wrote them (`from`), or both, optionally in one conversation,
 * from the last `days` days (90 by default), newest first, at most 30; `total` is how many matched. `error` (words for
 * the model) for an unknown person or conversation. Withdrawn messages and hidden direct threads are left out. Logs one
 * 'read' activity row when it found anything.
 */
export async function searchMessages(ctx: OrgContext, input: z.input<typeof searchMessagesSchema>, opts?: InboxOpt): Promise<{ hits: MessageHit[]; total: number; error?: string; words?: string | null; fromName?: string | null }> {
  const q = parseOr(searchMessagesSchema, input);
  const words = searchWords(q.q);
  let conv: CatchUpConversation | null = null;
  if (q.conversation) {
    const r = resolveIn(conversationsOf(ctx, await inboxOf(ctx, opts), true), q.conversation);
    if (!r) return { hits: [], total: 0, error: `No conversation called “${q.conversation}” that the person is in.` };
    if ("ambiguous" in r) return { hits: [], total: 0, error: `Which one? ${r.ambiguous.join(" or ")}.` };
    conv = r;
  }
  const me = ctx.membership.id;
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    let from: { id: string; display_name: string } | null = null;
    if (q.from) {
      const people = await db.query<{ id: string; display_name: string }>(
        `SELECT m.id, p.display_name FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = $1 AND (m.status = 'active' OR m.id = $2) ORDER BY p.display_name`,
        [ctx.org.id, me]);
      from = ME.has(q.from.toLowerCase()) ? people.find((p) => p.id === me) ?? null : matchPerson(q.from.replace(/^@/, ""), people);
      if (!from) return { hits: [], total: 0, error: `No one called “${q.from}” in this workspace.` };
    }
    const ready = await schema0037Ready(db);
    const rows = await db.query<MessageSqlRow & { total: number; conv_kind: ConversationKind; conv_title: string | null; conv_other: string | null }>(
      `SELECT ${messageColumns(ready)}, c.kind AS conv_kind,
              CASE c.kind WHEN 'team' THEN tm.name WHEN 'channel' THEN c.title END AS conv_title,
              CASE WHEN c.kind = 'direct' THEN (SELECT op.display_name FROM conversation_participants ocp JOIN memberships om ON om.id = ocp.membership_id JOIN profiles op ON op.id = om.user_id
                                               WHERE ocp.conversation_id = c.id AND ocp.membership_id <> $2 LIMIT 1) END AS conv_other,
              count(*) OVER ()::int AS total
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN teams tm ON tm.id = c.team_id
       ${messageJoins(ready)}
       WHERE m.organisation_id = $1 AND m.deleted_at IS NULL AND m.created_at > now() - make_interval(days => $3::int)
         AND ($4::text IS NULL OR m.body ILIKE '%' || $4 || '%' ESCAPE '\\')
         AND ($5::uuid IS NULL OR m.sender_membership_id = $5)
         AND ($6::uuid IS NULL OR m.conversation_id = $6)
         AND (tm.id IS NULL OR tm.archived_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = $2)
       ORDER BY m.created_at DESC, m.id DESC LIMIT ${CATCH_UP_LIMITS.searchResults}`,
      [ctx.org.id, me, q.days, words ? likeEscape(words) : null, from?.id ?? null, conv?.id ?? null]);
    const hits: MessageHit[] = rows.map((r) => {
      const kind = KIND[r.conv_kind];
      const name = kind === "everyone" ? "Everyone" : kind === "direct" ? r.conv_other ?? "Someone" : `#${r.conv_title ?? ""}`;
      return { ...toMessage(r, me), conversation: { id: r.conversation_id, name, kind, href: `/app/${ctx.org.slug}/messages?c=${r.conversation_id}` } };
    });
    const total = rows[0]?.total ?? 0;
    if (hits.length) {
      const where = conv ? (conv.kind === "direct" ? `your messages with ${conv.name}` : conv.name) : "your messages";
      const summary = `Searched ${where}${from ? ` from ${from.id === me ? "you" : from.display_name}` : ""}${words ? ` for “${words}”` : ""} (${total} found)`;
      await logRead(db, ctx, ready, "search_messages", summary, { count: hits.length, total, ...(conv ? { conversationId: conv.id } : {}), href: conv?.href ?? `/app/${ctx.org.slug}/messages` });
    }
    // What was searched for, as matched: the words without a leading article, and the person's full name.
    return { hits, total, words, fromName: from ? (from.id === me ? "you" : from.display_name) : null };
  }));
}

// ---- The built-in helper's digest ---------------------------------------------------------------------------------------

/**
 * For the built-in helper: the unread conversations (at most 5, not muted or archived, busiest first) with their latest
 * 3 unread lines each (oldest first). Logs one 'read' row when it returned any line.
 */
export async function catchUpDigest(ctx: OrgContext, opts: { conversations?: number; lines?: number } = {}): Promise<CatchUpDigest> {
  const all = conversationsOf(ctx, await inbox(ctx), false);
  const totalUnread = unreadTotal(all);
  const n = clampInt(opts.conversations, 1, 20, CATCH_UP_LIMITS.digestConversations);
  const lines = clampInt(opts.lines, 1, 20, CATCH_UP_LIMITS.digestLines);
  const chosen = all.filter((c) => c.unread > 0 && !c.muted && !c.archived)
    .sort((a, b) => b.unread - a.unread || time(b.lastMessageAt) - time(a.lastMessageAt)).slice(0, n);
  if (!chosen.length) return { totalUnread, conversations: [] };
  const me = ctx.membership.id;
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    const ready = await schema0037Ready(db);
    const rows = await db.query<MessageSqlRow>(
      `SELECT * FROM (
         SELECT ${messageColumns(ready)}, row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC, m.id DESC) AS rn
         FROM messages m
         LEFT JOIN conversation_reads cr ON cr.conversation_id = m.conversation_id AND cr.membership_id = $2
         ${messageJoins(ready)}
         WHERE m.conversation_id = ANY($1::uuid[]) AND m.deleted_at IS NULL
           AND m.created_at > COALESCE(cr.last_read_at, (SELECT created_at FROM memberships WHERE id = $2))
       ) x WHERE rn <= $3 ORDER BY at, id`,
      [chosen.map((c) => c.id), me, lines]);
    const conversations = chosen.map((c) => ({ ...c, latest: rows.filter((r) => r.conversation_id === c.id).map((r) => toMessage(r, me)) }));
    const read = conversations.reduce((k, c) => k + c.latest.length, 0);
    if (read) {
      const unread = chosen.reduce((k, c) => k + c.unread, 0);
      await logRead(db, ctx, ready, "read_conversation", `Caught you up on ${plural(chosen.length, "conversation")} (${plural(unread, "new message")})`,
        { count: read, mode: "digest", conversationIds: chosen.map((c) => c.id), href: `/app/${ctx.org.slug}/messages` });
    }
    return { totalUnread, conversations };
  }));
}
