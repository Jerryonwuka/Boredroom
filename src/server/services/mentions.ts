/**
 * @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5). "@Max …" in a conversation makes
 * the person's OWN assistant reply in the thread; "@Ben" highlights Ben and notifies him (messaging.ts stores both when
 * the message is sent). This module is the queue of assistant mentions and everything around it except the answer
 * itself (mention-processor.ts and copilot's shared mode write that):
 *
 * pending ──claim──▶ thinking ──completePublic──▶ answered ──withdraw──▶ withdrawn
 *    │                  │ └──completePrivate──▶ private | waiting_confirm ──every proposal decided or confirm_until passed──▶ private
 *    │                  ├──release (attempt ≤ 3, lease cleared, stays thinking) ──claim again──▶ thinking
 *    │                  ├──fail (attempts > 3, tagger left) ──▶ failed
 *    │                  └──tagging message withdrawn (seen at completion) ──▶ withdrawn
 *    ├──claim refuses (switch, archived, limit, not allowed) ──▶ refused
 *    └──tagging message withdrawn while pending ──▶ withdrawn
 *
 * Every transition is one guarded statement through the worker role (keyed by id, guarded by the expected status); a
 * statement that returns no row means someone else moved it first, and the caller stops quietly. Refused, failed,
 * private and waiting_confirm always write the private row (an answer or a note) in the same transaction and notify the
 * tagger (review, 8 October 2026). One run at a time per conversation: the claim takes an advisory lock per conversation
 * and refuses while another mention there is thinking with a live lease.
 *
 * What the tagger alone sees (the private answer, the full text of a long reply, a note, the Confirm proposals with their
 * signed tokens) lives in its own table that only they read, while they can still read the conversation. Tokens never
 * leave the server: the card confirms by index. The tagger's and the managers' actions (Post to channel, Dismiss,
 * Withdraw, a proposal's Confirm) re-check as the person under row-level security, then write through the worker.
 *
 * Audit rows hold ids and codes, never words. Before migration 0041 everything here answers 503 NOT_READY, reads
 * `ready: false`, or returns null (server/lib/schema-0041).
 *
 * Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6; migration 0043): "@Ben's
 * Brenda, where is the deck?" queues a row that names the assistant's owner (owner_membership_id). The claim also checks
 * the owner: still active and reading the conversation ('owner_left'), tags switched on ('off_owner'), the tagger not
 * muted ('owner_muted'), and the owner's own limits ('limit_owner'). The run calls no model (mention-processor.ts): it
 * hands a change on Ben's account over as a request for the tagger to confirm, passes a line on, or asks Ben's
 * assistant through a follow-up (follow_up_id) and posts as Ben's assistant: a holding line ('asked', holding_message_id)
 * and the answer. The thread shows the owner's assistant and who asked; the owner, the tagger or whoever runs the
 * conversation may withdraw the reply. Before 0043 none of this is read or written (server/lib/schema-0043).
 *
 *   thinking ──holding line──▶ asked ──the owner's reply, the deadline, a closing line──▶ answered
 *   thinking|asked ──a switch off, archived, the owner gone──▶ private;  ──failed──▶ failed;  ──withdrawn──▶ withdrawn
 */
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, notFound } from "@/server/lib/errors";
import { forget0041, isMissingSchema, retryWithout0041, schema0041Ready } from "@/server/lib/schema-0041";
import { forget0042, schema0042Ready } from "@/server/lib/schema-0042";
import { forget0043, schema0043Ready } from "@/server/lib/schema-0043";
import { memberContext } from "@/server/lib/member-context";
import { localMidnight, todayLocal } from "@/server/lib/time";
import { audit, notify } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import type { Action, Proposal } from "@/server/services/copilot";
import type { ConversationKind } from "@/server/services/messaging";
import { toProfile, type AssistantProfile } from "@/lib/assistant-look";
import { clip, firstName } from "@/lib/follow-ups";
import {
  MENTION_LIMITS, MENTIONS_NOT_READY_SHORT, assistantLabels, findLabel, isMentionNoteCode, mentionNote,
  type MentionNoteCode, type MentionPrivateView, type MentionProposalView, type MentionStatus, type MentionToken, type MentionView,
} from "@/lib/mentions";
import type { FollowUpPreference, FollowUpStatus, ReplyChoice } from "@/lib/follow-ups";

// ---- Types (the contract, D.2) ---------------------------------------------------------------------------------------------

export type MentionEngine = "claude" | "builtin";
export type ConfirmProposal = Extract<Proposal, { kind: "confirm" }>;
export type MentionJob = {
  id: string; organisationId: string; conversationId: string; messageId: string; taggerMembershipId: string;
  attempts: number; createdAt: string;
  /** The tagger as a signed-in person (memberContext). */
  ctx: OrgContext;
  /** "#Design", "Everyone", "Ben Okafor" as the tagger sees it. */
  conversation: { id: string; kind: ConversationKind; name: string; archived: boolean };
  /** The tagger's own assistant. */
  assistant: AssistantProfile;
  /**
   * Phase 6: someone else's assistant was tagged; null for the tagger's own. `preference`: how the owner wants follow-ups
   * answered ('auto' answers from their work, 'ask_first' always asks them).
   */
  owner: { membershipId: string; name: string; firstName: string; assistant: AssistantProfile; preference: FollowUpPreference } | null;
  /** Phase 6: the follow-up a run of someone else's assistant already asked (a retried run goes on with it, never a second). */
  followUpId: string | null;
};

/** A proposal as stored in assistant_mention_private.proposals (the token never leaves the server). */
type StoredProposal = {
  index: number; tool: string; summary: string; detail: string | null; token: string; expiresAt: string;
  state: MentionProposalView["state"]; result: string | null;
};

// ---- Small helpers ----------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const lower = (s: string) => s.toLocaleLowerCase("en-GB");
const notReady = () => new AppError(503, "NOT_READY", MENTIONS_NOT_READY_SHORT);
const NOT_YOURS = "That answer is not yours or is no longer there.";
const warn = (what: string) => (err: unknown) => console.warn(`[mentions] ${what}: ${(err as Error)?.message ?? String(err)}`);
const threadHref = (slug: string, conversationId: string, messageId: string) => `/app/${slug}/messages?c=${conversationId}#m-${messageId}`;
const MAX_PROPOSALS = 20;
const OPEN_SQL = `('pending', 'thinking')`;

/** Clamps a message body to a message's 4,000 characters (never splitting a surrogate pair). */
const bodyOf = (s: string) => clip(s.trim(), MENTION_LIMITS.privateChars);

/** The organisation's local midnight today, for the daily limits. */
const midnightIn = (timeZone: string, now: Date) => localMidnight(todayLocal(timeZone, now), timeZone);

// ---- Validation (pure, B.2) ----------------------------------------------------------------------------------------------

/**
 * Which of the composer's tokens hold (owner decision, 8 October 2026: personal assistants, phase 5). Invalid tokens are
 * dropped silently, never refused, so a race with someone leaving does not lose the message.
 * - assistant: the label is "@" + the sender's OWN assistant's name or "@assistant" (case-insensitive) and stands in
 *   the body as a whole mention.
 * - others_assistant (phase 6): someone else's assistant; valid when its owner is among `who.others` (readers of the
 *   conversation, as the server looked them up), `allowed` (they let people tag it), and the label is one of its labels
 *   (otherAssistantLabels) and stands in the body.
 * - At most ONE assistant in all, own or someone else's: the first valid assistant token in the list wins, the rest are
 *   dropped. `ownerMembershipId` is null for the sender's own assistant.
 * - person (deduplicated, at most 20): not the sender; among `people` (the active members who read the conversation, as
 *   the server looked them up); the label is "@" + their display name (case-insensitive) and stands in the body.
 * The stored label is the body's own spelling of it.
 */
export function validateMentions(
  body: string,
  tokens: MentionToken[],
  who: { ownAssistantName: string; people: { membershipId: string; name: string }[]; selfMembershipId?: string; others?: { membershipId: string; labels: string[]; allowed: boolean }[] },
): { assistant: { label: string; ownerMembershipId: string | null } | null; people: { membershipId: string; label: string }[] } {
  const own = assistantLabels(who.ownAssistantName).map(lower);
  let assistant: { label: string; ownerMembershipId: string | null } | null = null;
  const people: { membershipId: string; label: string }[] = [];
  for (const t of tokens ?? []) {
    if (!t || typeof t.label !== "string") continue;
    const label = t.label.trim();
    if (t.kind === "assistant") {
      if (assistant || !own.includes(lower(label))) continue;
      const at = findLabel(body, label);
      if (at < 0) continue;
      assistant = { label: body.slice(at, at + label.length), ownerMembershipId: null };
    } else if (t.kind === "others_assistant") {
      if (assistant) continue;
      const id = String(t.membershipId ?? "").toLowerCase();
      if (!isUuid(id) || id === who.selfMembershipId?.toLowerCase()) continue;
      const owner = (who.others ?? []).find((o) => o.membershipId.toLowerCase() === id);
      if (!owner || !owner.allowed || !owner.labels.some((l) => lower(l) === lower(label))) continue;
      const at = findLabel(body, label);
      if (at < 0) continue;
      assistant = { label: body.slice(at, at + label.length), ownerMembershipId: owner.membershipId };
    } else if (t.kind === "person") {
      if (people.length >= MENTION_LIMITS.tokensPerMessage) continue;
      const id = String(t.membershipId ?? "").toLowerCase();
      if (!isUuid(id) || id === who.selfMembershipId?.toLowerCase() || people.some((p) => p.membershipId.toLowerCase() === id)) continue;
      const person = who.people.find((p) => p.membershipId.toLowerCase() === id);
      if (!person || lower(label) !== lower(`@${person.name}`)) continue;
      const at = findLabel(body, label);
      if (at < 0) continue;
      people.push({ membershipId: person.membershipId, label: body.slice(at, at + label.length) });
    }
  }
  return { assistant, people };
}

// ---- The row a transition works on -------------------------------------------------------------------------------------

type ProcRow = {
  id: string; organisation_id: string; conversation_id: string; message_id: string; tagger_membership_id: string;
  status: MentionStatus; reply_message_id: string | null; attempts: number; lease_live: boolean; started_at: string | null; created_at: string;
  slug: string; timezone: string; org_status: string;
  kind: ConversationKind; archived: boolean; assistant_replies: boolean; workspace_on: boolean;
  tagger_status: string; tagger_name: string;
  a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null;
  message_withdrawn: boolean; channel_name: string | null; other_id: string | null; other_name: string | null;
  // Phase 6 (null before 0043, and for the tagger's own assistant).
  owner_membership_id: string | null; follow_up_id: string | null; holding_message_id: string | null;
  owner_status: string | null; owner_name: string | null; owner_profile_id: string | null; tagger_profile_id: string;
  oa_name: string | null; oa_colour: string | null; oa_visor: string | null; oa_eyes: string | null;
  owner_pref: string | null; owner_allows: boolean | null;
};

