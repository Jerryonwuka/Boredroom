/**
 * The workspace's assistant noticing commitments in tracked group conversations (owner decisions, 8 October 2026: phase
 * 7b, "Brenda keeps the loops closed", second part; contract B.3). Every few minutes, for an organisation whose owner or
 * HR turned on "Track commitments in group chats", the worker reads what was said since its last look in each tracked
 * conversation (channels, team chats, Everyone; never a direct thread), keeps the messages the prefilter scores 0.35 or
 * more, asks the model about them in batches (quoted data, no tools, structured output; commitment-classify.ts) and
 * hands what it found to the commitments service (commitments.ts: the proposals, the "Noted" labels, the committers'
 * inbox items). Without the model (no AI, the plan, the organisation's daily cap, a batch with no usable answer), only
 * the messages the prefilter scores 0.7 or more, with the work and the date read from the words.
 *
 * - Bounded: 200 messages a run for the organisation (oldest first), from the later of the conversation's cursor, when
 *   tracking was last turned on, and 24 hours ago; 25 lines a model call, 4 calls a run, 200 calls a day for the
 *   organisation, recorded as the workspace's own usage (purpose 'commitments', no person: nobody's allowance is spent).
 * - Every person handed on is a current reader of the conversation (app_conversation_readers), the committer never the
 *   asker; a message can only commit its own writer.
 * - Nothing here notifies or labels anything: commitments.ts does, after its own checks (the switches, the limits, mutes).
 * - Before migration 0048, or with the switch off, it returns at once.
 *
 * The helpers that build a batch (`classifyLinesFor`, `numberBatches`) are shared with the person's own loose-ends scan
 * (loose-end-detect.ts).
 *
 * The async standup (owner decisions, 8–9 October 2026: phase 7c): a posted standup is the day's plan, not a promise, so
 * after migration 0050 neither scan reads a message that is one (`scanFilter({ standups: true })`); before 0050 the
 * clause is left out (there are none).
 */
import { withWorker, type Db } from "@/server/db";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { forget0048, isMissingSchema, schema0048Ready } from "@/server/lib/schema-0048";
import { forget0049, schema0049Ready } from "@/server/lib/schema-0049";
import { forget0050, schema0050Ready } from "@/server/lib/schema-0050";
import { addDays, localDate, localMidnight, localTimeOn, todayLocal, weekdayOf } from "@/server/lib/time";
import { resolveAssistant, type AssistantConnection } from "@/server/services/assistant";
import { newRequestId, recordWorkspaceUsage } from "@/server/services/ai-usage";
import { whenOf } from "@/server/services/assistant-talk-intent";
import { builtinTitle, prefilter, type PrefilterInput, type PrefilterResult, type Reader } from "@/server/services/commitment-prefilter";
import { classifyBatch, type Classified, type ClassifyLine, type ClassifyParticipant } from "@/server/services/commitment-classify";
import { namesPerson } from "@/server/services/routine-templates";
import { LOOP_LIMITS, type DetectedCommitment } from "@/lib/commitments";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = "00000000-0000-0000-0000-000000000000";
/** Messages newer than this are left for the next look: a sender's transaction may not have committed yet. */
const SETTLE_SECONDS = 10;
const warn = (what: string) => (err: unknown) => console.warn(`[commitments] ${what}: ${(err as Error)?.message ?? String(err)}`);

// ---- What a scan reads ------------------------------------------------------------------------------------------------

/** A message as the scans read it, with what came just before it and what it replies to (context for the model). */
export type ScanContext = { id: string; authorMembershipId: string; body: string; at: string; mentions: string[] };
export type ScanMessage = ScanContext & {
  conversationId: string; conversationKind: "direct" | "team" | "organisation" | "channel"; conversationName: string;
  replyToId: string | null; reply: ScanContext | null; previous: ScanContext | null;
};

/**
 * The message columns and context joins both scans read (`m` a message; `c` its conversation; `tm` its team). Only words
 * people wrote themselves (or had their assistant send for them): never an assistant's own, never a voice note, never a
 * withdrawn one, and never a message that tags an assistant (that is a command to it, not a commitment).
 */
export const SCAN_COLUMNS = `
  m.id, m.conversation_id, c.kind AS conversation_kind,
  CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || COALESCE(tm.name, 'team') WHEN 'channel' THEN '#' || COALESCE(c.title, 'channel') ELSE NULL END AS conversation_name,
  m.sender_membership_id AS author, m.body, m.created_at AS at, m.reply_to_id,
  COALESCE((SELECT array_agg(mm.membership_id) FROM message_mentions mm WHERE mm.message_id = m.id AND mm.kind = 'person'), '{}') AS mentions,
  r.id AS r_id, r.sender_membership_id AS r_author, r.body AS r_body, r.created_at AS r_at,
  COALESCE((SELECT array_agg(mm.membership_id) FROM message_mentions mm WHERE mm.message_id = r.id AND mm.kind = 'person'), '{}') AS r_mentions,
  pv.id AS p_id, pv.sender_membership_id AS p_author, pv.body AS p_body, pv.created_at AS p_at,
  COALESCE((SELECT array_agg(mm.membership_id) FROM message_mentions mm WHERE mm.message_id = pv.id AND mm.kind = 'person'), '{}') AS p_mentions`;