/** The phase 6 columns of a row, or NULLs before 0043 (the columns are not there to name). */
const ownerColumns = (ready43: boolean) => ready43
  ? `am.owner_membership_id, am.follow_up_id, am.holding_message_id, owm.status AS owner_status, owp.display_name AS owner_name, owm.user_id AS owner_profile_id,
     oap.name AS oa_name, oap.colour AS oa_colour, oap.visor AS oa_visor, oap.eyes AS oa_eyes, COALESCE(oap.followups, 'auto') AS owner_pref,
     COALESCE(oap.allow_thread_replies, true) AS owner_allows`
  : `NULL::uuid AS owner_membership_id, NULL::uuid AS follow_up_id, NULL::uuid AS holding_message_id, NULL::text AS owner_status, NULL::text AS owner_name,
     NULL::uuid AS owner_profile_id, NULL::text AS oa_name, NULL::text AS oa_colour, NULL::text AS oa_visor, NULL::text AS oa_eyes, NULL::text AS owner_pref,
     NULL::boolean AS owner_allows`;
const ownerJoins = (ready43: boolean) => ready43
  ? `LEFT JOIN memberships owm ON owm.id = am.owner_membership_id
     LEFT JOIN profiles owp ON owp.id = owm.user_id
     LEFT JOIN assistant_profiles oap ON oap.membership_id = am.owner_membership_id`
  : "";

const procSql = (ready43: boolean) => `
  SELECT am.id, am.organisation_id, am.conversation_id, am.message_id, am.tagger_membership_id, am.status, am.reply_message_id, am.attempts,
         (am.lease_until IS NOT NULL AND am.lease_until > now()) AS lease_live, am.started_at, am.created_at,
         o.slug, o.timezone, o.status AS org_status,
         c.kind, (c.archived_at IS NOT NULL) AS archived, c.assistant_replies, COALESCE(bs.mention_replies, true) AS workspace_on,
         tm.status AS tagger_status, tp.display_name AS tagger_name, tp.id AS tagger_profile_id,
         ${ownerColumns(ready43)},
         ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes,
         (msg.deleted_at IS NOT NULL) AS message_withdrawn,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || tt.name WHEN 'channel' THEN '#' || c.title END AS channel_name,
         om.id AS other_id, op.display_name AS other_name
  FROM assistant_mentions am
  JOIN organisations o ON o.id = am.organisation_id
  JOIN conversations c ON c.id = am.conversation_id
  LEFT JOIN teams tt ON tt.id = c.team_id
  LEFT JOIN brenda_settings bs ON bs.organisation_id = am.organisation_id
  JOIN memberships tm ON tm.id = am.tagger_membership_id
  JOIN profiles tp ON tp.id = tm.user_id
  LEFT JOIN assistant_profiles ap ON ap.membership_id = am.tagger_membership_id
  JOIN messages msg ON msg.id = am.message_id
  LEFT JOIN LATERAL (SELECT cp.membership_id FROM conversation_participants cp
                     WHERE c.kind = 'direct' AND cp.conversation_id = c.id AND cp.membership_id <> am.tagger_membership_id LIMIT 1) ocp ON true
  LEFT JOIN memberships om ON om.id = ocp.membership_id
  LEFT JOIN profiles op ON op.id = om.user_id
  ${ownerJoins(ready43)}
  WHERE am.id = $1`;

const lockRow = async (db: Db, id: string) => db.maybeOne<ProcRow>(`${procSql(await schema0043Ready(db))} FOR UPDATE OF am`, [id]);
const assistantOf = (r: Pick<ProcRow, "a_name" | "a_colour" | "a_visor" | "a_eyes">) => toProfile({ name: r.a_name, colour: r.a_colour, visor: r.a_visor, eyes: r.a_eyes });
/** Someone else's assistant (phase 6): the owner's, by its name and look. */
const ownerAssistantOf = (r: Pick<ProcRow, "oa_name" | "oa_colour" | "oa_visor" | "oa_eyes">) => toProfile({ name: r.oa_name, colour: r.oa_colour, visor: r.oa_visor, eyes: r.oa_eyes });
/** Who answers, in the tagger's words: their own assistant ("Max"), or someone else's ("Ben's Brenda"). */
const answeringName = (r: ProcRow) => (r.owner_membership_id ? `${firstName(r.owner_name ?? "Someone")}'s ${ownerAssistantOf(r).name}` : assistantOf(r).name);
/** A note's words for this row: the owner's reasons name the owner and their assistant. */
const noteWords = (r: ProcRow, code: MentionNoteCode) => mentionNote(code, answeringName(r), r.owner_membership_id ? { firstName: firstName(r.owner_name ?? "Someone"), assistantName: ownerAssistantOf(r).name } : null);
/** "#Design", "Everyone", or for a direct thread "your chat with Ben Okafor" (the tagger's words). */
const whereForTagger = (r: ProcRow) => (r.kind === "direct" ? `your chat with ${r.other_name ?? "someone"}` : r.channel_name ?? "a conversation");
/** The conversation's name as the tagger sees it in the list: "#Design", "Everyone", "Ben Okafor". */
const nameForTagger = (r: ProcRow) => (r.kind === "direct" ? r.other_name ?? "Someone" : r.channel_name ?? "A conversation");
const hrefOf = (r: ProcRow) => threadHref(r.slug, r.conversation_id, r.message_id);
const statusNow = (id: string) => withWorker((db) => db.maybeOne<{ status: MentionStatus }>(`SELECT status FROM assistant_mentions WHERE id = $1`, [id])).then((r) => r?.status ?? null);

/** Runs a worker transition; before 0041 (or with the tables gone) it returns null. Never throws for a missing schema. */
async function inWorker<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  try {
    return await withWorker(async (db) => ((await schema0041Ready(db)) ? fn(db) : null));
  } catch (err) {
    // A database restored to before 0041 (or 0043, whose columns a row now reads): forget both, the next call falls back.
    if (isMissingSchema(err)) { forget0041(); forget0043(); return null; }
    throw err;
  }
}

/** The tagger's private row (an answer, the full text of a long reply, or a note), written once per mention. */
async function writePrivate(db: Db, r: ProcRow, p: { kind: "answer" | "full_answer" | "note"; body: string | null; noteCode: MentionNoteCode | null; proposals?: StoredProposal[] }) {
  await db.query(
    `INSERT INTO assistant_mention_private(mention_id, organisation_id, tagger_membership_id, kind, body, note_code, proposals)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (mention_id) DO UPDATE SET kind = EXCLUDED.kind, body = EXCLUDED.body, note_code = EXCLUDED.note_code, proposals = EXCLUDED.proposals`,
    [r.id, r.organisation_id, r.tagger_membership_id, p.kind, p.body ? bodyOf(p.body) : null, p.noteCode, JSON.stringify(p.proposals ?? [])]);
}

/** brenda.mention_private to the tagger: a private answer, or a note (refused, failed, no AI). */
async function notifyPrivate(db: Db, r: ProcRow, p: { text: string | null; noteCode: MentionNoteCode | null }) {
  const name = answeringName(r);
  const where = whereForTagger(r);
  const answered = !!p.text;
  await notify(db, {
    organisationId: r.organisation_id, recipientMembershipId: r.tagger_membership_id, type: "brenda.mention_private",
    title: answered ? `${name} answered you in ${where}` : `${name} couldn't answer in ${where}`,
    body: answered ? `Only visible to you. ${clip(p.text!, 280)}` : noteWords(r, p.noteCode ?? "failed"),
    resourceType: "conversation", resourceId: r.conversation_id, href: hrefOf(r), dedupKey: `mention.private:${r.id}`,
  });
}

/** One row in the tagger's "What Max did" (their own assistant acted for them); written by the worker. */
async function logForTagger(db: Db, r: ProcRow, personal: string) {
  await db.query(
    `INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES ($1, $2, 'mention_reply', $3, 'done', 'chat', $4::jsonb)`,
    [r.organisation_id, r.tagger_membership_id, "Answered a mention in Messages", JSON.stringify({ href: hrefOf(r), personalSummary: clip(personal, 500), conversationId: r.conversation_id, mentionId: r.id })]);
}

const auditMention = (db: Db, r: ProcRow, action: string, metadata: Record<string, unknown> = {}, actor: string | null = null) =>
  audit(db, { organisationId: r.organisation_id, actorMembershipId: actor, action, subjectType: "assistant_mention", subjectId: r.id, subjectMembershipId: r.tagger_membership_id, metadata: { mentionId: r.id, conversationId: r.conversation_id, messageId: r.message_id, ...(r.owner_membership_id ? { ownerMembershipId: r.owner_membership_id } : {}), ...metadata } });

/**
 * Why the owner's assistant would not answer is the owner's own business: a mute ("a personal preference, not
 * logged"), tags switched off, or no longer reading the conversation. The owner, HR and the tagger's team lead read
 * audit rows, so these are audited as one neutral code without the owner's id; the tagger's private note keeps the real
 * reason (security review, 8 October 2026).
 */
const OWNER_PRIVATE_CODES: ReadonlySet<MentionNoteCode> = new Set<MentionNoteCode>(["owner_muted", "off_owner", "owner_left"]);
const auditRefusal = (db: Db, r: ProcRow, action: string, code: MentionNoteCode) =>
  OWNER_PRIVATE_CODES.has(code)
    ? auditMention(db, { ...r, owner_membership_id: null }, action, { code: "owner_unavailable" })
    : auditMention(db, r, action, { code });

/** refused, with its note, in the caller's worker transaction (the row is locked and open). */
async function refuseIn(db: Db, r: ProcRow, code: MentionNoteCode): Promise<MentionStatus | null> {
  const moved = await db.maybeOne(`UPDATE assistant_mentions SET status = 'refused', lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OPEN_SQL} RETURNING id`, [r.id]);
  if (!moved) return null;
  await writePrivate(db, r, { kind: "note", body: null, noteCode: code });
  await notifyPrivate(db, r, { text: null, noteCode: code });
  await auditRefusal(db, r, "mention.refused", code);
  return "refused";
}

/** failed, with the note 'failed' unless silent (the tagger has left and could not read it). */
async function failIn(db: Db, r: ProcRow, silent: boolean): Promise<MentionStatus | null> {
  const moved = await db.maybeOne(`UPDATE assistant_mentions SET status = 'failed', lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OPEN_SQL} RETURNING id`, [r.id]);
  if (!moved) return null;
  if (!silent) {
    await writePrivate(db, r, { kind: "note", body: null, noteCode: "failed" });
    await notifyPrivate(db, r, { text: null, noteCode: "failed" });
  }
  await auditMention(db, r, "mention.failed", { silent });
  return "failed";
}

const withdrawIn = async (db: Db, r: ProcRow): Promise<MentionStatus | null> =>
  (await db.maybeOne(`UPDATE assistant_mentions SET status = 'withdrawn', lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OPEN_SQL} RETURNING id`, [r.id])) ? "withdrawn" : null;

// ---- The queue (D.2) --------------------------------------------------------------------------------------------------------

/**
 * Claims a mention for processing. One worker transaction: pg_advisory_xact_lock(hashtext('mention.conv:' || conversation_id));
 * the row FOR UPDATE; returns null when it is not 'pending' or 'thinking', when its lease is live, or when another
 * mention of the same conversation is 'thinking' with a live lease (one run at a time per conversation). Then, in order:
 * the tagging message withdrawn → 'withdrawn'; attempts ≥ maxAttempts → failed('failed'); the tagger no longer active →
 * failed (no note: they cannot read it); brenda_settings.mention_replies false → refused('off_workspace');
 * conversations.assistant_replies false → refused('off_conversation'); archived → refused('archived'); on the first
 * claim only (started_at IS NULL) the limits, counting rows with started_at set: the tagger's in the last minute
 * (≥ perTaggerPerMinute → 'limit_minute') and since the organisation's local midnight (≥ perTaggerPerDay →
 * 'limit_day'), the conversation's in the last hour ('limit_conversation'), the organisation's since local midnight
 * ('limit_workspace'). Then status 'thinking', lease_until now() + leaseSeconds, attempts + 1, started_at COALESCE now().
 * After the transaction, as the tagger: SELECT app_can_read_conversation(conv) → false: refused('not_allowed').
 * Refusals return null (the row, note and notification are written inside).
 */
export async function claimMention(id: string, opts: { now?: Date } = {}): Promise<MentionJob | null> {
  if (!isUuid(id)) return null;
  const now = opts.now ?? new Date();
  const job = await inWorker(async (db): Promise<MentionJob | null> => {
    const head = await db.maybeOne<{ conversation_id: string }>(`SELECT conversation_id FROM assistant_mentions WHERE id = $1`, [id]);
    if (!head) return null;
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`mention.conv:${head.conversation_id}`]);
    const r = await lockRow(db, id);
    if (!r || (r.status !== "pending" && r.status !== "thinking") || r.lease_live) return null;
    const busy = await db.maybeOne(
      `SELECT 1 FROM assistant_mentions WHERE conversation_id = $1 AND id <> $2 AND status = 'thinking' AND lease_until > now() LIMIT 1`, [r.conversation_id, r.id]);
    if (busy) return null;
    if (r.message_withdrawn) { await withdrawIn(db, r); return null; }
    if (r.attempts >= MENTION_LIMITS.maxAttempts) { await failIn(db, r, false); return null; }
    const ctx = r.tagger_status === "active" && r.org_status === "active" ? await memberContext(db, r.organisation_id, r.tagger_membership_id) : null;
    if (!ctx) { await failIn(db, r, true); return null; }
    if (!r.workspace_on) { await refuseIn(db, r, "off_workspace"); return null; }
    if (!r.assistant_replies) { await refuseIn(db, r, "off_conversation"); return null; }
    if (r.archived) { await refuseIn(db, r, "archived"); return null; }
    // Someone else's assistant (phase 6): its owner still active and reading here, tags still on, the tagger not muted.
    if (r.owner_membership_id) {
      const owner = await db.one<{ reads: boolean; muted: boolean }>(
        `SELECT app_conversation_has_reader($1, $2) AS reads,
                EXISTS (SELECT 1 FROM assistant_item_mutes x WHERE x.recipient_membership_id = $2 AND x.sender_membership_id = $3 AND x.muted) AS muted`,
        [r.conversation_id, r.owner_membership_id, r.tagger_membership_id]);
      if (r.owner_status !== "active" || !owner.reads) { await refuseIn(db, r, "owner_left"); return null; }
      if (r.owner_allows === false) { await refuseIn(db, r, "off_owner"); return null; }
      if (owner.muted) { await refuseIn(db, r, "owner_muted"); return null; }
    }
    if (!r.started_at) {
      // The counts below read other claims' committed rows, so claims of the same organisation in different
      // conversations take turns here (security review, 8 October 2026: nine at once got past the 5 a minute). Always
      // after the conversation's lock, so the order is the same for every claim.
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`mention.org:${r.organisation_id}`]);
      const midnight = midnightIn(r.timezone, now).toISOString();
      const at = now.toISOString();
      const n = await db.one<{ minute: number; day: number; conv: number; org: number }>(
        `SELECT count(*) FILTER (WHERE tagger_membership_id = $2 AND started_at > $4::timestamptz - interval '1 minute')::int AS minute,
                count(*) FILTER (WHERE tagger_membership_id = $2 AND started_at >= $5::timestamptz)::int AS day,
                count(*) FILTER (WHERE conversation_id = $3 AND started_at > $4::timestamptz - interval '1 hour')::int AS conv,
                count(*) FILTER (WHERE started_at >= $5::timestamptz)::int AS org
         FROM assistant_mentions
         WHERE organisation_id = $1 AND started_at IS NOT NULL AND id <> $6 AND started_at >= LEAST($5::timestamptz, $4::timestamptz - interval '1 hour')`,
        [r.organisation_id, r.tagger_membership_id, r.conversation_id, at, midnight, r.id]);
      // The owner's own limits (phase 6): their assistant tagged by anyone in the last hour, or by this tagger today.
      const own = r.owner_membership_id ? await db.one<{ hour: number; day: number }>(
        `SELECT count(*) FILTER (WHERE started_at > $3::timestamptz - interval '1 hour')::int AS hour,
                count(*) FILTER (WHERE tagger_membership_id = $2 AND started_at >= $4::timestamptz)::int AS day
         FROM assistant_mentions
         WHERE owner_membership_id = $1 AND started_at IS NOT NULL AND id <> $5 AND started_at >= LEAST($4::timestamptz, $3::timestamptz - interval '1 hour')`,
        [r.owner_membership_id, r.tagger_membership_id, at, midnight, r.id]) : null;
      const code: MentionNoteCode | null =
        n.minute >= MENTION_LIMITS.perTaggerPerMinute ? "limit_minute"
          : n.day >= MENTION_LIMITS.perTaggerPerDay ? "limit_day"
            : n.conv >= MENTION_LIMITS.perConversationPerHour ? "limit_conversation"
              : n.org >= MENTION_LIMITS.perOrganisationPerDay ? "limit_workspace"
                : own && (own.hour >= MENTION_LIMITS.perOwnerPerHour || own.day >= MENTION_LIMITS.perTaggerOwnerPerDay) ? "limit_owner" : null;
      if (code) { await refuseIn(db, r, code); return null; }
    }
    const claimed = await db.maybeOne<{ attempts: number }>(
      `UPDATE assistant_mentions SET status = 'thinking', lease_until = now() + make_interval(secs => $2), attempts = attempts + 1, started_at = COALESCE(started_at, now())
       WHERE id = $1 AND status IN ${OPEN_SQL} RETURNING attempts`, [r.id, MENTION_LIMITS.leaseSeconds]);
    if (!claimed) return null;
    return {
      id: r.id, organisationId: r.organisation_id, conversationId: r.conversation_id, messageId: r.message_id, taggerMembershipId: r.tagger_membership_id,
      attempts: claimed.attempts, createdAt: r.created_at, ctx,
      conversation: { id: r.conversation_id, kind: r.kind, name: nameForTagger(r), archived: r.archived },
      assistant: assistantOf(r),
      owner: r.owner_membership_id ? {
        membershipId: r.owner_membership_id, name: r.owner_name ?? "Someone", firstName: firstName(r.owner_name ?? "Someone"),
        assistant: ownerAssistantOf(r), preference: r.owner_pref === "ask_first" ? "ask_first" : "auto",
      } : null,
      followUpId: r.follow_up_id,
    };
  });
  if (!job) return null;
  // The tagger's own permission now, under their row-level security (they may have left the channel since).
  const reads = await withUser(job.ctx.user.profileId, (db) => db.one<{ ok: boolean }>(`SELECT app_can_read_conversation($1) AS ok`, [job.conversationId]));
  if (!reads.ok) { await refuseMention(job.id, "not_allowed"); return null; }
  return job;
}

/** Keeps a claim alive while the model works (one step at a time). False when the row is no longer thinking. */
export async function renewMentionLease(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await inWorker((db) => db.maybeOne(
    `UPDATE assistant_mentions SET lease_until = now() + make_interval(secs => $2) WHERE id = $1 AND status = 'thinking' RETURNING id`, [id, MENTION_LIMITS.leaseSeconds]));
  return !!r;
}

/**
 * A run that could not finish (the model unreachable, a timeout): the lease is cleared and the row stays thinking, so the
 * next claim retries it; at maxAttempts it fails with the private note 'failed'. Never a public error. The error is
 * logged on the server only (never stored: it may quote the model or a tool).
 */
export async function releaseMention(id: string, error: string): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  console.warn(`[mentions] run for ${id} did not finish: ${String(error ?? "").slice(0, 200)}`);
  return inWorker(async (db) => {
    const r = await lockRow(db, id);
    if (!r || r.status !== "thinking") return r?.status ?? null;
    if (r.attempts >= MENTION_LIMITS.maxAttempts) return (await failIn(db, r, false)) ?? (await statusIn(db, id));
    await db.query(`UPDATE assistant_mentions SET lease_until = NULL WHERE id = $1 AND status = 'thinking'`, [id]);
    return "thinking";
  });
}

const statusIn = async (db: Db, id: string) => (await db.maybeOne<{ status: MentionStatus }>(`SELECT status FROM assistant_mentions WHERE id = $1`, [id]))?.status ?? null;

/** Who the reply's direct-thread notification goes to: the other person, unless they muted the thread. */
async function otherUnmuted(db: Db, r: ProcRow): Promise<string | null> {
  if (r.kind !== "direct" || !r.other_id) return null;
  const m = await db.one<{ muted: boolean }>(`SELECT app_conversation_muted($1, $2) AS muted`, [r.conversation_id, r.other_id]);
  return m.muted ? null : r.other_id;
}

/** Who reads the conversation now (worker), taken when a run starts so the reply is posted only to that audience. */
export async function mentionReaders(conversationId: string): Promise<string[] | null> {
  if (!isUuid(conversationId)) return null;
  return inWorker(async (db) => (await db.query<{ membership_id: string }>(`SELECT membership_id FROM app_conversation_readers($1)`, [conversationId])).map((x) => x.membership_id));
}

/**
 * Posts the public reply. One worker transaction, guarded (status 'thinking', reply_message_id NULL): when the tagging
 * message was withdrawn → 'withdrawn', nothing posted; when the conversation is now archived or either switch is now off
 * → stored as a private answer instead (completeMentionPrivate's path, with note 'archived' / 'off_*'); when the tagger
 * can no longer read the conversation → refused('not_allowed'); else INSERT INTO messages(organisation_id,
 * conversation_id, sender_membership_id = tagger, body = text, reply_to_id = message_id, author_kind = 'assistant'),
 * status 'answered', reply_message_id, engine, lease NULL, finished_at now(); `fullText` (a shortened reply) or
 * `noteCode` (allowance) → the private row (kind 'full_answer', or 'note'); notify the tagger (brenda.mention_reply); in
 * a direct thread also the other person unless muted (message.direct, "{first}'s assistant {name} replied in your
 * chat", body the reply clamped to 120); activity and audit.
 */