/**
 * The context joins. `floor` (an SQL expression, optional): no context line older than it, so the workspace's scan never
 * hands the model words said before tracking was turned on, or while a conversation's own switch was off (review,
 * 9 October 2026).
 */
export function scanJoins(floor?: string): string {
  const r = floor ? ` AND r.created_at >= ${floor}` : "";
  const p = floor ? ` AND p.created_at >= ${floor}` : "";
  return `
  LEFT JOIN messages r ON r.id = m.reply_to_id AND r.deleted_at IS NULL AND r.author_kind IN ('person', 'via_assistant')${r}
  LEFT JOIN LATERAL (
    SELECT p.id, p.sender_membership_id, p.body, p.created_at FROM messages p
    WHERE p.conversation_id = m.conversation_id AND p.deleted_at IS NULL AND p.author_kind IN ('person', 'via_assistant')
      AND (p.created_at, p.id) < (m.created_at, m.id)${p}
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1) pv ON true`;
}
export const SCAN_JOINS = scanJoins();
/** The filter every scanned message passes. */
export const SCAN_FILTER = `m.deleted_at IS NULL AND m.voice_key IS NULL AND m.author_kind IN ('person', 'via_assistant')
  AND NOT EXISTS (SELECT 1 FROM message_mentions am WHERE am.message_id = m.id AND am.kind = 'assistant')`;
/** Not a posted standup (migration 0050; owner decisions, 8–9 October 2026: a plan for the day is not a promise). */
export const STANDUP_POST_FILTER = `NOT EXISTS (SELECT 1 FROM standup_entries se WHERE se.message_id = m.id)`;
/** SCAN_FILTER, and after migration 0050 (`standups`) never a posted standup. */
export const scanFilter = (o: { standups: boolean }) => (o.standups ? `${SCAN_FILTER}\n  AND ${STANDUP_POST_FILTER}` : SCAN_FILTER);

export type ScanRow = {
  id: string; conversation_id: string; conversation_kind: ScanMessage["conversationKind"]; conversation_name: string | null;
  author: string; body: string; at: string; reply_to_id: string | null; mentions: string[];
  r_id: string | null; r_author: string | null; r_body: string | null; r_at: string | null; r_mentions: string[];
  p_id: string | null; p_author: string | null; p_body: string | null; p_at: string | null; p_mentions: string[];
};

export function scanMessageOf(r: ScanRow): ScanMessage {
  const ctx = (id: string | null, author: string | null, body: string | null, at: string | null, mentions: string[]): ScanContext | null =>
    id && author && at ? { id, authorMembershipId: author, body: body ?? "", at: new Date(at).toISOString(), mentions: mentions ?? [] } : null;
  return {
    id: r.id, conversationId: r.conversation_id, conversationKind: r.conversation_kind,
    conversationName: r.conversation_name ?? "Messages", authorMembershipId: r.author, body: r.body ?? "", at: new Date(r.at).toISOString(),
    mentions: r.mentions ?? [], replyToId: r.reply_to_id,
    reply: ctx(r.r_id, r.r_author, r.r_body, r.r_at, r.r_mentions), previous: ctx(r.p_id, r.p_author, r.p_body, r.p_at, r.p_mentions),
  };
}

/** The prefilter's input for a scanned message. */
export function prefilterInputOf(m: ScanMessage): PrefilterInput {
  return {
    id: m.id, body: m.body, authorMembershipId: m.authorMembershipId, at: m.at, conversationKind: m.conversationKind, mentions: m.mentions,
    replyTo: m.reply ? { id: m.reply.id, authorMembershipId: m.reply.authorMembershipId, body: m.reply.body, at: m.reply.at, mentions: m.reply.mentions } : null,
    previous: m.previous ? { id: m.previous.id, authorMembershipId: m.previous.authorMembershipId, body: m.previous.body, at: m.previous.at, mentions: m.previous.mentions } : null,
  };
}

// ---- Batches for the model ------------------------------------------------------------------------------------------------

/** One line of a batch before it is numbered: a candidate, or the context of one. */
export type BatchLine = { messageId: string; conversationId: string; conversationName: string; at: string; authorMembershipId: string; body: string; replyToId: string | null; candidate: boolean };
export type Batch = { lines: ClassifyLine[]; people: ClassifyParticipant[]; byN: Map<number, BatchLine> };

/**
 * Each candidate with its context (the message it replies to and the one before it, at most 2), as groups of lines,
 * oldest candidate first. A message that is a candidate anywhere is a candidate line.
 */
export function classifyLinesFor(candidates: ScanMessage[]): BatchLine[][] {
  const isCandidate = new Set(candidates.map((c) => c.id));
  const lineOf = (m: ScanMessage, ctx: ScanContext | null, which: "self" | "ctx"): BatchLine | null => {
    if (which === "self") return { messageId: m.id, conversationId: m.conversationId, conversationName: m.conversationName, at: m.at, authorMembershipId: m.authorMembershipId, body: m.body, replyToId: m.replyToId, candidate: true };
    if (!ctx) return null;
    return { messageId: ctx.id, conversationId: m.conversationId, conversationName: m.conversationName, at: ctx.at, authorMembershipId: ctx.authorMembershipId, body: ctx.body, replyToId: null, candidate: isCandidate.has(ctx.id) };
  };
  return [...candidates].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)).map((m) => {
    const group = [lineOf(m, m.reply, "ctx"), lineOf(m, m.previous, "ctx")].filter((x): x is BatchLine => !!x).slice(0, LOOP_LIMITS.contextMessages);
    return [...group.filter((l, i, a) => a.findIndex((x) => x.messageId === l.messageId) === i && l.messageId !== m.id), lineOf(m, null, "self")!];
  });
}