export async function completeMentionPublic(id: string, r0: { text: string; fullText: string | null; noteCode: MentionNoteCode | null; engine: MentionEngine; readers?: string[] | null }): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  const text = bodyOf(r0.text ?? "");
  if (!text) return completeMentionPrivate(id, { text: null, noteCode: "failed", proposals: [], engine: r0.engine });
  return inWorker(async (db) => {
    const r = await lockRow(db, id);
    if (!r || r.status !== "thinking" || r.reply_message_id) return r?.status ?? null;
    if (r.message_withdrawn) return (await withdrawIn(db, r)) ?? (await statusIn(db, id));
    const kept: MentionNoteCode | null = r.archived ? "archived" : !r.workspace_on ? "off_workspace" : !r.assistant_replies ? "off_conversation" : null;
    if (kept) return privateIn(db, r, { text: r0.fullText ?? text, noteCode: kept, proposals: [], engine: r0.engine });
    const reads = await db.one<{ ok: boolean }>(`SELECT app_conversation_has_reader($1, $2) AS ok`, [r.conversation_id, r.tagger_membership_id]);
    if (!reads.ok) return (await refuseIn(db, r, "not_allowed")) ?? (await statusIn(db, id));
    // The answer was checked against the readers when the run started (mentionReaders): anyone who has joined since was
    // not, so it stays with the tagger (security review, 8 October 2026), who may still post it.
    if (r0.readers) {
      const joined = await db.one<{ joined: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM app_conversation_readers($1) x WHERE NOT (x.membership_id = ANY($2::uuid[]))) AS joined`, [r.conversation_id, r0.readers]);
      if (joined.joined) return privateIn(db, r, { text: r0.fullText ?? text, noteCode: r0.noteCode, proposals: [], engine: r0.engine });
    }
    const msg = await db.one<{ id: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, reply_to_id, author_kind) VALUES ($1, $2, $3, $4, $5, 'assistant') RETURNING id`,
      [r.organisation_id, r.conversation_id, r.tagger_membership_id, text, r.message_id]);
    const moved = await db.maybeOne(
      `UPDATE assistant_mentions SET status = 'answered', reply_message_id = $2, engine = $3, lease_until = NULL, finished_at = now()
       WHERE id = $1 AND status = 'thinking' AND reply_message_id IS NULL RETURNING id`, [r.id, msg.id, r0.engine]);
    if (!moved) throw new Error("mention moved while its reply was written");
    const full = r0.fullText ? bodyOf(r0.fullText) : null;
    const note = r0.noteCode && isMentionNoteCode(r0.noteCode) ? r0.noteCode : null;
    if (full || note) await writePrivate(db, r, { kind: full ? "full_answer" : "note", body: full, noteCode: note });
    const assistant = assistantOf(r);
    const where = whereForTagger(r);
    await notify(db, {
      organisationId: r.organisation_id, recipientMembershipId: r.tagger_membership_id, type: "brenda.mention_reply",
      title: `${assistant.name} replied in ${where}`, body: clip(text, 300),
      resourceType: "conversation", resourceId: r.conversation_id, href: hrefOf(r), dedupKey: `mention.reply:${r.id}`,
    });
    const other = await otherUnmuted(db, r);
    if (other) {
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: other, type: "message.direct",
        title: `${firstName(r.tagger_name)}'s assistant ${assistant.name} replied in your chat`, body: clip(text, 120),
        resourceType: "conversation", resourceId: r.conversation_id, href: `/app/${r.slug}/messages?c=${r.conversation_id}`, dedupKey: `message:${msg.id}`,
      });
    }
    await logForTagger(db, r, `Answered you in ${where}`);
    await auditMention(db, r, "mention.answered", { replyMessageId: msg.id, engine: r0.engine });
    return "answered" as MentionStatus;
  });
}

/** The proposals as stored: index, the card's words, the token and when it stops working (never past the token's own expiry). */
function storeProposals(proposals: ConfirmProposal[], now = Date.now()): StoredProposal[] {
  const cap = now + MENTION_LIMITS.confirmMinutes * 60_000;
  return proposals.filter((p) => p && p.kind === "confirm" && typeof p.token === "string").slice(0, MAX_PROPOSALS).map((p, index) => {
    const exp = tokenExpiry(p.token);
    return {
      index, tool: String(p.tool ?? ""), summary: clip(String(p.summary ?? ""), 300), detail: p.detail ? clip(String(p.detail), 4000) : null,
      token: p.token, expiresAt: new Date(Math.min(cap, exp ?? cap)).toISOString(), state: "open", result: null,
    };
  });
}

/** The `exp` a signed token carries (seconds), as milliseconds; null when it cannot be read. Only the expiry: never trusted. */
function tokenExpiry(token: string): number | null {
  try {
    const body = token.split(".")[0];
    const exp = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch { return null; }
}

/** completeMentionPrivate's body, in the caller's worker transaction (the row is locked and thinking). */
async function privateIn(db: Db, r: ProcRow, p: { text: string | null; noteCode: MentionNoteCode | null; proposals: ConfirmProposal[]; engine: MentionEngine }): Promise<MentionStatus | null> {
  const stored = storeProposals(p.proposals ?? []);
  const text = p.text ? bodyOf(p.text) : null;
  const note: MentionNoteCode | null = p.noteCode && isMentionNoteCode(p.noteCode) ? p.noteCode : text ? null : "failed";
  const status: MentionStatus = stored.length ? "waiting_confirm" : "private";
  const moved = await db.maybeOne(
    `UPDATE assistant_mentions SET status = $2, engine = $3, lease_until = NULL, finished_at = now(),
            confirm_until = CASE WHEN $2 = 'waiting_confirm' THEN now() + make_interval(mins => $4) ELSE NULL END
     WHERE id = $1 AND status = 'thinking' RETURNING id`, [r.id, status, p.engine, MENTION_LIMITS.confirmMinutes]);
  if (!moved) return statusIn(db, r.id);
  await writePrivate(db, r, { kind: text ? "answer" : "note", body: text, noteCode: note, proposals: stored });
  const where = whereForTagger(r);
  if (stored.length) {
    await notify(db, {
      organisationId: r.organisation_id, recipientMembershipId: r.tagger_membership_id, type: "brenda.mention_confirm",
      title: `${answeringName(r)} needs you to confirm in ${where}`, body: stored[0].summary,
      resourceType: "conversation", resourceId: r.conversation_id, href: hrefOf(r), dedupKey: `mention.confirm:${r.id}`,
    });
  } else {
    await notifyPrivate(db, r, { text, noteCode: note });
  }
  // Someone else's assistant answered (phase 6): the tagger's own assistant did nothing for them, so no row of theirs.
  if (text && !r.owner_membership_id) await logForTagger(db, r, `Answered you privately in ${where}`);
  await auditMention(db, r, "mention.private", { engine: p.engine, proposals: stored.length, ...(note ? { code: note } : {}) });
  return status;
}

/** Keeps the answer for the tagger: status 'waiting_confirm' (any proposal; confirm_until = now() + confirmMinutes) or 'private'. */
export async function completeMentionPrivate(id: string, r0: { text: string | null; noteCode: MentionNoteCode | null; proposals: ConfirmProposal[]; engine: MentionEngine }): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  return inWorker(async (db) => {
    const r = await lockRow(db, id);
    if (!r || r.status !== "thinking") return r?.status ?? null;
    if (r.message_withdrawn) return (await withdrawIn(db, r)) ?? (await statusIn(db, id));
    return privateIn(db, r, r0);
  });
}

/** failed, with the private note 'failed' unless silent. From pending or thinking only. */
export async function failMention(id: string, opts: { silent?: boolean } = {}): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  return inWorker(async (db) => {
    const r = await lockRow(db, id);
    if (!r || (r.status !== "pending" && r.status !== "thinking")) return r?.status ?? null;
    return (await failIn(db, r, !!opts.silent)) ?? (await statusIn(db, id));
  });
}

/** refused, with the note for `code`. From pending or thinking only. */
export async function refuseMention(id: string, code: MentionNoteCode): Promise<MentionStatus | null> {
  if (!isUuid(id) || !isMentionNoteCode(code)) return null;
  return inWorker(async (db) => {
    const r = await lockRow(db, id);
    if (!r || (r.status !== "pending" && r.status !== "thinking")) return r?.status ?? null;
    return (await refuseIn(db, r, code)) ?? (await statusIn(db, id));
  });
}

/** The oldest mention still waiting in a conversation (a run that finishes drains it next). */
export async function nextPendingMention(conversationId: string): Promise<string | null> {
  if (!isUuid(conversationId)) return null;
  const r = await inWorker((db) => db.maybeOne<{ id: string }>(
    `SELECT id FROM assistant_mentions WHERE conversation_id = $1 AND status = 'pending' ORDER BY created_at, id LIMIT 1`, [conversationId]));
  return r?.id ?? null;
}

/** Pending with created_at < now - staleSeconds and no live lease, or thinking with an expired lease; oldest first; max 25. */
export async function staleMentions(opts: { now?: Date; limit?: number } = {}): Promise<{ id: string; attempts: number }[]> {
  const now = (opts.now ?? new Date()).toISOString();
  const limit = Math.min(25, Math.max(1, Math.round(opts.limit ?? 25)));
  const rows = await inWorker((db) => db.query<{ id: string; attempts: number }>(
    `SELECT id, attempts FROM assistant_mentions
     WHERE (status = 'pending' AND created_at < $1::timestamptz - make_interval(secs => $2) AND (lease_until IS NULL OR lease_until <= $1::timestamptz))
        OR (status = 'thinking' AND (lease_until IS NULL OR lease_until <= $1::timestamptz))
     ORDER BY created_at, id LIMIT $3`, [now, MENTION_LIMITS.staleSeconds, limit]));
  return rows ?? [];
}

/** Waiting for a Confirm past confirm_until → 'private' (the card shows the proposals expired). Returns how many moved. */
export async function settleMentionConfirms(opts: { now?: Date } = {}): Promise<number> {
  const now = (opts.now ?? new Date()).toISOString();
  const rows = await inWorker((db) => db.query(
    `UPDATE assistant_mentions SET status = 'private', confirm_until = NULL WHERE status = 'waiting_confirm' AND confirm_until <= $1::timestamptz RETURNING id`, [now]));
  return rows?.length ?? 0;
}

// ---- Views ------------------------------------------------------------------------------------------------------------------

type ViewRow = {
  id: string; message_id: string; conversation_id: string; status: MentionStatus; created_at: string; updated_at: string;
  tagger_membership_id: string; tagger_name: string; reply_message_id: string | null; confirm_until: string | null;
  lease_until: string | null; archived: boolean; replies_on: boolean;
  a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null;
  p_kind: MentionPrivateView["kind"] | null; p_body: string | null; p_note: string | null; p_proposals: unknown;
  p_posted_message_id: string | null; p_posted_at: string | null; p_dismissed_at: string | null;
  // Phase 6: someone else's assistant (null before 0043 and for the tagger's own).
  owner_membership_id: string | null; owner_name: string | null; oa_name: string | null; oa_colour: string | null; oa_visor: string | null; oa_eyes: string | null;
};

const viewSql = (ready43: boolean) => `
  SELECT am.id, am.message_id, am.conversation_id, am.status, am.created_at, am.updated_at, am.tagger_membership_id, tp.display_name AS tagger_name,
         am.reply_message_id, am.confirm_until, am.lease_until, (c.archived_at IS NOT NULL) AS archived,
         (c.assistant_replies AND COALESCE((SELECT bs.mention_replies FROM brenda_settings bs WHERE bs.organisation_id = c.organisation_id), true)) AS replies_on,
         ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes,
         pv.kind AS p_kind, pv.body AS p_body, pv.note_code AS p_note, pv.proposals AS p_proposals,
         pv.posted_message_id AS p_posted_message_id, pv.posted_at AS p_posted_at, pv.dismissed_at AS p_dismissed_at,
         ${ready43
           ? "am.owner_membership_id, owp.display_name AS owner_name, oap.name AS oa_name, oap.colour AS oa_colour, oap.visor AS oa_visor, oap.eyes AS oa_eyes"
           : "NULL::uuid AS owner_membership_id, NULL::text AS owner_name, NULL::text AS oa_name, NULL::text AS oa_colour, NULL::text AS oa_visor, NULL::text AS oa_eyes"}
  FROM assistant_mentions am
  JOIN conversations c ON c.id = am.conversation_id
  JOIN memberships tm ON tm.id = am.tagger_membership_id
  JOIN profiles tp ON tp.id = tm.user_id
  LEFT JOIN assistant_profiles ap ON ap.membership_id = am.tagger_membership_id
  LEFT JOIN assistant_mention_private pv ON pv.mention_id = am.id AND pv.tagger_membership_id = $2
  ${ready43 ? `LEFT JOIN memberships owm ON owm.id = am.owner_membership_id
  LEFT JOIN profiles owp ON owp.id = owm.user_id
  LEFT JOIN assistant_profiles oap ON oap.membership_id = am.owner_membership_id` : ""}`;

function proposalsOf(v: unknown): StoredProposal[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is StoredProposal => !!p && typeof p === "object" && typeof (p as StoredProposal).index === "number");
}

/** A stored proposal as the card reads it: no token, and past its time it reads expired. */
function proposalView(p: StoredProposal, now: number): MentionProposalView {
  const state = p.state === "open" && Date.parse(p.expiresAt) <= now ? "expired" : p.state;
  return { index: p.index, tool: p.tool, summary: p.summary, detail: p.detail ?? null, state, result: p.result ?? null };
}

function toView(r: ViewRow, me: string, now: number): MentionView {
  // The answering assistant: the tagger's own, or someone else's (phase 6), with its owner.
  const owner = r.owner_membership_id
    ? { membershipId: r.owner_membership_id, name: r.owner_name ?? "Someone", firstName: firstName(r.owner_name ?? "Someone"), isYou: r.owner_membership_id === me }
    : null;
  const assistant = owner
    ? toProfile({ name: r.oa_name, colour: r.oa_colour, visor: r.oa_visor, eyes: r.oa_eyes })
    : toProfile({ name: r.a_name, colour: r.a_colour, visor: r.a_visor, eyes: r.a_eyes });
  const isYou = r.tagger_membership_id === me;
  const code = r.p_note && isMentionNoteCode(r.p_note) ? r.p_note : null;
  const words = (c: MentionNoteCode) => (owner ? mentionNote(c, `${owner.firstName}'s ${assistant.name}`, { firstName: owner.firstName, assistantName: assistant.name }) : mentionNote(c, assistant.name));
  const priv: MentionPrivateView | null = isYou && r.p_kind ? {
    kind: r.p_kind,
    text: r.p_body,
    note: code ? { code, words: words(code) } : null,
    proposals: proposalsOf(r.p_proposals).map((p) => proposalView(p, now)),
    postedMessageId: r.p_posted_message_id, postedAt: r.p_posted_at, dismissedAt: r.p_dismissed_at,
    // Not while assistant replies are off here (review, 8 October 2026: an answer kept private because a switch went off
    // mid-run would otherwise be one press from the channel). Never for someone else's assistant (phase 6): its private
    // answer is what not everyone here may see about its owner's work, and not the tagger's to post.
    canPost: !owner && r.p_kind === "answer" && !!r.p_body && !r.p_posted_at && !r.p_dismissed_at && !r.archived && r.replies_on && r.status !== "withdrawn",
  } : null;
  return {
    id: r.id, messageId: r.message_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    tagger: { membershipId: r.tagger_membership_id, name: r.tagger_name, firstName: firstName(r.tagger_name), isYou },
    assistant,
    owner,
    replyMessageId: r.reply_message_id,
    thinking: (r.status === "pending" || r.status === "thinking") && Date.parse(r.created_at) > now - MENTION_LIMITS.thinkingShowsMinutes * 60_000,
    waiting: r.status === "waiting_confirm" && !!r.confirm_until && Date.parse(r.confirm_until) > now,
    private: priv,
  };
}

/** Mentions this person may read (row-level security as them: readers of the conversation; the private part the tagger's only). */
async function loadViews(db: Db, ctx: OrgContext, where: string, params: unknown[]): Promise<{ views: MentionView[]; rows: ViewRow[] }> {
  const rows = await db.query<ViewRow>(`${viewSql(await schema0043Ready(db))} WHERE am.organisation_id = $1 AND (${where}) ORDER BY am.created_at, am.id`, [ctx.org.id, ctx.membership.id, ...params]);
  const now = Date.now();
  return { views: rows.map((r) => toView(r, ctx.membership.id, now)), rows };
}

/**
 * For thread(): the assistant mentions whose tagging message is among `messageIds`, as this person reads them, and the
 * ones a page may restart (at most kickPerPage: pending past staleSeconds with no live lease, or thinking with an expired
 * lease). Run inside the thread's transaction, only once 0041 is applied.
 */
export async function threadMentions(db: Db, ctx: OrgContext, conversationId: string, messageIds: string[]): Promise<{ mentions: MentionView[]; kick: string[] }> {
  if (!messageIds.length) return { mentions: [], kick: [] };
  const { views, rows } = await loadViews(db, ctx, "am.conversation_id = $3 AND am.message_id = ANY($4::uuid[])", [conversationId, messageIds]);
  const now = Date.now();
  const stale = (r: ViewRow) => {
    const leaseLive = !!r.lease_until && Date.parse(r.lease_until) > now;
    if (r.status === "pending") return !leaseLive && Date.parse(r.created_at) < now - MENTION_LIMITS.staleSeconds * 1000;
    return r.status === "thinking" && !leaseLive;
  };
  return { mentions: views, kick: rows.filter(stale).slice(0, MENTION_LIMITS.kickPerPage).map((r) => r.id) };
}

/** The switches as a thread needs them (inside the thread's transaction, once 0041 is applied). */
export async function assistantRepliesIn(db: Db, conversationId: string): Promise<{ ready: true; workspaceOn: boolean; here: boolean; canChange: boolean }> {
  const r = await db.maybeOne<{ here: boolean; workspace_on: boolean; can_change: boolean }>(
    `SELECT c.assistant_replies AS here, COALESCE((SELECT bs.mention_replies FROM brenda_settings bs WHERE bs.organisation_id = c.organisation_id), true) AS workspace_on,
            app_can_manage_conversation(c.id) AS can_change
     FROM conversations c WHERE c.id = $1`, [conversationId]);
  return { ready: true, workspaceOn: r?.workspace_on ?? true, here: r?.here ?? true, canChange: !!r?.can_change };
}

/** Starts the processor for these mentions, after the caller's transaction (dynamic: the processor imports copilot, which imports messaging). Never throws. */
export async function kickMentions(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const m = await import("@/server/services/mention-processor");
    for (const id of ids) m.startMention(id);
  } catch (err) {
    warn("starting the assistant")(err);
  }
}

// ---- The tagger's and the managers' actions -------------------------------------------------------------------------------

/** Whether 0041 is there, as this person (for the routes' 503 before it). */
async function readyFor(ctx: OrgContext): Promise<boolean> {
  try { return await withUser(ctx.user.profileId, (db) => schema0041Ready(db)); } catch (err) { if (isMissingSchema(err)) { forget0041(); return false; } throw err; }
}

/** One mention, for someone who reads its conversation (the private part for the tagger only); null otherwise. */
export async function getMention(ctx: OrgContext, id: string): Promise<MentionView | null> {
  if (!isUuid(id)) return null;
  return retryWithout0041(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0041Ready(db))) throw notReady();
    return (await loadViews(db, ctx, "am.id = $3", [id])).views[0] ?? null;
  }));
}

type MineRow = {
  id: string; conversation_id: string; message_id: string; status: MentionStatus; tagger_membership_id: string; kind: ConversationKind; archived: boolean;
  p_kind: "answer" | "full_answer" | "note"; p_body: string | null; p_posted_at: string | null; p_dismissed_at: string | null; p_proposals: unknown;
  a_name: string | null; can_read: boolean;
  /** Phase 6: someone else's assistant answered (null for the tagger's own, and before 0043). */
  owner_membership_id: string | null;
};

/** The tagger's own private row, read as them (row-level security: theirs alone, while they read the conversation). */
async function readMine(ctx: OrgContext, id: string): Promise<MineRow> {
  if (!isUuid(id)) throw notFound(NOT_YOURS);
  const row = await retryWithout0041(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0041Ready(db))) throw notReady();
    const ready43 = await schema0043Ready(db);
    return db.maybeOne<MineRow>(
      `SELECT am.id, am.conversation_id, am.message_id, am.status, am.tagger_membership_id, c.kind, (c.archived_at IS NOT NULL) AS archived,
              pv.kind AS p_kind, pv.body AS p_body, pv.posted_at AS p_posted_at, pv.dismissed_at AS p_dismissed_at, pv.proposals AS p_proposals,
              ap.name AS a_name, app_can_read_conversation(am.conversation_id) AS can_read,
              ${ready43 ? "am.owner_membership_id" : "NULL::uuid AS owner_membership_id"}
       FROM assistant_mention_private pv
       JOIN assistant_mentions am ON am.id = pv.mention_id
       JOIN conversations c ON c.id = am.conversation_id
       LEFT JOIN assistant_profiles ap ON ap.membership_id = am.tagger_membership_id
       WHERE pv.mention_id = $1 AND am.organisation_id = $2 AND pv.tagger_membership_id = $3`, [id, ctx.org.id, ctx.membership.id]);
  }));
  if (!row || row.tagger_membership_id !== ctx.membership.id || !row.can_read) throw notFound(NOT_YOURS);
  return row;
}

/**
 * Post to channel (the tagger): the private answer becomes a normal 'via_assistant' message by the tagger, exactly the
 * stored text, replying to the tagging message. It carries no mentions and triggers nothing. One worker transaction
 * claims the answer (posted_at) and writes the message; a second press finds it posted (409).
 */