/**
 * Packs the groups into batches of at most `perCall` lines (a group never split), numbers each batch's lines by time,
 * and gives every person in it a participant number: the lines' writers, then `extra(line)` (people a line names).
 * `names`: display names by membership id.
 *
 * A batch only ever holds ONE conversation's lines (security review, 9 October 2026): whatever the model writes as a
 * line's work becomes a title its writer reads, so a line must never sit beside words from a conversation its writer
 * cannot read (a private channel), nor the names of the people in it. Conversations come in the order of their first
 * candidate.
 */
export function numberBatches(groups: BatchLine[][], o: { perCall: number; names: Map<string, string>; extra?: (l: BatchLine) => string[] }): Batch[] {
  const packs: BatchLine[][] = [];
  const byConversation = new Map<string, BatchLine[][]>();
  for (const g of groups) {
    const conv = g[g.length - 1]?.conversationId ?? "";
    // Every line of a group is its candidate's conversation's (classifyLinesFor); a stray line is left out.
    const same = g.filter((l) => l.conversationId === conv);
    if (!same.length) continue;
    byConversation.set(conv, [...(byConversation.get(conv) ?? []), same]);
  }
  for (const convGroups of byConversation.values()) {
    let cur = new Map<string, BatchLine>();
    for (const g of convGroups) {
      const fresh = g.filter((l) => !cur.has(l.messageId));
      if (cur.size && cur.size + fresh.length > o.perCall) { packs.push([...cur.values()]); cur = new Map(); }
      for (const l of g) {
        const had = cur.get(l.messageId);
        cur.set(l.messageId, had ? { ...had, candidate: had.candidate || l.candidate } : l);
      }
    }
    if (cur.size) packs.push([...cur.values()]);
  }
  return packs.map((pack) => {
    const sorted = pack.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.messageId.localeCompare(b.messageId));
    const nOf = new Map(sorted.map((l, i) => [l.messageId, i + 1]));
    const pOf = new Map<string, number>();
    const person = (id: string) => { if (id && !pOf.has(id)) pOf.set(id, pOf.size + 1); return pOf.get(id)!; };
    for (const l of sorted) person(l.authorMembershipId);
    for (const l of sorted) for (const id of o.extra?.(l) ?? []) if (UUID.test(id)) person(id);
    const lines: ClassifyLine[] = sorted.map((l, i) => ({
      n: i + 1, candidate: l.candidate, at: l.at, conversation: l.conversationName, writer: person(l.authorMembershipId), body: l.body,
      replyTo: l.replyToId && nOf.has(l.replyToId) ? nOf.get(l.replyToId)! : null,
    }));
    const people: ClassifyParticipant[] = [...pOf].map(([membershipId, p]) => ({ p, membershipId, name: o.names.get(membershipId) ?? "Someone" }));
    return { lines, people, byN: new Map(sorted.map((l, i) => [i + 1, l])) };
  });
}

/** Words too common to show that a title came from a line. */
const COMMON = new Set(["the", "and", "for", "with", "you", "your", "yours", "will", "can", "this", "that", "them", "they", "their", "our", "ours",
  "from", "have", "has", "had", "are", "was", "were", "been", "its", "it's", "his", "her", "him", "she", "who", "what", "when", "then", "than",
  "there", "here", "about", "into", "onto", "over", "just", "also", "please", "thanks", "today", "tomorrow", "by", "before", "after", "some", "all",
  "any", "get", "got", "let", "me", "my", "i'll", "i'm", "we", "us", "not", "but", "out", "off", "on", "to", "of", "in", "at", "a", "an", "is", "be", "do"]);