export async function postMention(ctx: OrgContext, id: string): Promise<{ messageId: string }> {
  const mine = await readMine(ctx, id);
  if (mine.p_kind !== "answer" || !mine.p_body) throw notFound(NOT_YOURS);
  // Someone else's assistant (phase 6): what it told the tagger privately is about its owner's work and is not the
  // tagger's to post (the card never offers it; this holds for a direct call too).
  if (mine.owner_membership_id) throw forbidden("This answer stays with you: it holds what not everyone here may see.");
  if (mine.p_posted_at || mine.p_dismissed_at) throw conflict("ALREADY_POSTED", "That answer was already posted or dismissed.");
  if (mine.archived) throw conflict("CONVERSATION_ARCHIVED", "This channel is archived. Restore it to write here again.");
  if (mine.status === "withdrawn") throw notFound(NOT_YOURS);
  const posted = await withWorker(async (db) => {
    const conv = await db.maybeOne<{ archived: boolean; replies_on: boolean }>(
      `SELECT (c.archived_at IS NOT NULL) AS archived,
              (c.assistant_replies AND COALESCE((SELECT bs.mention_replies FROM brenda_settings bs WHERE bs.organisation_id = c.organisation_id), true)) AS replies_on
       FROM conversations c WHERE c.id = $1`, [mine.conversation_id]);
    if (!conv || conv.archived) throw conflict("CONVERSATION_ARCHIVED", "This channel is archived. Restore it to write here again.");
    if (!conv.replies_on) throw conflict("ASSISTANT_REPLIES_OFF", "Assistant replies are off in this conversation, so this answer can't be posted here.");
    const claim = await db.maybeOne<{ body: string }>(
      `UPDATE assistant_mention_private SET posted_at = now() WHERE mention_id = $1 AND posted_at IS NULL AND dismissed_at IS NULL AND kind = 'answer' AND body IS NOT NULL RETURNING body`, [id]);
    if (!claim) throw conflict("ALREADY_POSTED", "That answer was already posted or dismissed.");
    const msg = await db.one<{ id: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, reply_to_id, author_kind) VALUES ($1, $2, $3, $4, $5, 'via_assistant') RETURNING id`,
      [ctx.org.id, mine.conversation_id, ctx.membership.id, claim.body, mine.message_id]);
    await db.query(`UPDATE assistant_mention_private SET posted_message_id = $2 WHERE mention_id = $1`, [id, msg.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "mention.posted", subjectType: "assistant_mention", subjectId: id, subjectMembershipId: ctx.membership.id, metadata: { mentionId: id, conversationId: mine.conversation_id, messageId: msg.id } });
    return { messageId: msg.id, body: claim.body };
  });
  // As the tagger: they have read their own thread up to now; a direct thread notifies the other person as any message
  // sent through their assistant does ("… sent you a message via Max"), unless they muted it.
  await withUser(ctx.user.profileId, async (db) => {
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now(), marked_unread = false`, [mine.conversation_id, ctx.org.id, ctx.membership.id]);
    if (mine.kind !== "direct") return;
    const others = await db.query<{ membership_id: string }>(
      `SELECT membership_id FROM conversation_participants WHERE conversation_id = $1 AND membership_id <> $2 AND NOT app_conversation_muted($1, membership_id)`, [mine.conversation_id, ctx.membership.id]);
    const name = toProfile({ name: mine.a_name }).name;
    for (const o of others) {
      await notify(db, {
        organisationId: ctx.org.id, recipientMembershipId: o.membership_id, type: "message.direct",
        title: `${ctx.user.displayName} sent you a message via ${name}`, body: clip(posted.body, 120),
        resourceType: "conversation", resourceId: mine.conversation_id, href: `/app/${ctx.org.slug}/messages?c=${mine.conversation_id}`, dedupKey: `message:${posted.messageId}`,
      });
    }
  }).catch(warn("after posting an answer"));
  return { messageId: posted.messageId };
}

const DECLINE_OPEN_SQL = `(SELECT COALESCE(jsonb_agg(CASE WHEN x.p->>'state' = 'open' THEN jsonb_set(x.p, '{state}', '"declined"') ELSE x.p END ORDER BY x.n), '[]'::jsonb)
                           FROM jsonb_array_elements(proposals) WITH ORDINALITY AS x(p, n))`;

/** Dismiss (the tagger): the private card goes; every open proposal is declined; a mention waiting for a Confirm is private. */
export async function dismissMention(ctx: OrgContext, id: string): Promise<{ id: string }> {
  const mine = await readMine(ctx, id);
  if (mine.p_dismissed_at) return { id };
  if (mine.p_posted_at) throw conflict("ALREADY_POSTED", "That answer was already posted or dismissed.");
  await withWorker(async (db) => {
    const done = await db.maybeOne(
      `UPDATE assistant_mention_private SET dismissed_at = now(), proposals = ${DECLINE_OPEN_SQL}
       WHERE mention_id = $1 AND dismissed_at IS NULL AND posted_at IS NULL RETURNING mention_id`, [id]);
    if (!done) {
      const now = await db.maybeOne<{ dismissed: boolean }>(`SELECT dismissed_at IS NOT NULL AS dismissed FROM assistant_mention_private WHERE mention_id = $1`, [id]);
      if (now?.dismissed) return;
      throw conflict("ALREADY_POSTED", "That answer was already posted or dismissed.");
    }
    await db.query(`UPDATE assistant_mentions SET status = 'private', confirm_until = NULL WHERE id = $1 AND status = 'waiting_confirm'`, [id]);
  });
  return { id };
}

/**
 * Withdraw an assistant's public reply (the tagger, or someone who runs the conversation: app_can_manage_conversation).
 * Only the worker may change an 'assistant' message (0037's guard), so this checks as the person, then soft-deletes the
 * reply through the worker (the row stays with an empty body so the thread keeps its shape) and marks the mention
 * withdrawn. Anyone else who reads the conversation gets 403; someone who does not, 404.
 */
export async function withdrawMentionReply(ctx: OrgContext, id: string): Promise<{ id: string }> {
  if (!isUuid(id)) throw notFound("That reply is no longer there.");
  const row = await retryWithout0041(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0041Ready(db))) throw notReady();
    const ready43 = await schema0043Ready(db);
    return db.maybeOne<{ id: string; conversation_id: string; status: MentionStatus; tagger_membership_id: string; owner_membership_id: string | null; can_manage: boolean }>(
      `SELECT am.id, am.conversation_id, am.status, am.tagger_membership_id, ${ready43 ? "am.owner_membership_id" : "NULL::uuid AS owner_membership_id"},
              app_can_manage_conversation(am.conversation_id) AS can_manage
       FROM assistant_mentions am WHERE am.id = $1 AND am.organisation_id = $2`, [id, ctx.org.id]);
  }));
  if (!row) throw notFound("That reply is no longer there.");
  // Someone else's assistant (phase 6): its owner may withdraw what it said too.
  const isOwner = !!row.owner_membership_id && row.owner_membership_id === ctx.membership.id;
  if (row.tagger_membership_id !== ctx.membership.id && !isOwner && !row.can_manage) {
    throw forbidden(row.owner_membership_id
      ? "Only the person who asked, the assistant's owner or someone who runs this conversation can withdraw it."
      : "Only the person who asked or someone who runs this conversation can withdraw it.");
  }
  if (row.status !== "answered") throw conflict("ALREADY_WITHDRAWN", row.status === "withdrawn" ? "That reply was already withdrawn." : "There is no reply to withdraw yet.");
  let retract: { ownerProfileId: string | null; ownerId: string | null; taggerProfileId: string | null } | null = null;
  await withWorker(async (db) => {
    await db.query(
      `UPDATE messages SET deleted_at = now()
       WHERE id = (SELECT reply_message_id FROM assistant_mentions WHERE id = $1 AND status = 'answered') AND author_kind = 'assistant' AND deleted_at IS NULL`, [id]);
    // The "I've asked Ben" line goes with the reply (phase 6).
    if (row.owner_membership_id) {
      await db.query(
        `UPDATE messages SET deleted_at = now()
         WHERE id = (SELECT holding_message_id FROM assistant_mentions WHERE id = $1 AND status = 'answered') AND author_kind = 'assistant' AND deleted_at IS NULL`, [id]);
      retract = await db.maybeOne<{ ownerProfileId: string | null; ownerId: string | null; taggerProfileId: string | null }>(
        `SELECT om.user_id AS "ownerProfileId", om.id AS "ownerId", tm.user_id AS "taggerProfileId"
         FROM assistant_mentions am LEFT JOIN memberships om ON om.id = am.owner_membership_id JOIN memberships tm ON tm.id = am.tagger_membership_id WHERE am.id = $1`, [id]);
    }
    const moved = await db.maybeOne<{ id: string; organisation_id: string; tagger_membership_id: string; conversation_id: string; message_id: string; reply_message_id: string | null }>(
      `UPDATE assistant_mentions SET status = 'withdrawn', lease_until = NULL WHERE id = $1 AND status = 'answered'
       RETURNING id, organisation_id, tagger_membership_id, conversation_id, message_id, reply_message_id`, [id]);
    if (!moved) throw conflict("ALREADY_WITHDRAWN", "That reply was already withdrawn.");
    // The notifications and the tagger's Activity line stop quoting it (migration 0042; before it they stay as they were,
    // as with any withdrawn message).
    if (await schema0042Ready(db)) await db.query(`SELECT app_retract_mention_reply($1)`, [id]);
    await audit(db, {
      organisationId: moved.organisation_id, actorMembershipId: ctx.membership.id, action: "mention.withdrawn", subjectType: "assistant_mention", subjectId: id,
      subjectMembershipId: moved.tagger_membership_id, metadata: { mentionId: id, conversationId: moved.conversation_id, messageId: moved.message_id, replyMessageId: moved.reply_message_id, by: ctx.membership.id === moved.tagger_membership_id ? "tagger" : isOwner ? "owner" : "manager" },
    });
  });
  // Someone else's assistant (phase 6): the owner's "Olu asked your Brenda" and the tagger's "Ben's Brenda replied" stop
  // quoting it. Notifications are changed only by their recipient (row-level security), so each as that person, after
  // the withdrawal has committed; a failure here never undoes it.
  const r = retract as { ownerProfileId: string | null; ownerId: string | null; taggerProfileId: string | null } | null;
  if (r) {
    const closeAs = (profileId: string | null, memberId: string, keys: string[]) => (profileId ? withUser(profileId, (db) => db.query(
      `UPDATE notifications SET body = 'This reply was withdrawn.', read_at = COALESCE(read_at, now()) WHERE recipient_membership_id = $1 AND deduplication_key = ANY($2::text[])`,
      [memberId, keys])).catch(warn("retracting a thread reply's notification")) : Promise.resolve());
    if (r.ownerId) await closeAs(r.ownerProfileId, r.ownerId, [`mention.owner:${id}`]);
    await closeAs(r.taggerProfileId, row.tagger_membership_id, [`mention.thread:${id}:1`, `mention.thread:${id}:2`]);
  }
  return { id };
}

const PROPOSAL_CLOSED = () => conflict("PROPOSAL_CLOSED", "That was already decided or has expired. Ask again.");

/**
 * The tagger decides one of the Confirm cards by its index (the token stays on the server). Decline closes it; Confirm
 * runs it through copilot's confirmAction, bound to the tagger as any Confirm is (its idempotency claim stops a second
 * press), and records what ran ('done', the actions' summaries) or why not ('failed'). When no proposal stays open, a
 * mention waiting for a Confirm becomes private.
 */
export async function decideMentionProposal(ctx: OrgContext, id: string, index: number, decision: "confirm" | "decline"): Promise<{ actions: Action[]; error: string | null; proposal: MentionProposalView }> {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PROPOSALS) throw notFound(NOT_YOURS);
  const mine = await readMine(ctx, id);
  const stored = proposalsOf(mine.p_proposals).find((p) => p.index === index);
  if (!stored) throw notFound(NOT_YOURS);
  if (stored.state !== "open" || Date.parse(stored.expiresAt) <= Date.now() || mine.p_dismissed_at) throw PROPOSAL_CLOSED();

  const setState = (state: MentionProposalView["state"], result: string | null) => withWorker(async (db) => {
    const r = await db.maybeOne<{ proposals: unknown }>(
      `UPDATE assistant_mention_private
       SET proposals = jsonb_set(jsonb_set(proposals, ARRAY[$2::text, 'state'], to_jsonb($3::text)), ARRAY[$2::text, 'result'], COALESCE(to_jsonb($4::text), 'null'::jsonb))
       WHERE mention_id = $1 AND proposals->($2::int)->>'state' = 'open' RETURNING proposals`, [id, String(index), state, result]);
    if (!r) return null;
    const open = proposalsOf(r.proposals).some((p) => p.state === "open" && Date.parse(p.expiresAt) > Date.now());
    if (!open) await db.query(`UPDATE assistant_mentions SET status = 'private', confirm_until = NULL WHERE id = $1 AND status = 'waiting_confirm'`, [id]);
    return proposalsOf(r.proposals).find((p) => p.index === index) ?? null;
  });

  if (decision === "decline") {
    const p = await setState("declined", null);
    if (!p) throw PROPOSAL_CLOSED();
    return { actions: [], error: null, proposal: proposalView(p, Date.now()) };
  }
  const { confirmAction } = await import("@/server/services/copilot");
  let result: { actions: Action[]; error: string | null };
  try {
    result = await confirmAction(ctx, stored.token);
  } catch (err) {
    if (err instanceof AppError && err.code === "ALREADY_CONFIRMED") throw PROPOSAL_CLOSED();
    if (err instanceof AppError && err.status < 500) {
      const p = await setState("failed", clip(err.message, 300));
      return { actions: [], error: err.message, proposal: p ? proposalView(p, Date.now()) : { ...proposalView(stored, Date.now()), state: "failed", result: err.message } };
    }
    throw err;
  }
  const p = result.error
    ? await setState("failed", clip(result.error, 300))
    : await setState("done", clip(result.actions.map((a) => a.summary).filter(Boolean).join(". ") || "Done.", 500));
  const view = p ? proposalView(p, Date.now()) : { ...proposalView(stored, Date.now()), state: (result.error ? "failed" : "done") as MentionProposalView["state"], result: result.error };
  return { actions: result.actions, error: result.error, proposal: view };
}

// ---- Someone else's assistant in a thread (owner decision, 8 October 2026: personal assistants, phase 6) -------------------
// The run (mention-processor.ts) calls no model. Every step below is one guarded worker transaction on the locked row,
// so the processor, the follow-up's own transitions and the sweep may all call them, in any order, any number of times.

/** Open for a run of someone else's assistant: working, or waiting for the owner's reply. */
const OWNER_OPEN_SQL = `('thinking', 'asked')`;

/** Like inWorker, and nothing before 0043 (the owner's columns are not there). */
async function inWorker43<T>(fn: (db: Db) => Promise<T>): Promise<T | null> {
  try {
    return await withWorker(async (db) => ((await schema0041Ready(db)) && (await schema0043Ready(db)) ? fn(db) : null));
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); forget0043(); return null; }
    throw err;
  }
}

/** The conversation as the owner reads it in a notification: "#Design", "Everyone", or "your chat with Olu Adeyemi". */
const whereForOwner = (r: ProcRow) => (r.kind === "direct" ? `your chat with ${r.tagger_name}` : r.channel_name ?? "a conversation");

/** A run links the follow-up it asked (guarded: still thinking, none linked yet). */
export async function linkMentionFollowUp(id: string, followUpId: string): Promise<boolean> {
  if (!isUuid(id) || !isUuid(followUpId)) return false;
  const r = await inWorker43((db) => db.maybeOne(
    `UPDATE assistant_mentions SET follow_up_id = $2 WHERE id = $1 AND status = 'thinking' AND follow_up_id IS NULL AND owner_membership_id IS NOT NULL RETURNING id`, [id, followUpId]));
  return !!r;
}

export type OwnerThreadState = {
  mention: {
    id: string; status: MentionStatus; organisationId: string; conversationId: string; messageId: string;
    taggerMembershipId: string; taggerName: string; ownerMembershipId: string; ownerName: string; ownerAssistant: AssistantProfile;
    holding: boolean; messageWithdrawn: boolean; slug: string; timezone: string;
    /** The conversation in the owner's words: "#Design", "Everyone", "your chat with Olu Adeyemi". */
    whereForOwner: string;
  };
  followUp: {
    id: string; status: FollowUpStatus; answeredFrom: "facts" | "person" | "deadline" | null; capped: boolean;
    replyChoice: ReplyChoice | null; replyNote: string | null; deadlineAt: string | null; facts: unknown; answer: string | null;
    threadMode: "facts" | "ask" | null; taskId: string | null;
  };
};

/** The mention a follow-up was asked for, and the follow-up as it stands (worker); null when there is none, or before 0043. */
export async function ownerThreadState(followUpId: string): Promise<OwnerThreadState | null> {
  if (!isUuid(followUpId)) return null;
  const r = await inWorker43((db) => db.maybeOne<{
    id: string; status: MentionStatus; organisation_id: string; conversation_id: string; message_id: string; tagger_membership_id: string; tagger_name: string;
    owner_membership_id: string; owner_name: string; oa_name: string | null; oa_colour: string | null; oa_visor: string | null; oa_eyes: string | null;
    holding: boolean; message_withdrawn: boolean; slug: string; timezone: string; kind: ConversationKind; channel_name: string | null;
    f_status: FollowUpStatus; answered_from: OwnerThreadState["followUp"]["answeredFrom"]; capped: boolean; reply_choice: ReplyChoice | null; reply_note: string | null;
    deadline_at: string | null; facts: unknown; answer: string | null; thread_mode: "facts" | "ask" | null; task_id: string | null;
  }>(
    `SELECT am.id, am.status, am.organisation_id, am.conversation_id, am.message_id, am.tagger_membership_id, tp.display_name AS tagger_name,
            am.owner_membership_id, owp.display_name AS owner_name, oap.name AS oa_name, oap.colour AS oa_colour, oap.visor AS oa_visor, oap.eyes AS oa_eyes,
            (am.holding_message_id IS NOT NULL) AS holding, (msg.id IS NULL OR msg.deleted_at IS NOT NULL) AS message_withdrawn, o.slug, o.timezone,
            c.kind, CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN '#' || tt.name WHEN 'channel' THEN '#' || c.title END AS channel_name,
            f.status AS f_status, f.answered_from, f.capped, f.reply_choice, f.reply_note, f.deadline_at, f.facts, f.answer, f.thread_mode, f.task_id
     FROM assistant_mentions am
     JOIN follow_ups f ON f.id = am.follow_up_id
     JOIN organisations o ON o.id = am.organisation_id
     JOIN conversations c ON c.id = am.conversation_id
     LEFT JOIN teams tt ON tt.id = c.team_id
     JOIN memberships tm ON tm.id = am.tagger_membership_id JOIN profiles tp ON tp.id = tm.user_id
     JOIN memberships owm ON owm.id = am.owner_membership_id JOIN profiles owp ON owp.id = owm.user_id
     LEFT JOIN assistant_profiles oap ON oap.membership_id = am.owner_membership_id
     LEFT JOIN messages msg ON msg.id = am.message_id
     WHERE am.follow_up_id = $1`, [followUpId]));
  if (!r) return null;
  return {
    mention: {
      id: r.id, status: r.status, organisationId: r.organisation_id, conversationId: r.conversation_id, messageId: r.message_id,
      taggerMembershipId: r.tagger_membership_id, taggerName: r.tagger_name, ownerMembershipId: r.owner_membership_id, ownerName: r.owner_name,
      ownerAssistant: toProfile({ name: r.oa_name, colour: r.oa_colour, visor: r.oa_visor, eyes: r.oa_eyes }),
      holding: r.holding, messageWithdrawn: r.message_withdrawn, slug: r.slug, timezone: r.timezone,
      whereForOwner: r.kind === "direct" ? `your chat with ${r.tagger_name}` : r.channel_name ?? "a conversation",
    },
    followUp: {
      id: followUpId, status: r.f_status, answeredFrom: r.answered_from, capped: !!r.capped, replyChoice: r.reply_choice, replyNote: r.reply_note,
      deadlineAt: r.deadline_at, facts: r.facts, answer: r.answer, threadMode: r.thread_mode, taskId: r.task_id,
    },
  };
}

/**
 * What a run of someone else's assistant does next in the thread:
 * - holding: "I've asked Ben. I'll reply here by 15:30." (thinking → asked; the tagger is told).
 * - final: its public line (thinking or asked → answered), with `privateText` kept for the tagger alone (an answer only
 *   they may see), `ownerBody` for the owner's "Olu asked your Brenda" notification and `activity` for the owner's "What
 *   Brenda did". `readers`: who read the conversation when its words were checked; anyone who has joined since was not,
 *   so `fallback` is posted instead (or it all goes to the tagger privately).
 * - private: kept for the tagger (thinking or asked → private), with a note code when there is one.
 * - fail: the tagger's private note 'failed' (thinking or asked → failed).
 * Checked first, in the same transaction: the tagging message withdrawn → withdrawn (its holding line too); archived or a
 * switch now off (the workspace's, the conversation's, the owner's) → the words go to the tagger privately; the tagger no
 * longer reads it → refused; the owner no longer reads it → private ('owner_left').
 */
export type OwnerPost =
  | { kind: "holding"; text: string }
  | { kind: "final"; text: string; privateText?: string | null; ownerBody?: string | null; activity?: string | null; readers?: string[] | null;
      fallback?: { text: string; privateText: string | null; ownerBody: string | null } | null }
  | { kind: "private"; text: string | null; noteCode: MentionNoteCode | null }
  | { kind: "fail" };