const contentKeys = (s: string) => new Set(String(s ?? "").toLowerCase().normalize("NFKC").replace(/[’`]/g, "'").split(/[^\p{L}\p{N}']+/u)
  .map((w) => w.replace(/^'+|'+$/g, "")).filter((w) => w.length >= 3 && !COMMON.has(w)).map((w) => (w.length >= 4 ? w.slice(0, 4) : w)));

/**
 * Whether the work the model wrote for a line comes from that line or its context (security review, 9 October 2026):
 * at least one word in common (the first four letters of a word of three or more, common words aside). A title made of
 * other words (another line's, or words a message told the model to use) is not kept.
 */
export function whatFromLines(what: string, bodies: (string | null | undefined)[]): boolean {
  const want = contentKeys(what);
  if (!want.size) return false;
  const have = new Set<string>();
  for (const b of bodies) for (const k of contentKeys(b ?? "")) have.add(k);
  for (const k of want) if (have.has(k)) return true;
  return false;
}

const WEEKDAY_SHORT: Record<string, string> = {
  mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", weds: "wednesday", thu: "thursday", thur: "thursday", thurs: "thursday",
  fri: "friday", sat: "saturday", sun: "sunday",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The due time of date words as people write them (correctness review, 9 October 2026): what assistant-talk's whenOf
 * reads, plus the short forms the prefilter recognises ("by fri", "tmrw", "eod", "cob", "eow", "tonight", "this
 * afternoon", "this week", "next week", "end of the month", "12th oct"). 17:00 unless the words say a part of the day;
 * in `timeZone`, from `now` (the message's time). Null for words that are not a time ("asap") or one already past.
 */
export function dueFromWords(words: string | null | undefined, o: { timeZone: string; now: Date }): string | null {
  if (!words) return null;
  let w = String(words).toLowerCase().replace(/[.,!?]+$/, "").replace(/\s+/g, " ").trim()
    .replace(/^(?:by|before|due|for|until|on)\s+/, "").replace(/^the\s+/, "");
  if (!w) return null;
  w = w.replace(/^(?:(next|this)\s+)?(mon|tues?|weds?|thu(?:rs?)?|fri|sat|sun)$/, (_all, pre: string | undefined, d: string) => `${pre ? `${pre} ` : ""}${WEEKDAY_SHORT[d]}`);
  if (/^(?:tmrw|tmr|tomorow|tmrow)$/.test(w)) w = "tomorrow";
  else if (/^(?:eod|cob|close of (?:business|play)|end of (?:the )?day)$/.test(w)) w = "today";
  else if (/^(?:eow|end of (?:the )?week|this week)$/.test(w)) w = "friday";
  else if (w === "tonight") w = "today evening";
  else {
    const part = /^this (morning|afternoon|evening)$/.exec(w);
    if (part) w = `today ${part[1]}`;
  }
  const at17 = (date: string) => {
    const t = localTimeOn(date, "17:00", o.timeZone);
    return t.getTime() > o.now.getTime() ? t.toISOString() : null;
  };
  const today = localDate(o.now, o.timeZone);
  if (w === "next week") {
    const dow = weekdayOf(today);
    const toMonday = ((8 - dow) % 7) || 7;
    return at17(addDays(today, toMonday + 4));
  }
  if (/^end of (?:the )?month$/.test(w)) {
    const [y, m] = today.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return at17(`${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
  }
  const dm = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]{3})[a-z]*$/.exec(w) ?? (() => {
    const md = /^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?$/.exec(w);
    return md ? [md[0], md[2], md[1]] as unknown as RegExpExecArray : null;
  })();
  if (dm) {
    const month = MONTHS.indexOf(dm[2]);
    const day = Number(dm[1]);
    if (month < 0 || day < 1 || day > 31) return null;
    const [y] = today.split("-").map(Number);
    for (const year of [y, y + 1]) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (new Date(`${date}T00:00:00Z`).getUTCDate() !== day) return null;
      const at = at17(date);
      if (at) return at;
    }
    return null;
  }
  const at = whenOf(w, o);
  return at ? new Date(at).toISOString() : null;
}

/** The readers a line's words name (the full name, or a first name of at least 3 letters, as a whole word). */
export function namedIn(body: string, readers: Reader[]): string[] {
  return readers.filter((r) => namesPerson(body, r.name)).map((r) => r.membershipId);
}

// ---- Which organisations to look at ---------------------------------------------------------------------------------------

/**
 * Organisations with tracking on and something new in a tracked conversation since its cursor (and since tracking was
 * turned on, within the last 24 hours): the scheduler queues one `commitments.scan` each. Nothing before 0048.
 */