export async function postOwnerThread(id: string, p: OwnerPost): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  return inWorker43(async (db) => {
    const r = await lockRow(db, id);
    if (!r || !r.owner_membership_id) return r?.status ?? null;
    if (r.status !== "thinking" && r.status !== "asked") return r.status;
    if (p.kind === "holding" && (r.status !== "thinking" || r.holding_message_id)) return r.status;
    if (r.message_withdrawn) return withdrawOwnerIn(db, r);
    if (p.kind === "fail") return ownerEndIn(db, r, "failed", "failed");
    const keepText = p.kind === "final" ? (p.privateText ?? p.text) : p.text;
    if (p.kind === "private") return ownerPrivateIn(db, r, keepText, p.noteCode);
    const kept: MentionNoteCode | null = r.archived ? "archived" : !r.workspace_on ? "off_workspace" : !r.assistant_replies ? "off_conversation" : r.owner_allows === false ? "off_owner" : null;
    if (kept) return ownerPrivateIn(db, r, keepText, kept);
    const reads = await db.one<{ tagger: boolean; owner: boolean }>(
      `SELECT app_conversation_has_reader($1, $2) AS tagger, app_conversation_has_reader($1, $3) AS owner`, [r.conversation_id, r.tagger_membership_id, r.owner_membership_id]);
    if (!reads.tagger) return ownerEndIn(db, r, "refused", "not_allowed");
    if (!reads.owner || r.owner_status !== "active") return ownerPrivateIn(db, r, keepText, "owner_left");
    let post = p;
    if (p.kind === "final" && p.readers) {
      const joined = await db.one<{ joined: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM app_conversation_readers($1) x WHERE NOT (x.membership_id = ANY($2::uuid[]))) AS joined`, [r.conversation_id, p.readers]);
      if (joined.joined) {
        if (!p.fallback) return ownerPrivateIn(db, r, keepText, null);
        post = { kind: "final", text: p.fallback.text, privateText: p.fallback.privateText, ownerBody: p.fallback.ownerBody, activity: p.activity };
      }
    }
    const text = bodyOf(post.text);
    if (!text) return ownerPrivateIn(db, r, keepText, keepText ? null : "failed");
    const msg = await db.one<{ id: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, reply_to_id, author_kind) VALUES ($1, $2, $3, $4, $5, 'assistant') RETURNING id`,
      [r.organisation_id, r.conversation_id, r.owner_membership_id, text, r.message_id]);
    const holding = post.kind === "holding";
    const moved = holding
      ? await db.maybeOne(`UPDATE assistant_mentions SET status = 'asked', holding_message_id = $2, engine = 'builtin', lease_until = NULL WHERE id = $1 AND status = 'thinking' AND holding_message_id IS NULL RETURNING id`, [r.id, msg.id])
      : await db.maybeOne(`UPDATE assistant_mentions SET status = 'answered', reply_message_id = $2, engine = 'builtin', lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OWNER_OPEN_SQL} AND reply_message_id IS NULL RETURNING id`, [r.id, msg.id]);
    if (!moved) throw new Error("mention moved while its reply was written");
    const ownerFirst = firstName(r.owner_name ?? "Someone");
    const oa = ownerAssistantOf(r);
    if (post.kind === "final" && post.privateText) await writePrivate(db, r, { kind: "answer", body: post.privateText, noteCode: null });
    await notify(db, {
      organisationId: r.organisation_id, recipientMembershipId: r.tagger_membership_id, type: "assistant.thread_reply",
      title: `${ownerFirst}'s ${oa.name} replied in ${whereForTagger(r)}`, body: clip(text, 300),
      resourceType: "conversation", resourceId: r.conversation_id, href: hrefOf(r), dedupKey: `mention.thread:${r.id}:${holding ? 1 : 2}`,
    });
    if (post.kind === "final" && post.ownerBody) {
      await notify(db, {
        organisationId: r.organisation_id, recipientMembershipId: r.owner_membership_id, type: "assistant.tagged",
        title: `${firstName(r.tagger_name)} asked your ${oa.name} in ${whereForOwner(r)}`, body: clip(post.ownerBody, 200),
        resourceType: "conversation", resourceId: r.conversation_id, href: hrefOf(r), dedupKey: `mention.owner:${r.id}`,
      });
    }
    if (post.kind === "final" && post.activity) {
      await db.query(
        `INSERT INTO brenda_actions(organisation_id, membership_id, tool, summary, outcome, source, detail) VALUES ($1, $2, 'follow_up_answer', $3, 'done', 'automatic', $4::jsonb)`,
        [r.organisation_id, r.owner_membership_id, "Answered a colleague's question in Messages", JSON.stringify({ href: hrefOf(r), personalSummary: clip(post.activity, 500), conversationId: r.conversation_id, mentionId: r.id })]);
    }
    await auditMention(db, r, holding ? "mention.asked" : "mention.answered", { [holding ? "holdingMessageId" : "replyMessageId"]: msg.id, engine: "builtin" });
    return (holding ? "asked" : "answered") as MentionStatus;
  });
}

/** The tagging message was withdrawn: withdrawn, and the "I've asked Ben" line goes too. True when it moved now. */
export async function withdrawOwnerMention(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const s = await inWorker43(async (db) => {
    const r = await lockRow(db, id);
    if (!r || !r.owner_membership_id) return null;
    return withdrawOwnerIn(db, r);
  });
  return s === "withdrawn";
}

async function withdrawOwnerIn(db: Db, r: ProcRow): Promise<MentionStatus | null> {
  const moved = await db.maybeOne(`UPDATE assistant_mentions SET status = 'withdrawn', lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ('pending', 'thinking', 'asked') RETURNING id`, [r.id]);
  if (!moved) return statusIn(db, r.id);
  if (r.holding_message_id) await db.query(`UPDATE messages SET deleted_at = now() WHERE id = $1 AND author_kind = 'assistant' AND deleted_at IS NULL`, [r.holding_message_id]);
  await auditMention(db, r, "mention.withdrawn", { by: "tagger" });
  return "withdrawn";
}

/** Kept for the tagger (thinking or asked → private), with the answer or a note; the tagger is told. */
async function ownerPrivateIn(db: Db, r: ProcRow, text: string | null, noteCode: MentionNoteCode | null): Promise<MentionStatus | null> {
  const body = text?.trim() ? text : null;
  const note: MentionNoteCode | null = noteCode ?? (body ? null : "failed");
  const moved = await db.maybeOne(
    `UPDATE assistant_mentions SET status = 'private', engine = 'builtin', lease_until = NULL, confirm_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OWNER_OPEN_SQL} RETURNING id`, [r.id]);
  if (!moved) return statusIn(db, r.id);
  await writePrivate(db, r, { kind: body ? "answer" : "note", body, noteCode: note });
  await notifyPrivate(db, r, { text: body, noteCode: note });
  await auditMention(db, note && OWNER_PRIVATE_CODES.has(note) ? { ...r, owner_membership_id: null } : r, "mention.private", { engine: "builtin", proposals: 0, ...(note ? { code: OWNER_PRIVATE_CODES.has(note) ? "owner_unavailable" : note } : {}) });
  return "private";
}

/** Refused or failed (thinking or asked), with the tagger's note. */
async function ownerEndIn(db: Db, r: ProcRow, status: "refused" | "failed", code: MentionNoteCode): Promise<MentionStatus | null> {
  const moved = await db.maybeOne(`UPDATE assistant_mentions SET status = $2, lease_until = NULL, finished_at = now() WHERE id = $1 AND status IN ${OWNER_OPEN_SQL} RETURNING id`, [r.id, status]);
  if (!moved) return statusIn(db, r.id);
  await writePrivate(db, r, { kind: "note", body: null, noteCode: code });
  await notifyPrivate(db, r, { text: null, noteCode: code });
  await auditRefusal(db, r, status === "refused" ? "mention.refused" : "mention.failed", code);
  return status;
}

/**
 * Runs of someone else's assistant that wait on a follow-up now closed, or whose tagging message was withdrawn: what the
 * mention sweep syncs (the follow-up's own sync may have been lost to a restart). Their follow-up ids, oldest first.
 */
export async function ownerMentionsToSync(opts: { limit?: number } = {}): Promise<string[]> {
  const limit = Math.min(25, Math.max(1, Math.round(opts.limit ?? 10)));
  const rows = await inWorker43((db) => db.query<{ follow_up_id: string }>(
    `SELECT am.follow_up_id FROM assistant_mentions am
     JOIN follow_ups f ON f.id = am.follow_up_id
     LEFT JOIN messages msg ON msg.id = am.message_id
     WHERE am.status = 'asked' AND (f.status NOT IN ('pending', 'asking', 'answering') OR msg.id IS NULL OR msg.deleted_at IS NOT NULL)
     ORDER BY am.updated_at, am.id LIMIT $1`, [limit]));
  return (rows ?? []).map((r) => r.follow_up_id);
}

// ---- Switches -------------------------------------------------------------------------------------------------------------

/** "Let people ask their assistant in Messages" (members may read it). `{ ready: false, enabled: true }` before 0041. */
export async function mentionSettings(db: Db, orgId: string): Promise<{ ready: boolean; enabled: boolean }> {
  if (!(await schema0041Ready(db))) return { ready: false, enabled: true };
  const r = await db.maybeOne<{ on: boolean }>(`SELECT mention_replies AS on FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, enabled: r?.on ?? true };
}

/** Owners and HR, under the same lock as the organisation's other Brenda settings; logged in Settings → Brenda's log. */
export async function saveMentionSettings(ctx: OrgContext, patch: { enabled: boolean }): Promise<{ ready: true; enabled: boolean }> {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the organisation owner or HR can change this.");
  const enabled = !!patch.enabled;
  return retryWithout0041(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0041Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, mention_replies, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organisation_id) DO UPDATE SET mention_replies = $2, updated_by = $3, updated_at = now()`, [ctx.org.id, enabled, ctx.membership.id]);
    await logAction(db, ctx, { tool: "settings", outcome: "done", source: "confirm", summary: enabled ? "Mentions in Messages: assistants may reply" : "Mentions in Messages: off" });
    return { ready: true as const, enabled };
  }));
}

/** "Assistants can reply here", through the definer function (the app role cannot update conversations). */
export async function setConversationAssistantReplies(ctx: OrgContext, conversationId: string, allowed: boolean): Promise<{ assistantReplies: boolean }> {
  if (!isUuid(conversationId)) throw notFound("That conversation does not exist or you are not part of it.");
  return retryWithout0041(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0041Ready(db))) throw notReady();
    const conv = await db.maybeOne<{ id: string }>(`SELECT id FROM conversations WHERE id = $1 AND organisation_id = $2`, [conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    try {
      await db.query(`SAVEPOINT assistant_replies`);
      await db.query(`SELECT app_conversation_set_assistant_replies($1, $2)`, [conversationId, !!allowed]);
      await db.query(`RELEASE SAVEPOINT assistant_replies`);
    } catch (err) {
      await db.query(`ROLLBACK TO SAVEPOINT assistant_replies`).catch(() => undefined);
      if (((err as Error).message ?? "").includes("CONVERSATION_FORBIDDEN")) throw forbidden("Only someone who runs this conversation can change this.");
      throw err;
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "conversation.assistant_replies", subjectType: "conversation", subjectId: conversationId, metadata: { allowed: !!allowed } });
    return { assistantReplies: !!allowed };
  }));
}

// ---- The audience rule (C.2) ---------------------------------------------------------------------------------------------

/** The ids of `ids` that every current reader of the conversation can see, asked as the person (app_visible_to_readers). */
export async function visibleToReaders(ctx: OrgContext, conversationId: string, kind: "task" | "doc" | "conversation", ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(isUuid).map((x) => x.toLowerCase()))];
  if (!list.length || !isUuid(conversationId)) return new Set();
  try {
    return await withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0041Ready(db))) return new Set<string>();
      // 0042 lists the readers once per call instead of once per item (review, 8 October 2026); same answers.
      const rows = await db.query<{ id: string }>((await schema0042Ready(db))
        ? `SELECT x::text AS id FROM app_visible_to_readers_many($1, $2, $3::uuid[]) x`
        : `SELECT x::text AS id FROM unnest($3::uuid[]) x WHERE app_visible_to_readers($1, $2, x)`, [conversationId, kind, list]);
      return new Set(rows.map((r) => r.id));
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); return new Set(); }
    if ((err as { code?: string })?.code === "42883") forget0042();
    throw err;
  }
}

/** For the routes: 503 before 0041. */
export async function requireMentionsReady(ctx: OrgContext): Promise<void> {
  if (!(await readyFor(ctx))) throw notReady();
}

/** For tests and the processor: the mention's status now (worker). */
export async function mentionStatus(id: string): Promise<MentionStatus | null> {
  if (!isUuid(id)) return null;
  try { return await statusNow(id); } catch (err) { if (isMissingSchema(err)) { forget0041(); return null; } throw err; }
}