export async function trackedOrgsDue(o: { now?: Date } = {}): Promise<{ organisationId: string }[]> {
  const now = o.now ?? new Date();
  try {
    return await withWorker(async (db) => {
      if (!(await schema0048Ready(db))) return [];
      const rows = await db.query<{ organisation_id: string }>(
        `SELECT DISTINCT c.organisation_id FROM conversations c
         JOIN organisations o ON o.id = c.organisation_id AND o.status = 'active'
         JOIN brenda_settings b ON b.organisation_id = c.organisation_id AND b.track_commitments
         LEFT JOIN commitment_scan_cursors cur ON cur.conversation_id = c.id
         WHERE c.kind IN ('team', 'organisation', 'channel') AND c.track_commitments AND c.archived_at IS NULL
           AND c.last_message_at > COALESCE(cur.last_created_at, '-infinity'::timestamptz)
           AND c.last_message_at > GREATEST(COALESCE(b.track_commitments_since, '-infinity'::timestamptz), $1::timestamptz - make_interval(hours => $2))
         LIMIT 500`, [now.toISOString(), LOOP_LIMITS.scanWindowHours]);
      return rows.map((r) => ({ organisationId: r.organisation_id }));
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0048();
    return [];
  }
}

// ---- One organisation's scan ----------------------------------------------------------------------------------------------

type Conv = { id: string; last_created_at: string | null; last_message_id: string | null; last_message_at: string | null };
type Pre = { status: "off" | "not_ready" } | {
  status: "ready"; tz: string; messages: ScanMessage[]; convs: Conv[]; capped: boolean; cutoff: string;
  readers: Map<string, Reader[]>; names: Map<string, string>; ai: boolean; usedToday: number;
};

export type ScanOutcome = { status: "done" | "off" | "not_ready"; read: number; candidates: number; created: number; agreed: number; engine: "claude" | "builtin" | "none" };

/** Today's workspace calls for commitments in the organisation's day. */
async function workspaceCallsToday(db: Db, orgId: string, tz: string, now: Date): Promise<number> {
  const r = await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM ai_usage WHERE organisation_id = $1 AND membership_id IS NULL AND purpose = 'commitments' AND created_at >= $2::timestamptz`,
    [orgId, localMidnight(todayLocal(tz, now), tz).toISOString()]);
  return r.n;
}

/**
 * One organisation's look at its tracked group conversations (the `commitments.scan` job). Never throws for a missing
 * schema; a model that fails falls back to the built-in rules for that batch.
 */
export async function scanWorkspaceCommitments(organisationId: string, o: { now?: Date; useModel?: boolean } = {}): Promise<ScanOutcome> {
  const now = o.now ?? new Date();
  const nothing = (status: ScanOutcome["status"]): ScanOutcome => ({ status, read: 0, candidates: 0, created: 0, agreed: 0, engine: "none" });
  if (!UUID.test(organisationId)) return nothing("off");
  let pre: Pre;
  try {
    pre = await withWorker(async (db): Promise<Pre> => {
      if (!(await schema0048Ready(db))) return { status: "not_ready" };
      const org = await db.maybeOne<{ timezone: string; status: string; track: boolean; since: string | null }>(
        `SELECT o.timezone, o.status, COALESCE(b.track_commitments, false) AS track, b.track_commitments_since AS since
         FROM organisations o LEFT JOIN brenda_settings b ON b.organisation_id = o.id WHERE o.id = $1`, [organisationId]);
      if (!org || org.status !== "active" || !org.track) return { status: "off" };
      const cutoff = new Date(now.getTime() - SETTLE_SECONDS * 1000).toISOString();
      const floor = new Date(Math.max(now.getTime() - LOOP_LIMITS.scanWindowHours * 3_600_000, org.since ? Date.parse(org.since) : 0)).toISOString();
      // Nothing said before tracking was turned on is read, as a candidate or as context: the workspace's time, and (0049)
      // the time the conversation's own switch was last turned back on (review, 9 October 2026).
      const v49 = await schema0049Ready(db);
      // Phase 7c: posted standups are left out once they exist (migration 0050).
      const v50 = await schema0050Ready(db);
      const convSince = v49 ? `COALESCE(c.track_commitments_since, '-infinity'::timestamptz)` : `'-infinity'::timestamptz`;
      const contextFloor = `GREATEST($6::timestamptz, ${convSince})`;
      const convs = await db.query<Conv>(
        `SELECT c.id, cur.last_created_at, cur.last_message_id, c.last_message_at
         FROM conversations c LEFT JOIN commitment_scan_cursors cur ON cur.conversation_id = c.id
         WHERE c.organisation_id = $1 AND c.kind IN ('team', 'organisation', 'channel') AND c.track_commitments AND c.archived_at IS NULL
           AND c.last_message_at > COALESCE(cur.last_created_at, '-infinity'::timestamptz)`, [organisationId]);
      if (!convs.length) return { status: "ready", tz: org.timezone, messages: [], convs, capped: false, cutoff, readers: new Map(), names: new Map(), ai: false, usedToday: 0 };
      const rows = await db.query<ScanRow>(
        `SELECT ${SCAN_COLUMNS}
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN teams tm ON tm.id = c.team_id
         LEFT JOIN commitment_scan_cursors cur ON cur.conversation_id = c.id
         ${scanJoins(contextFloor)}
         WHERE m.organisation_id = $1 AND m.conversation_id = ANY($2::uuid[]) AND ${scanFilter({ standups: v50 })}
           AND m.created_at >= GREATEST($3::timestamptz, ${convSince}) AND m.created_at <= $4::timestamptz
           AND (cur.conversation_id IS NULL OR (m.created_at, m.id) > (cur.last_created_at, COALESCE(cur.last_message_id, '${NIL}'::uuid)))
         ORDER BY m.created_at, m.id
         LIMIT $5`, [organisationId, convs.map((c) => c.id), floor, cutoff, LOOP_LIMITS.scanMessagesPerRun, org.since ?? "-infinity"]);
      const messages = rows.map(scanMessageOf);
      // The readers of each conversation read, with their names (the people a commitment may name).
      const readers = new Map<string, Reader[]>();
      const names = new Map<string, string>();
      for (const conv of [...new Set(messages.map((m) => m.conversationId))]) {
        const rs = await db.query<{ membership_id: string; name: string | null }>(
          `SELECT r.membership_id, p.display_name AS name FROM app_conversation_readers($1) r
           JOIN memberships m ON m.id = r.membership_id JOIN profiles p ON p.id = m.user_id`, [conv]);
        readers.set(conv, rs.map((x) => ({ membershipId: x.membership_id, name: x.name ?? "Someone" })));
        for (const x of rs) names.set(x.membership_id, x.name ?? "Someone");
      }
      const plan = await resolveEntitlements(db, organisationId);
      const usedToday = plan.features.AI_ASSISTANT ? await workspaceCallsToday(db, organisationId, org.timezone, now) : 0;
      return { status: "ready", tz: org.timezone, messages, convs, capped: rows.length >= LOOP_LIMITS.scanMessagesPerRun, cutoff, readers, names, ai: !!plan.features.AI_ASSISTANT, usedToday };
    });
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0048();
    forget0049();
    forget0050();
    return nothing("not_ready");
  }
  if (pre.status !== "ready") return nothing(pre.status);

  // Prefilter: candidates at 0.35 or more, with each one's score kept for the built-in path.
  const scored = new Map<string, PrefilterResult>();
  for (const m of pre.messages) {
    const r = prefilter(prefilterInputOf(m), pre.readers.get(m.conversationId) ?? []);
    if (r.score >= LOOP_LIMITS.prefilterMin) scored.set(m.id, r);
  }
  const candidates = pre.messages.filter((m) => scored.has(m.id));
  const byId = new Map(pre.messages.map((m) => [m.id, m]));

  // The model, when everything allows it: the plan, a connection, the organisation's daily cap, not a test.
  let conn: AssistantConnection | null = null;
  const callsLeft = Math.min(LOOP_LIMITS.modelCallsPerScan, LOOP_LIMITS.modelCallsPerOrgPerDay - pre.usedToday);
  if (candidates.length && o.useModel !== false && pre.ai && callsLeft > 0 && process.env.NODE_ENV !== "test") {
    conn = await resolveAssistant(organisationId).catch(() => null);
  }
  const detected: DetectedCommitment[] = [];
  const agreements: { askId: string; agreementId: string; committer: string; asker: string; conversationId: string; title: string; dueAt: string | null; dueWords: string | null; detectedBy: "claude" | "builtin"; confidence: number; at: string }[] = [];
  const asks: { msg: ScanMessage; committer: string; title: string; dueAt: string | null; dueWords: string | null; detectedBy: "claude" | "builtin"; confidence: number }[] = [];
  const isReader = (conv: string, id: string | null | undefined) => !!id && (pre.readers.get(conv) ?? []).some((r) => r.membershipId === id);
  let engine: ScanOutcome["engine"] = candidates.length ? "builtin" : "none";
  const handled = new Set<string>();

  if (conn) {
    const groups = classifyLinesFor(candidates);
    const batches = numberBatches(groups, {
      perCall: LOOP_LIMITS.candidatesPerCall, names: pre.names,
      extra: (l) => [...(byId.get(l.messageId)?.mentions ?? []), ...namedIn(l.body, pre.readers.get(l.conversationId) ?? []), ...(scored.get(l.messageId)?.addressee ? [scored.get(l.messageId)!.addressee!] : [])],
    }).slice(0, callsLeft);
    const requestId = newRequestId();
    for (const b of batches) {
      const items = await classifyBatch(b.lines, b.people, {
        connection: conn, timeZone: pre.tz, now, requestId,
        record: (model, usage) => recordWorkspaceUsage(organisationId, { purpose: "commitments", model, usage, requestId }),
      });
      if (items === null) continue; // the built-in rules take this batch's candidates
      engine = "claude";
      for (const l of b.lines) if (l.candidate) handled.add(b.byN.get(l.n)!.messageId);
      for (const it of items) collect(it, b);
    }
  }

  /** One checked model item, as a commitment (or an agreement to fold in). */
  function collect(it: Classified, b: Batch) {
    if (it.confidence < LOOP_LIMITS.modelAcceptCommitment) return;
    const line = b.byN.get(it.n);
    const m = line ? byId.get(line.messageId) : undefined;
    if (!line || !m) return;
    const conv = m.conversationId;
    // The work must come from this line or its context, and every line of the batch is this conversation's (numberBatches).
    if (line.conversationId !== conv) return;
    const askLineFor = it.kind === "agreement" && it.agreesTo !== null ? b.byN.get(it.agreesTo) : undefined;
    if (!whatFromLines(it.what, [m.body, m.reply?.body, m.previous?.body, askLineFor?.body])) return;
    if (it.kind === "promise") {
      if (!it.by || it.by !== m.authorMembershipId || !isReader(conv, it.by)) return;
      detected.push({
        conversationId: conv, sourceMessageId: m.id, agreementMessageId: null, kind: "promise", committerMembershipId: it.by,
        askerMembershipId: it.to && it.to !== it.by && isReader(conv, it.to) ? it.to : null, title: it.what, dueAt: it.due, dueWords: it.dueWords,
        detectedBy: "claude", confidence: it.confidence, messageAt: m.at,
      });
    } else if (it.kind === "ask") {
      if (!it.to || it.to === m.authorMembershipId || !isReader(conv, it.to) || !isReader(conv, m.authorMembershipId)) return;
      asks.push({ msg: m, committer: it.to, title: it.what, dueAt: it.due, dueWords: it.dueWords, detectedBy: "claude", confidence: it.confidence });
    } else {
      const askLine = it.agreesTo !== null ? b.byN.get(it.agreesTo) : undefined;
      if (!askLine || !it.to || it.by !== m.authorMembershipId || !isReader(conv, it.by) || !isReader(conv, it.to) || askLine.conversationId !== conv) return;
      agreements.push({ askId: askLine.messageId, agreementId: m.id, committer: it.by, asker: it.to, conversationId: conv, title: it.what, dueAt: it.due, dueWords: it.dueWords, detectedBy: "claude", confidence: it.confidence, at: askLine.at });
    }
  }

  // Without the model (or for a batch it did not answer): the prefilter's own reading, 0.7 or more.
  for (const m of candidates) {
    if (handled.has(m.id)) continue;
    const r = scored.get(m.id)!;
    if (r.score < LOOP_LIMITS.builtinAccept) continue;
    const top = r.signals[0];
    const due = dueFromWords(r.dueWords, { timeZone: pre.tz, now: new Date(m.at) });
    const conv = m.conversationId;
    if (top === "promise") {
      const title = r.what ?? builtinTitle(m.body, "promise");
      if (!title || !isReader(conv, m.authorMembershipId)) continue;
      detected.push({
        conversationId: conv, sourceMessageId: m.id, agreementMessageId: null, kind: "promise", committerMembershipId: m.authorMembershipId,
        askerMembershipId: r.addressee && r.addressee !== m.authorMembershipId && isReader(conv, r.addressee) ? r.addressee : null,
        title, dueAt: due, dueWords: r.dueWords, detectedBy: "builtin", confidence: r.score, messageAt: m.at,
      });
    } else if (top === "ask") {
      const title = r.what ?? builtinTitle(m.body, "ask");
      if (!title || !r.addressee || r.addressee === m.authorMembershipId || !isReader(conv, r.addressee) || !isReader(conv, m.authorMembershipId)) continue;
      asks.push({ msg: m, committer: r.addressee, title, dueAt: due, dueWords: r.dueWords, detectedBy: "builtin", confidence: r.score });
    } else if (top === "agreement" && r.agreesTo) {
      const ask = r.agreesTo.id === m.reply?.id ? m.reply : r.agreesTo.id === m.previous?.id ? m.previous : null;
      const title = r.what;
      if (!ask || !title || !isReader(conv, m.authorMembershipId) || !isReader(conv, r.agreesTo.askerMembershipId)) continue;
      const askDue = dueFromWords(r.dueWords, { timeZone: pre.tz, now: new Date(ask.at) });
      agreements.push({ askId: ask.id, agreementId: m.id, committer: m.authorMembershipId, asker: r.agreesTo.askerMembershipId, conversationId: conv, title, dueAt: askDue, dueWords: r.dueWords, detectedBy: "builtin", confidence: r.score, at: ask.at });
    }
  }

  // A reply that both agrees and promises ("I'll fix it by Friday" to "Ben, can you fix the login bug by Friday?") is the
  // ask agreed, never a second commitment for the same work (correctness review, 9 October 2026): a promise whose
  // message replies to (or, within 30 minutes, follows) an ask of its writer found in this run or stored earlier becomes
  // that ask's agreement.
  const promiseCtx = (d: DetectedCommitment) => {
    const m = byId.get(d.sourceMessageId);
    if (!m) return null;
    if (m.reply && m.reply.authorMembershipId !== d.committerMembershipId) return m.reply;
    const gap = m.previous ? Date.parse(m.at) - Date.parse(m.previous.at) : NaN;
    return m.previous && m.previous.authorMembershipId !== d.committerMembershipId && gap >= 0 && gap <= 30 * 60_000 ? m.previous : null;
  };
  const promiseAsks = detected.filter((d) => d.kind === "promise").map((d) => ({ d, ctx: promiseCtx(d) })).filter((x) => !!x.ctx);
  const storedAsks = promiseAsks.length ? await withWorker((db) => db.query<{ source_message_id: string; committer_membership_id: string; asker_membership_id: string | null }>(
    `SELECT source_message_id, committer_membership_id, asker_membership_id FROM commitments
     WHERE organisation_id = $1 AND kind IN ('open_ask', 'agreed_ask') AND source_message_id = ANY($2::uuid[])`,
    [organisationId, [...new Set(promiseAsks.map((x) => x.ctx!.id))]])).catch((err) => { warn("reading earlier asks for promises")(err); return []; }) : [];
  for (const { d, ctx } of promiseAsks) {
    const inRun = asks.find((a) => a.msg.id === ctx!.id && a.committer === d.committerMembershipId);
    const stored = storedAsks.find((x) => x.source_message_id === ctx!.id && x.committer_membership_id === d.committerMembershipId);
    if (!inRun && !stored) continue;
    detected.splice(detected.indexOf(d), 1);
    agreements.push({
      askId: ctx!.id, agreementId: d.sourceMessageId, committer: d.committerMembershipId, asker: inRun?.msg.authorMembershipId ?? stored?.asker_membership_id ?? ctx!.authorMembershipId,
      conversationId: d.conversationId, title: inRun?.title ?? d.title, dueAt: d.dueAt, dueWords: d.dueWords, detectedBy: d.detectedBy, confidence: d.confidence, at: ctx!.at,
    });
  }

  // An ask with an agreement in this run is one agreed ask (the ask its source, the "On it" its agreement); an ask
  // without one is an open ask (its person is told after the grace period, unless they agree in the thread first).
  const folded = new Set<string>();
  for (const a of asks) {
    const yes = agreements.find((g) => g.askId === a.msg.id && g.committer === a.committer);
    if (yes) folded.add(`${yes.askId}:${yes.agreementId}`);
    detected.push({
      conversationId: a.msg.conversationId, sourceMessageId: a.msg.id, agreementMessageId: yes?.agreementId ?? null,
      kind: yes ? "agreed_ask" : "open_ask", committerMembershipId: a.committer, askerMembershipId: a.msg.authorMembershipId,
      title: a.title, dueAt: a.dueAt ?? yes?.dueAt ?? null, dueWords: a.dueWords ?? yes?.dueWords ?? null,
      detectedBy: a.detectedBy, confidence: Math.max(a.confidence, yes?.confidence ?? 0), messageAt: a.msg.at,
    });
  }
  // An agreement to an ask from an earlier look: the open ask waiting for its person becomes agreed; with none, a new
  // agreed ask (the ask was missed then, or said before tracking began).
  let agreed = 0;
  const loose = agreements.filter((g) => !folded.has(`${g.askId}:${g.agreementId}`));
  const already = loose.length ? await withWorker((db) => db.query<{ id: string; source_message_id: string; committer_membership_id: string; status: string }>(
    `SELECT id, source_message_id, committer_membership_id, status FROM commitments
     WHERE organisation_id = $1 AND source_message_id = ANY($2::uuid[])`, [organisationId, [...new Set(loose.map((g) => g.askId))]])).catch((err) => { warn("reading earlier asks")(err); return null; }) : [];
  const { insertDetectedCommitments, markAgreed } = await import("@/server/services/commitments");
  for (const g of loose) {
    if (already === null) break;
    const row = already.find((x) => x.source_message_id === g.askId && x.committer_membership_id === g.committer);
    if (row) {
      if (row.status === "asked" && await markAgreed(row.id, g.agreementId, { now }).catch((err) => { warn("marking an ask agreed")(err); return false; })) agreed++;
      continue;
    }
    if (detected.some((d) => d.sourceMessageId === g.askId && d.committerMembershipId === g.committer)) continue;
    detected.push({
      conversationId: g.conversationId, sourceMessageId: g.askId, agreementMessageId: g.agreementId, kind: "agreed_ask",
      committerMembershipId: g.committer, askerMembershipId: g.asker, title: g.title, dueAt: g.dueAt, dueWords: g.dueWords,
      detectedBy: g.detectedBy, confidence: g.confidence, messageAt: g.at,
    });
  }

  let created = 0;
  if (detected.length) {
    // One row per message and committer (the database holds the same), the strongest reading kept.
    const unique = new Map<string, DetectedCommitment>();
    for (const d of detected) {
      const key = `${d.sourceMessageId}:${d.committerMembershipId}`;
      const had = unique.get(key);
      if (!had || d.confidence > had.confidence || (d.kind === "agreed_ask" && had.kind === "open_ask")) unique.set(key, d);
    }
    const r = await insertDetectedCommitments(organisationId, [...unique.values()], { now });
    created = r.created.length;
  }

  // How far each conversation has been read: the last message read; a conversation with nothing to read (only voice
  // notes, assistants' messages, withdrawn ones) moves to the cut-off unless the run stopped at its limit first.
  await saveCursors(organisationId, pre).catch(warn("saving how far the scan read"));
  return { status: "done", read: pre.messages.length, candidates: candidates.length, created, agreed, engine };
}

/**
 * Saves how far each conversation was read. Every time is read in SQL (correctness review, 9 October 2026): a JavaScript
 * Date keeps milliseconds only, so a cursor taken from it fell just before the message it named, which was then read
 * again on every scan (and the organisation queued every five minutes for a day). The cursor is the later of the last
 * message read and, when the run was not stopped at its limit, the conversation's own last message if it is older than
 * the cut-off (a voice note, an assistant's message or a withdrawn one the scan leaves out), so a conversation whose
 * newest message is one of those is not looked at again for nothing.
 */
async function saveCursors(organisationId: string, pre: Extract<Pre, { status: "ready" }>): Promise<void> {
  const last = new Map<string, string | null>();
  for (const m of pre.messages) last.set(m.conversationId, m.id);
  if (!pre.capped) for (const c of pre.convs) if (!last.has(c.id)) last.set(c.id, null);
  if (!last.size) return;
  await withWorker(async (db) => {
    for (const [conv, messageId] of last) {
      await db.query(
        `INSERT INTO commitment_scan_cursors(conversation_id, organisation_id, last_created_at, last_message_id, scanned_at)
         SELECT $1, $2, x.at, CASE WHEN x.read_at IS NOT NULL AND x.read_at >= x.at THEN $3::uuid END, now()
         FROM (SELECT GREATEST(r.created_at, q.last_message_at) AS at, r.created_at AS read_at
               FROM (SELECT 1) one
               LEFT JOIN messages r ON r.id = $3::uuid
               LEFT JOIN conversations q ON q.id = $1 AND $5::boolean AND q.last_message_at <= $4::timestamptz) x
         WHERE x.at IS NOT NULL
         ON CONFLICT (conversation_id) DO UPDATE SET last_created_at = EXCLUDED.last_created_at, last_message_id = EXCLUDED.last_message_id, scanned_at = now()
         WHERE (commitment_scan_cursors.last_created_at, COALESCE(commitment_scan_cursors.last_message_id, '${NIL}'::uuid))
             < (EXCLUDED.last_created_at, COALESCE(EXCLUDED.last_message_id, '${NIL}'::uuid))`, [conv, organisationId, messageId, pre.cutoff, !pre.capped]);
    }
  });
}
