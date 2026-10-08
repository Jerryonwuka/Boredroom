/**
 * Messaging: direct threads between any two people in an organisation, a channel per team and one
 * organisation-wide channel. A message can point at a task ("how far with this?"). Access is enforced by
 * row-level security (see db/migrations/0015_messaging.sql); this module only shapes queries.
 *
 * Who wrote a message (owner decision, 8 October 2026: personal assistants, phase 3; migration 0037): the person
 * ('person'), the person's own assistant for them after they confirmed it ('via_assistant': her send_message tool, the
 * only caller of `sendMessage(..., { via: "assistant" })`; the Messages composer can never ask for it), or the assistant
 * itself ('assistant': its own words in a thread, written only by the worker; reserved for phases 4 and 5). A message
 * that is not the person's carries the sender's own assistant (name and look, from assistant_profiles, which everyone in
 * the workspace reads). An assistant's own message is never "yours": it shows on the left and cannot be edited or
 * withdrawn. Unread counts, the badge and toasts still count by sender (review, 8 October 2026: decision 7). Until 0037
 * is applied every message reads as the person's (server/lib/schema-0037).
 *
 * @mentions (owner decision, 8 October 2026: personal assistants, phase 5; migration 0041): the composer sends tokens
 * beside the body ("@Max" for the sender's own assistant, "@Ben Okafor" for a person who reads the conversation); the
 * send checks each against the body and the conversation, stores the valid ones (message_mentions), notifies each person
 * mentioned (even in a conversation they muted) and queues one assistant mention (assistant_mentions) that the
 * processor answers right after the response. Nothing ever re-parses names later; edits never add, notify or trigger
 * anything; an assistant's own messages never carry mentions. A thread carries each message's mentions for the
 * highlight, the assistant mentions in view (the private part for the tagger only) and the conversation's switches.
 * Until 0041 is applied mentions are ignored (server/lib/schema-0041).
 *
 * Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6; migration 0043): the composer
 * may also tag another reader's assistant ("@Ben's Brenda", or "@Ben Okafor's Brenda" when another reader shares the
 * first name; `others_assistant` tokens). The send keeps it when Ben reads the conversation and lets people tag his
 * assistant, and queues the mention with Ben as its owner; at most one assistant per message, own or someone else's. A
 * thread lists the assistants that may be tagged (`taggable`), and marks the owner's assistant's messages with who asked
 * (`mention_reply.askedBy`) and the "I've asked Ben" line (`holding`). Before 0043 none of this is offered or kept.
 */
import { z } from "zod";
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { invalid, notFound, conflict, forbidden } from "@/server/lib/errors";
import { notify } from "@/server/services/common";
import { storage, tenantKey } from "@/server/lib/storage";
import { retryWithout0037, schema0037Ready } from "@/server/lib/schema-0037";
import { forget0041, isMissingSchema, retryWithout0041, schema0041Ready } from "@/server/lib/schema-0041";
import { forget0043, schema0043Ready } from "@/server/lib/schema-0043";
import { readPersonalAssistant } from "@/server/services/assistant-profile";
import { assistantRepliesIn, kickMentions, threadMentions, validateMentions } from "@/server/services/mentions";
import { toProfile, type AssistantProfile } from "@/lib/assistant-look";
import { clip } from "@/lib/follow-ups";
import { MENTION_LIMITS, otherAssistantLabels, type AssistantRepliesState, type MentionRef, type MentionView, type TaggableAssistant } from "@/lib/mentions";
import type { Presence } from "@/lib/presence";

/** `active`: still a member of the workspace (people who left stay in a named channel's or direct thread's list). */
export type Participant = { membership_id: string; display_name: string; role: string; profile_id: string; avatar_key: string | null; presence: Presence; active: boolean };

export type ConversationKind = "direct" | "team" | "organisation" | "channel";

/** Who wrote a message (migration 0037): the person, their own assistant for them after they confirmed, or the assistant itself. */
export type AuthorKind = "person" | "via_assistant" | "assistant";
export const AUTHOR_KINDS: readonly AuthorKind[] = ["person", "via_assistant", "assistant"];

export type ConversationSummary = {
  id: string; kind: ConversationKind; title: string; subtitle: string | null; team_id: string | null; other_membership_id: string | null;
  other_profile_id: string | null; other_avatar_key: string | null; other_presence: Presence | null;
  archived_at: string | null; created_by: string | null; can_manage: boolean;
  last_message_at: string | null; last_body: string | null; last_sender_name: string | null; unread: number;
  muted: boolean; marked_unread: boolean;
  /** The person's own reads row: when they last read this conversation (null: never opened). */
  last_read_at: string | null;
  /** Who wrote the last message (null when there is none). */
  last_author_kind: AuthorKind | null;
  /** The last sender's own assistant's name when the last message is not the person's own words. */
  last_assistant_name: string | null;
};
export type MessageRow = {
  id: string; sender_membership_id: string; sender_name: string; sender_profile_id: string; sender_avatar_key: string | null; body: string; created_at: string; deleted_at: string | null; edited_at: string | null;
  task_id: string | null; task_title: string | null; task_status: string | null;
  /** The caller sent it as themself or through their own assistant; an assistant's own message is never "yours". */
  mine: boolean;
  voice_key: string | null; voice_mime: string | null; voice_seconds: number | null;
  reply_to_id: string | null; reply_body: string | null; reply_sender_name: string | null; reply_mine: boolean | null;
  author_kind: AuthorKind;
  /** Name and look of the SENDER's own assistant; set exactly when author_kind is not 'person'. */
  assistant: AssistantProfile | null;
  reply_author_kind: AuthorKind | null;
  reply_assistant_name: string | null;
  /** The mentions stored when it was sent (migration 0041), for the highlight; [] before it. */
  mentions: MentionRef[];
  /**
   * An assistant's public reply to a mention, not yet withdrawn: its mention, and whether the caller may withdraw it (the
   * tagger, the assistant's owner, or someone who runs the conversation). Phase 6, someone else's assistant: `askedBy`
   * is who tagged it ("asked by Olu"), and `holding` marks its "I've asked Ben. I'll reply here." line (never withdrawn on
   * its own: it goes with the reply). Both are absent for a person's own assistant, whose reply keeps phase 5's shape.
   */
  mention_reply: { mentionId: string; canWithdraw: boolean; askedBy?: { membershipId: string; firstName: string; isYou: boolean } | null; holding?: boolean } | null;
};
export type Thread = {
  conversation: ConversationSummary & { people: Participant[] };
  messages: MessageRow[];
  /** Every assistant mention whose tagging message is shown (migration 0041); the private part is the tagger's only. */
  mentions: MentionView[];
  /** "Assistants can reply here" and the workspace's switch, as the composer and the details pane need them. */
  assistantReplies: AssistantRepliesState;
  /** Phase 6: the other readers' assistants the caller may tag here (shown disabled when the owner switched tags off); [] before 0043. */
  taggable: TaggableAssistant[];
};

/** The switches before migration 0041: nothing to show, nothing to change. */
const NO_REPLIES: AssistantRepliesState = { ready: false, workspaceOn: true, here: true, canChange: false };

/**
 * The number on the Messages badge, as one SQL expression over `org` and `me` placeholders: every unread message in a
 * conversation the person can read, muted and hidden threads and archived channels left out, plus one for each
 * conversation they marked unread that has nothing new in it. The app shell and the page use the same expression,
 * so the badge and the list always agree.
 */
export const unreadMessagesSql = (org: string, me: string) => `(
  (SELECT count(*)::int
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = ${me}
     WHERE c.organisation_id = ${org} AND m.deleted_at IS NULL AND m.sender_membership_id <> ${me} AND c.archived_at IS NULL AND r.muted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = ${me})
       AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = ${me})))
  + (SELECT count(*)::int
       FROM conversation_reads r JOIN conversations c ON c.id = r.conversation_id
       WHERE c.organisation_id = ${org} AND r.membership_id = ${me} AND r.marked_unread AND r.muted_at IS NULL AND c.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = ${me})
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_membership_id <> ${me} AND m.created_at > r.last_read_at))
)`;

export async function unreadMessageCount(db: Db, ctx: OrgContext): Promise<number> {
  const r = await db.one<{ n: number }>(`SELECT ${unreadMessagesSql("$1", "$2")} AS n`, [ctx.org.id, ctx.membership.id]);
  return r.n;
}

/** Makes sure the organisation channel and the caller's team channels exist, so the inbox always lists them. */
async function ensureChannels(db: Db, ctx: OrgContext) {
  await db.query(`SELECT app_channel_conversation($1, NULL)`, [ctx.org.id]);
  const teams = await db.query<{ team_id: string }>(`SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $1 AND t.archived_at IS NULL`, [ctx.membership.id]);
  for (const t of teams) await db.query(`SELECT app_channel_conversation($1, $2)`, [ctx.org.id, t.team_id]);
}

/**
 * One statement for the inbox and a thread's header. `ready` (migration 0037) adds who wrote the last message and the
 * name of the last sender's assistant; before it they read as the person's.
 */
const summarySql = (ready: boolean) => `
  SELECT c.id, c.kind, c.team_id, c.last_message_at, c.archived_at, c.created_by,
         (c.kind = 'channel' AND (c.created_by = $2 OR app_has_role(c.organisation_id, 'owner', 'hr'))) AS can_manage,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN t.name WHEN 'channel' THEN c.title ELSE po.display_name END AS title,
         CASE c.kind WHEN 'organisation' THEN o.name WHEN 'team' THEN 'Team channel' WHEN 'channel' THEN (SELECT count(*)::text || ' people' FROM conversation_participants pp WHERE pp.conversation_id = c.id) ELSE NULLIF(concat_ws(', ', CASE mo.role WHEN 'manager' THEN 'Team lead' WHEN 'owner' THEN 'Organisation owner' WHEN 'hr' THEN 'HR' ELSE 'Staff' END, ot.teams), '') END AS subtitle,
         mo.id AS other_membership_id, po.id AS other_profile_id, po.avatar_key AS other_avatar_key, po.presence AS other_presence,
         lm.body AS last_body, lp.display_name AS last_sender_name, r.last_read_at,
         lm.author_kind AS last_author_kind,
         ${ready ? `CASE WHEN lm.author_kind <> 'person' THEN COALESCE(lap.name, 'Brenda') END` : "NULL::text"} AS last_assistant_name,
         GREATEST((SELECT count(*)::int FROM messages m
            WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_membership_id <> $2
              AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = $2))), CASE WHEN r.marked_unread THEN 1 ELSE 0 END) AS unread,
         (r.muted_at IS NOT NULL) AS muted, COALESCE(r.marked_unread, false) AS marked_unread
  FROM conversations c
  JOIN organisations o ON o.id = c.organisation_id
  LEFT JOIN teams t ON t.id = c.team_id
  LEFT JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.membership_id <> $2 AND c.kind = 'direct'
  LEFT JOIN memberships mo ON mo.id = cp.membership_id
  LEFT JOIN profiles po ON po.id = mo.user_id
  LEFT JOIN LATERAL (SELECT string_agg(tt.name, ', ' ORDER BY tt.name) AS teams FROM team_members tm2 JOIN teams tt ON tt.id = tm2.team_id WHERE tm2.membership_id = mo.id AND tt.archived_at IS NULL) ot ON true
  LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
  LEFT JOIN LATERAL (SELECT CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.sender_membership_id, ${ready ? "m.author_kind" : "'person'::text AS author_kind"} FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
  LEFT JOIN memberships lms ON lms.id = lm.sender_membership_id
  LEFT JOIN profiles lp ON lp.id = lms.user_id
  ${ready ? "LEFT JOIN assistant_profiles lap ON lap.membership_id = lm.sender_membership_id" : ""}
  WHERE c.organisation_id = $1 AND (t.id IS NULL OR t.archived_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = $2)`;

/** Every conversation the person can see: channels first, then direct threads, most recent activity first. */
export async function inbox(ctx: OrgContext): Promise<{ channels: ConversationSummary[]; direct: ConversationSummary[]; archived: ConversationSummary[] }> {
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    await ensureChannels(db, ctx);
    const ready = await schema0037Ready(db);
    const rows = await db.query<ConversationSummary>(`${summarySql(ready)} ORDER BY c.last_message_at DESC NULLS LAST, c.created_at`, [ctx.org.id, ctx.membership.id]);
    const channels = rows.filter((r) => r.kind !== "direct" && !r.archived_at).sort((a, b) => (a.kind === "organisation" ? -1 : b.kind === "organisation" ? 1 : a.title.localeCompare(b.title)));
    const archived = rows.filter((r) => r.kind !== "direct" && !!r.archived_at).sort((a, b) => a.title.localeCompare(b.title));
    const direct = rows.filter((r) => r.kind === "direct");
    return { channels, direct, archived };
  }));
}

/** Everyone the person could start a direct thread with (all active members except themself). */
export async function peopleToMessage(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => db.query<{ membership_id: string; display_name: string; role: string; teams: string | null; profile_id: string; avatar_key: string | null; presence: Presence }>(
    `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence,
            (SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL) AS teams
     FROM memberships m JOIN profiles p ON p.id = m.user_id
     WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2
     ORDER BY p.display_name`, [ctx.org.id, ctx.membership.id]));
}

/** Returns (creating on first use) the direct thread between the caller and another member. */
export async function openDirect(ctx: OrgContext, otherMembershipId: string): Promise<string> {
  return withUser(ctx.user.profileId, async (db) => {
    try {
      const r = await db.one<{ id: string }>(`SELECT app_direct_conversation($1, $2) AS id`, [ctx.org.id, otherMembershipId]);
      return r.id;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("SELF_MESSAGE")) throw invalid("You cannot message yourself.");
      if (msg.includes("MEMBER_NOT_FOUND")) throw notFound("That person is not an active member of this organisation.");
      throw err;
    }
  });
}

/** The channel for a team (or the organisation channel when teamId is null). */
export async function openChannel(ctx: OrgContext, teamId: string | null): Promise<string> {
  return withUser(ctx.user.profileId, async (db) => (await db.one<{ id: string }>(`SELECT app_channel_conversation($1, $2) AS id`, [ctx.org.id, teamId])).id);
}

/**
 * The columns that say who wrote a message `m` (and the message `rm` it replies to), for a statement whose `$2` is the
 * caller's membership. Before migration 0037 every message is the person's and nothing joins assistant_profiles.
 */
const authorColumns = (ready: boolean) => ready
  ? `m.author_kind, (m.sender_membership_id = $2 AND m.author_kind <> 'assistant') AS mine,
     CASE WHEN m.author_kind <> 'person' THEN json_build_object('name', ap.name, 'colour', ap.colour, 'visor', ap.visor, 'eyes', ap.eyes) END AS assistant,
     rm.author_kind AS reply_author_kind, (rm.sender_membership_id = $2 AND rm.author_kind <> 'assistant') AS reply_mine,
     CASE WHEN rm.author_kind <> 'person' THEN COALESCE(rap.name, 'Brenda') END AS reply_assistant_name`
  : `'person'::text AS author_kind, (m.sender_membership_id = $2) AS mine, NULL::json AS assistant,
     CASE WHEN rm.id IS NULL THEN NULL ELSE 'person' END AS reply_author_kind, (rm.sender_membership_id = $2) AS reply_mine,
     NULL::text AS reply_assistant_name`;
const authorJoins = (ready: boolean) => ready
  ? `LEFT JOIN assistant_profiles ap ON ap.membership_id = m.sender_membership_id
     LEFT JOIN assistant_profiles rap ON rap.membership_id = rm.sender_membership_id`
  : "";

/** The sender's assistant as the client draws it: toProfile fills Brenda's defaults for someone who never chose. */
const withAssistant = <R extends { assistant: unknown }>(r: R): R & { assistant: AssistantProfile | null } =>
  ({ ...r, assistant: r.assistant ? toProfile(r.assistant as Record<string, unknown>) : null });

/**
 * The columns a thread's message `m` gains with migration 0041, for a statement whose `$2` is the caller's membership:
 * its stored mentions (none once it is withdrawn: who it named goes with its words; integration review, 8 October 2026),
 * and for an assistant's public reply not yet withdrawn, its mention and whether the caller may withdraw it (the tagger,
 * or someone who runs the conversation).
 */
const mentionColumns = (ready: boolean, ready43 = false) => !ready
  ? `'[]'::json AS mentions, NULL::json AS mention_reply`
  : ready43
    // Phase 6: someone else's assistant's reply and its "I've asked Ben" line, with who asked; its owner may withdraw.
    ? `CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT json_agg(json_build_object('kind', mm.kind, 'membershipId', mm.membership_id, 'label', mm.label) ORDER BY mm.created_at, mm.label)
                 FROM message_mentions mm WHERE mm.message_id = m.id), '[]'::json) ELSE '[]'::json END AS mentions,
       CASE WHEN am.id IS NOT NULL AND m.author_kind = 'assistant' AND m.deleted_at IS NULL
                 AND ((am.reply_message_id = m.id AND am.status = 'answered') OR (am.holding_message_id = m.id AND am.status <> 'withdrawn'))
            THEN CASE WHEN am.owner_membership_id IS NULL
                      -- A person's own assistant: phase 5's shape, as it was.
                      THEN json_build_object('mentionId', am.id, 'canWithdraw', (am.tagger_membership_id = $2 OR app_can_manage_conversation(m.conversation_id)))
                      ELSE json_build_object('mentionId', am.id,
                             'canWithdraw', COALESCE(am.reply_message_id = m.id AND am.status = 'answered'
                                                     AND (am.tagger_membership_id = $2 OR am.owner_membership_id = $2 OR app_can_manage_conversation(m.conversation_id)), false),
                             'askedBy', json_build_object('membershipId', am.tagger_membership_id, 'firstName', split_part(btrim(atp.display_name), ' ', 1), 'isYou', am.tagger_membership_id = $2),
                             'holding', COALESCE(am.holding_message_id = m.id, false)) END END AS mention_reply`
    : `CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT json_agg(json_build_object('kind', mm.kind, 'membershipId', mm.membership_id, 'label', mm.label) ORDER BY mm.created_at, mm.label)
                 FROM message_mentions mm WHERE mm.message_id = m.id), '[]'::json) ELSE '[]'::json END AS mentions,
       CASE WHEN am.id IS NOT NULL AND m.author_kind = 'assistant' AND am.status = 'answered' AND m.deleted_at IS NULL
            THEN json_build_object('mentionId', am.id, 'canWithdraw', (am.tagger_membership_id = $2 OR app_can_manage_conversation(m.conversation_id))) END AS mention_reply`;
const mentionJoins = (ready: boolean, ready43 = false) => (!ready ? "" : ready43
  ? `LEFT JOIN assistant_mentions am ON am.reply_message_id = m.id OR am.holding_message_id = m.id
     LEFT JOIN memberships atm ON atm.id = am.tagger_membership_id
     LEFT JOIN profiles atp ON atp.id = atm.user_id`
  : "LEFT JOIN assistant_mentions am ON am.reply_message_id = m.id");

/**
 * The notifications opening a conversation reads: someone mentioned you here, and your assistant's answers here; and
 * (phase 6) your assistant was tagged here by someone else, and someone else's assistant replied to you here.
 */
const MENTION_NOTIFICATION_TYPES = ["message.mention", "brenda.mention_reply", "brenda.mention_confirm", "brenda.mention_private", "assistant.tagged", "assistant.thread_reply"];

/**
 * One conversation with its last 200 messages. Opening it marks everything up to now as read, and (migration 0041) the
 * caller's notifications about mentions in it. Assistant mentions that look stuck (at most three) are restarted after
 * the page's transaction, as follow-ups settle on a read (phase 4).
 */
export async function thread(ctx: OrgContext, conversationId: string): Promise<Thread | null> {
  let kick: string[] = [];
  const out = await retryWithout0041(() => retryWithout0037(() => withUser(ctx.user.profileId, async (db): Promise<Thread | null> => {
    kick = [];
    const ready = await schema0037Ready(db);
    const ready41 = ready && (await schema0041Ready(db));
    const ready43 = ready41 && (await schema0043Ready(db));
    const conv = await db.maybeOne<ConversationSummary>(`${summarySql(ready)} AND c.id = $3`, [ctx.org.id, ctx.membership.id, conversationId]);
    if (!conv) return null;
    const people = await db.query<Participant>(
      conv.kind === "direct" || conv.kind === "channel"
        ? `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence, (m.status = 'active') AS active FROM conversation_participants cp JOIN memberships m ON m.id = cp.membership_id JOIN profiles p ON p.id = m.user_id WHERE cp.conversation_id = $1 ORDER BY p.display_name`
        : conv.kind === "team"
          ? `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence, (m.status = 'active') AS active FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id WHERE tm.team_id = (SELECT team_id FROM conversations WHERE id = $1) ORDER BY p.display_name`
          : `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence, (m.status = 'active') AS active FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = (SELECT organisation_id FROM conversations WHERE id = $1) AND m.status = 'active' ORDER BY p.display_name`,
      [conversationId]);
    const rows = await db.query<MessageRow>(
      `SELECT * FROM (
         SELECT m.id, m.sender_membership_id, p.display_name AS sender_name, p.id AS sender_profile_id, p.avatar_key AS sender_avatar_key, CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.created_at, m.deleted_at, m.edited_at,
                m.task_id, t.title AS task_title, t.status AS task_status,
                m.voice_key, m.voice_mime, m.voice_seconds,
                m.reply_to_id, CASE WHEN rm.id IS NULL THEN NULL WHEN rm.deleted_at IS NOT NULL THEN '' ELSE rm.body END AS reply_body, rp.display_name AS reply_sender_name,
                ${authorColumns(ready)},
                ${mentionColumns(ready41, ready43)}
         FROM messages m
         JOIN memberships sm ON sm.id = m.sender_membership_id
         JOIN profiles p ON p.id = sm.user_id
         LEFT JOIN tasks t ON t.id = m.task_id
         LEFT JOIN messages rm ON rm.id = m.reply_to_id
         LEFT JOIN memberships rsm ON rsm.id = rm.sender_membership_id
         LEFT JOIN profiles rp ON rp.id = rsm.user_id
         ${authorJoins(ready)}
         ${mentionJoins(ready41, ready43)}
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC LIMIT 200) x ORDER BY created_at`, [conversationId, ctx.membership.id]);
    const messages = rows.map((r) => ({ ...withAssistant(r), mentions: Array.isArray(r.mentions) ? r.mentions : [], mention_reply: r.mention_reply ?? null }));
    // Opening the thread reads it up to now and clears a "mark as unread".
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now(), marked_unread = false`, [conversationId, ctx.org.id, ctx.membership.id]);
    let mentions: MentionView[] = [];
    let assistantReplies = NO_REPLIES;
    let taggable: TaggableAssistant[] = [];
    if (ready43) taggable = await taggableIn(db, ctx, conversationId);
    if (ready41) {
      const found = await threadMentions(db, ctx, conversationId, messages.filter((m) => m.author_kind === "person").map((m) => m.id));
      mentions = found.mentions;
      kick = found.kick;
      assistantReplies = await assistantRepliesIn(db, conversationId);
      await db.query(
        `UPDATE notifications SET read_at = now()
         WHERE recipient_membership_id = $1 AND read_at IS NULL AND type = ANY($3::text[]) AND resource_type = 'conversation' AND resource_id = $2`,
        [ctx.membership.id, conversationId, MENTION_NOTIFICATION_TYPES]);
    }
    return { conversation: { ...conv, unread: 0, marked_unread: false, people }, messages, mentions, assistantReplies, taggable };
  })));
  if (kick.length) await kickMentions(kick.slice(0, MENTION_LIMITS.kickPerPage));
  return out;
}

/**
 * The other people who read this conversation now, with their assistants, as the person may tag them (phase 6): every
 * active reader but the person, by name; the first-name label when no other reader (the person aside) shares the first
 * name, else the full name's. `allowed` false: the owner switched "Let people tag my assistant in Messages" off.
 */
async function otherAssistantsIn(db: Db, ctx: OrgContext, conversationId: string): Promise<(TaggableAssistant & { labels: string[] })[]> {
  const rows = await db.query<{ membership_id: string; name: string; a_name: string | null; a_colour: string | null; a_visor: string | null; a_eyes: string | null; allowed: boolean }>(
    `SELECT r.membership_id, p.display_name AS name, ap.name AS a_name, ap.colour AS a_colour, ap.visor AS a_visor, ap.eyes AS a_eyes,
            COALESCE(ap.allow_thread_replies, true) AS allowed
     FROM app_conversation_readers($1) r JOIN memberships m ON m.id = r.membership_id JOIN profiles p ON p.id = m.user_id
     LEFT JOIN assistant_profiles ap ON ap.membership_id = r.membership_id
     WHERE r.membership_id <> $2 ORDER BY p.display_name, r.membership_id LIMIT 500`, [conversationId, ctx.membership.id]);
  const firstOf = (name: string) => name.trim().split(/\s+/)[0]?.toLocaleLowerCase("en-GB") ?? "";
  const firsts = new Map<string, number>();
  for (const r of rows) firsts.set(firstOf(r.name), (firsts.get(firstOf(r.name)) ?? 0) + 1);
  return rows.map((r) => {
    const assistant = toProfile({ name: r.a_name, colour: r.a_colour, visor: r.a_visor, eyes: r.a_eyes });
    const labels = otherAssistantLabels(r.name, assistant.name, firsts.get(firstOf(r.name)) === 1);
    const personName = r.name.trim().replace(/\s+/g, " ");
    return { membershipId: r.membership_id, personName, firstName: personName.split(" ")[0] || personName, assistant, label: labels[0] ?? `@${personName}'s ${assistant.name}`, allowed: r.allowed, labels };
  }).filter((x) => x.labels.length > 0);
}

async function taggableIn(db: Db, ctx: OrgContext, conversationId: string): Promise<TaggableAssistant[]> {
  return (await otherAssistantsIn(db, ctx, conversationId)).map((x) => ({
    membershipId: x.membershipId, personName: x.personName, firstName: x.firstName, assistant: x.assistant, label: x.label, allowed: x.allowed,
  }));
}

/** One @mention the composer sends beside the body (owner decision, 8 October 2026: personal assistants, phase 5). */
export const mentionTokenSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assistant"), label: z.string().trim().min(2).max(40) }),
  z.object({ kind: z.literal("person"), membershipId: z.uuid(), label: z.string().trim().min(2).max(121) }),
  // Phase 6: someone else's assistant, by its owner ("@Ben's Brenda").
  z.object({ kind: z.literal("others_assistant"), membershipId: z.uuid(), label: z.string().trim().min(2).max(160) }),
]);

export const sendSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(4000, "Keep a message under 4000 characters."),
  taskId: z.uuid().nullable().optional(),
  replyToId: z.uuid().nullable().optional(),
  mentions: z.array(mentionTokenSchema).max(MENTION_LIMITS.tokensPerMessage).optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

/** Where a mention happened, in the words of the person mentioned: "#Design", "Everyone", or "your chat". */
const mentionWhere = (kind: ConversationKind, name: string | null) => (kind === "direct" ? "your chat" : kind === "organisation" ? "Everyone" : `#${name ?? ""}`);

/**
 * Posts a message. In a direct thread the other person gets an in-app notification unless they muted the thread; channels
 * rely on the unread badge. `via: "assistant"` is the person's own assistant sending it for them after they pressed
 * Confirm (her send_message tool, owner decision, 8 October 2026: personal assistants, phase 3): the row is
 * 'via_assistant' and a direct thread's notification says so ("… via Max"). Before migration 0037 it is the person's,
 * as it was. `sendSchema` never carries it, so the Messages composer cannot ask for it.
 *
 * Mentions (owner decision, 8 October 2026: personal assistants, phase 5; migration 0041), only on the person's own
 * text message (never `via: "assistant"`): invalid tokens are dropped silently, so a race with someone leaving never
 * loses the message. Each person mentioned who reads the conversation is notified ('message.mention', even when they
 * muted it; in a direct thread only when the usual direct notification was not sent because they muted it). A valid
 * assistant token queues one 'pending' row; the switches and limits are checked when it is claimed, so the person always
 * gets a private explanation. After the commit the processor starts (`startMention: false` in tests). Before 0041 the
 * mentions are ignored and `mentionId` is null.
 */
export async function sendMessage(ctx: OrgContext, input: SendInput, opts: { via?: "assistant"; startMention?: boolean } = {}): Promise<{ id: string; createdAt: string; authorKind: AuthorKind; mentionId: string | null; mentioned: string[] }> {
  const sent = await retryWithout0041(() => retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<{ id: string; kind: ConversationKind; archived_at: string | null }>(`SELECT id, kind, archived_at FROM conversations WHERE id = $1 AND organisation_id = $2`, [input.conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    if (conv.archived_at) throw conflict("CONVERSATION_ARCHIVED", "This channel is archived. Restore it to write here again.");
    let task: { id: string; title: string } | null = null;
    if (input.taskId) {
      task = await db.maybeOne<{ id: string; title: string }>(`SELECT id, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [input.taskId, ctx.org.id]);
      if (!task) throw invalid("That task is not visible to you.", { taskId: ["Pick a task you can see."] });
    }
    let replyTo: string | null = null;
    if (input.replyToId) {
      const r = await db.maybeOne<{ id: string }>(`SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`, [input.replyToId, conv.id]);
      if (!r) throw invalid("The message you are replying to is not in this conversation any more.", { replyToId: ["Pick a message in this conversation."] });
      replyTo = r.id;
    }
    const viaAssistant = opts.via === "assistant" && (await schema0037Ready(db));
    const authorKind: AuthorKind = viaAssistant ? "via_assistant" : "person";
    const m = viaAssistant
      ? await db.one<{ id: string; created_at: string }>(
        `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, task_id, reply_to_id, author_kind) VALUES ($1, $2, $3, $4, $5, $6, 'via_assistant') RETURNING id, created_at`,
        [ctx.org.id, conv.id, ctx.membership.id, input.body, task?.id ?? null, replyTo])
      : await db.one<{ id: string; created_at: string }>(
        `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, task_id, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [ctx.org.id, conv.id, ctx.membership.id, input.body, task?.id ?? null, replyTo]);
    // The sender has read their own thread up to now.
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now(), marked_unread = false`, [conv.id, ctx.org.id, ctx.membership.id]);
    const directNotified = new Set<string>();
    if (conv.kind === "direct") {
      const others = await db.query<{ membership_id: string }>(`SELECT membership_id FROM conversation_participants WHERE conversation_id = $1 AND membership_id <> $2 AND NOT app_conversation_muted($1, membership_id)`, [conv.id, ctx.membership.id]);
      const preview = input.body.length > 120 ? `${input.body.slice(0, 117)}…` : input.body;
      // The sender's own assistant, by the name they gave it ("… via Max").
      const via = viaAssistant && others.length ? ` via ${(await readPersonalAssistant(db, ctx.membership.id)).name}` : "";
      for (const o of others) {
        await notify(db, {
          organisationId: ctx.org.id, recipientMembershipId: o.membership_id, type: "message.direct",
          title: `${ctx.user.displayName} sent you a message${task ? ` about “${task.title}”` : ""}${via}`, body: preview,
          resourceType: "conversation", resourceId: conv.id, href: `/app/${ctx.org.slug}/messages?c=${conv.id}`, dedupKey: `message:${m.id}`,
        });
        directNotified.add(o.membership_id);
      }
    }
    const mentions = opts.via !== "assistant" && input.mentions?.length && (await schema0041Ready(db))
      ? await storeMentions(db, ctx, { conversation: conv, messageId: m.id, body: input.body, tokens: input.mentions, directNotified })
      : { mentionId: null, mentioned: [] };
    return { id: m.id, createdAt: m.created_at, authorKind, ...mentions };
  })));
  if (sent.mentionId && opts.startMention !== false) await kickMentions([sent.mentionId]);
  return sent;
}

/**
 * The mentions of a message just inserted, in the send's transaction, as the sender (row-level security checks each
 * insert again: a fresh, unedited text message of their own; their own assistant; people who read the conversation).
 */
async function storeMentions(db: Db, ctx: OrgContext, m: {
  conversation: { id: string; kind: ConversationKind }; messageId: string; body: string; tokens: NonNullable<SendInput["mentions"]>; directNotified: Set<string>;
}): Promise<{ mentionId: string | null; mentioned: string[] }> {
  const me = ctx.membership.id;
  const ids = [...new Set(m.tokens.flatMap((t) => (t.kind === "person" && t.membershipId.toLowerCase() !== me.toLowerCase() ? [t.membershipId.toLowerCase()] : [])))];
  const people = ids.length
    ? await db.query<{ id: string; display_name: string }>(
      `SELECT m.id, p.display_name FROM memberships m JOIN profiles p ON p.id = m.user_id
       WHERE m.id = ANY($1::uuid[]) AND m.organisation_id = $2 AND m.status = 'active' AND app_conversation_has_reader($3, m.id)`,
      [ids, ctx.org.id, m.conversation.id])
    : [];
  const hasAssistant = m.tokens.some((t) => t.kind === "assistant");
  const ownAssistantName = hasAssistant ? (await readPersonalAssistant(db, me)).name : "";
  // Someone else's assistant (phase 6): its owner must read the conversation now and let people tag it; the labels it
  // answers to depend on who else reads here. Muting is not checked here (the sender cannot read mutes): the claim
  // refuses with a note. Before 0043 such tokens are dropped.
  const wantsOther = m.tokens.some((t) => t.kind === "others_assistant" && t.membershipId.toLowerCase() !== me.toLowerCase());
  const others = wantsOther && (await schema0043Ready(db))
    ? (await otherAssistantsIn(db, ctx, m.conversation.id)).map((x) => ({ membershipId: x.membershipId, labels: x.labels, allowed: x.allowed }))
    : [];
  const valid = validateMentions(m.body, m.tokens.filter((t) => t.kind !== "others_assistant" || others.length > 0), {
    ownAssistantName, people: people.map((p) => ({ membershipId: p.id, name: p.display_name })), selfMembershipId: me, others,
  });
  if (!valid.assistant && !valid.people.length) return { mentionId: null, mentioned: [] };
  for (const p of valid.people) {
    await db.query(`INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, 'person', $4, $5)`,
      [m.messageId, m.conversation.id, ctx.org.id, p.membershipId, p.label]);
  }
  let mentionId: string | null = null;
  if (valid.assistant) {
    // The assistant's owner: the sender for their own, another reader for theirs (phase 6).
    const owner = valid.assistant.ownerMembershipId;
    await db.query(`INSERT INTO message_mentions(message_id, conversation_id, organisation_id, kind, membership_id, label) VALUES ($1, $2, $3, 'assistant', $4, $5)`,
      [m.messageId, m.conversation.id, ctx.org.id, owner ?? me, valid.assistant.label]);
    mentionId = owner
      ? (await db.one<{ id: string }>(
        `INSERT INTO assistant_mentions(organisation_id, conversation_id, message_id, tagger_membership_id, owner_membership_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ctx.org.id, m.conversation.id, m.messageId, me, owner])).id
      : (await db.one<{ id: string }>(
        `INSERT INTO assistant_mentions(organisation_id, conversation_id, message_id, tagger_membership_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [ctx.org.id, m.conversation.id, m.messageId, me])).id;
  }
  if (valid.people.length) {
    const named = await db.maybeOne<{ name: string | null }>(
      `SELECT CASE c.kind WHEN 'team' THEN t.name WHEN 'channel' THEN c.title END AS name FROM conversations c LEFT JOIN teams t ON t.id = c.team_id WHERE c.id = $1`, [m.conversation.id]);
    const where = mentionWhere(m.conversation.kind, named?.name ?? null);
    // The sender's recent person mentions (this message's left out): per person here, and in all (security review,
    // 8 October 2026: one member could ping a colleague without limit). Mentions notify even in a muted conversation
    // (owner decision), so this throttle is what stops a flood.
    const recent = await db.query<{ membership_id: string | null; n: number }>(
      `SELECT CASE WHEN mm.conversation_id = $2 THEN mm.membership_id END AS membership_id, count(*)::int AS n
       FROM message_mentions mm JOIN messages msg ON msg.id = mm.message_id
       WHERE mm.organisation_id = $1 AND mm.kind = 'person' AND msg.sender_membership_id = $3 AND mm.message_id <> $4
         AND mm.created_at > now() - interval '1 hour'
       GROUP BY 1`, [ctx.org.id, m.conversation.id, me, m.messageId]);
    const here = new Map(recent.filter((r) => r.membership_id).map((r) => [r.membership_id!.toLowerCase(), r.n]));
    let budget = MENTION_LIMITS.notifyPerSenderPerHour - recent.reduce((n, r) => n + r.n, 0);
    for (const p of valid.people) {
      // In a direct thread the usual notification already told them, unless they muted it.
      if (m.conversation.kind === "direct" && m.directNotified.has(p.membershipId)) continue;
      if ((here.get(p.membershipId.toLowerCase()) ?? 0) >= MENTION_LIMITS.notifyPerPersonPerHour || budget <= 0) continue;
      budget--;
      await notify(db, {
        organisationId: ctx.org.id, recipientMembershipId: p.membershipId, type: "message.mention",
        title: `${ctx.user.displayName} mentioned you in ${where}`, body: clip(m.body, 120),
        resourceType: "conversation", resourceId: m.conversation.id, href: `/app/${ctx.org.slug}/messages?c=${m.conversation.id}#m-${m.messageId}`,
        dedupKey: `mention:${m.messageId}:${p.membershipId}`,
      });
    }
  }
  return { mentionId, mentioned: valid.people.map((p) => p.membershipId) };
}

export type IncomingMessage = {
  id: string; conversation_id: string; kind: ConversationKind; conversation_title: string; sender_name: string; sender_profile_id: string; sender_avatar_key: string | null; body: string; created_at: string;
  author_kind: AuthorKind;
  /** The sender's own assistant when the message is not their own words (migration 0037). */
  assistant: AssistantProfile | null;
};

/** Messages from other people since `after`, in conversations the caller can read; feeds the toast. Withdrawn ones are left out. */
export async function incomingMessages(ctx: OrgContext, after: string): Promise<IncomingMessage[]> {
  return retryWithout0037(() => withUser(ctx.user.profileId, async (db) => {
    const ready = await schema0037Ready(db);
    const rows = await db.query<IncomingMessage>(
      `SELECT m.id, m.conversation_id, c.kind, CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN t.name WHEN 'channel' THEN c.title ELSE p.display_name END AS conversation_title,
              p.display_name AS sender_name, p.id AS sender_profile_id, p.avatar_key AS sender_avatar_key, m.body, m.created_at,
              ${ready
                ? `m.author_kind, CASE WHEN m.author_kind <> 'person' THEN json_build_object('name', ap.name, 'colour', ap.colour, 'visor', ap.visor, 'eyes', ap.eyes) END AS assistant`
                : `'person'::text AS author_kind, NULL::json AS assistant`}
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN teams t ON t.id = c.team_id
       JOIN memberships sm ON sm.id = m.sender_membership_id JOIN profiles p ON p.id = sm.user_id
       ${ready ? "LEFT JOIN assistant_profiles ap ON ap.membership_id = m.sender_membership_id" : ""}
       WHERE m.organisation_id = $1 AND m.sender_membership_id <> $2 AND m.deleted_at IS NULL AND m.created_at > $3::timestamptz
         AND NOT EXISTS (SELECT 1 FROM conversation_reads r WHERE r.conversation_id = c.id AND r.membership_id = $2 AND r.muted_at IS NOT NULL)
       ORDER BY m.created_at DESC LIMIT 10`, [ctx.org.id, ctx.membership.id, after]);
    return rows.map(withAssistant);
  }));
}

// ---- Voice notes ----------------------------------------------------------------

const VOICE_MAX_BYTES = 10 * 1024 * 1024;
const VOICE_TYPES: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };

export function voiceLabel(seconds: number) {
  return `Voice note (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`;
}

/** Stores a recorded note under the tenant prefix and posts it as a message; the body carries a readable label. */
export async function sendVoiceMessage(ctx: OrgContext, input: { conversationId: string; type: string; bytes: Buffer; seconds: number }) {
  const type = input.type.split(";")[0].trim().toLowerCase();
  if (!VOICE_TYPES[type]) throw invalid("That audio format is not supported.");
  if (input.bytes.length === 0) throw invalid("The recording is empty.");
  if (input.bytes.length > VOICE_MAX_BYTES) throw invalid("Voice notes must be 10 MB or smaller.");
  const seconds = Math.min(600, Math.max(1, Math.round(input.seconds)));
  return withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<{ id: string; kind: ConversationKind; archived_at: string | null }>(`SELECT id, kind, archived_at FROM conversations WHERE id = $1 AND organisation_id = $2`, [input.conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    const key = tenantKey(ctx.org.id, "voice", conv.id.replace(/-/g, ""), `${crypto.randomUUID()}.${VOICE_TYPES[type]}`);
    await storage().put(key, input.bytes, type);
    const m = await db.one<{ id: string; created_at: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, voice_key, voice_mime, voice_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [ctx.org.id, conv.id, ctx.membership.id, voiceLabel(seconds), key, type, seconds]);
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now()`, [conv.id, ctx.org.id, ctx.membership.id]);
    if (conv.kind === "direct") {
      const others = await db.query<{ membership_id: string }>(`SELECT membership_id FROM conversation_participants WHERE conversation_id = $1 AND membership_id <> $2 AND NOT app_conversation_muted($1, membership_id)`, [conv.id, ctx.membership.id]);
      for (const o of others) {
        await notify(db, { organisationId: ctx.org.id, recipientMembershipId: o.membership_id, type: "message.direct", title: `${ctx.user.displayName} sent you a voice note`, body: voiceLabel(seconds), resourceType: "conversation", resourceId: conv.id, href: `/app/${ctx.org.slug}/messages?c=${conv.id}`, dedupKey: `message:${m.id}` });
      }
    }
    return { id: m.id, createdAt: m.created_at };
  });
}

/** The audio of a voice note the caller may read (row-level security on the message decides). */
export async function voiceFor(ctx: OrgContext, messageId: string) {
  const row = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ voice_key: string | null; voice_mime: string | null; deleted_at: string | null }>(`SELECT voice_key, voice_mime, deleted_at FROM messages WHERE id = $1 AND organisation_id = $2`, [messageId, ctx.org.id]));
  if (!row || !row.voice_key || !row.voice_mime || row.deleted_at) throw notFound("No voice note.");
  return { key: row.voice_key, mime: row.voice_mime };
}

/**
 * An assistant's own message (migration 0037) is not the person's to change: their edit and withdraw match only what they
 * sent, themselves or through their assistant (the database's guard refuses the rest anyway).
 */
const notAssistantsOwn = async (db: Db) => ((await schema0037Ready(db)) ? "AND author_kind <> 'assistant'" : "");

/**
 * Withdraws one of the caller's own messages. The row stays (with an empty body) so the thread keeps its shape. A
 * message that tagged the person's assistant and is still waiting stops there (migration 0041: the worker marks its
 * mention withdrawn; a run already thinking notices when it completes and posts nothing).
 */
export async function withdrawMessage(ctx: OrgContext, messageId: string) {
  const done = await withUser(ctx.user.profileId, async (db) => {
    const r = await db.query<{ id: string; voice_key: string | null }>(`UPDATE messages SET deleted_at = now() WHERE id = $1 AND organisation_id = $2 AND sender_membership_id = $3 AND deleted_at IS NULL ${await notAssistantsOwn(db)} RETURNING id, voice_key`, [messageId, ctx.org.id, ctx.membership.id]);
    if (r.length === 0) throw notFound("That message is not yours or was already withdrawn.");
    if (r[0].voice_key) await storage().delete(r[0].voice_key).catch(() => undefined);
    return { id: messageId };
  });
  let asked: string[] = [];
  try {
    asked = await withWorker(async (db) => {
      if (!(await schema0041Ready(db))) return [];
      await db.query(`UPDATE assistant_mentions SET status = 'withdrawn', lease_until = NULL, finished_at = now() WHERE message_id = $1 AND status = 'pending'`, [messageId]);
      // Someone else's assistant that asked its owner (phase 6): its follow-ups to close, so the owner is not asked any more.
      if (!(await schema0043Ready(db))) return [];
      return (await db.query<{ follow_up_id: string }>(
        `SELECT follow_up_id FROM assistant_mentions WHERE message_id = $1 AND status IN ('thinking', 'asked') AND follow_up_id IS NOT NULL`, [messageId])).map((r) => r.follow_up_id);
    });
  } catch (err) {
    if (isMissingSchema(err)) { forget0041(); forget0043(); }
    else console.warn(`[mentions] stopping a withdrawn message's mention: ${(err as Error)?.message ?? String(err)}`);
  }
  if (asked.length) {
    // Loaded when needed: the processor imports copilot, which imports this file. Never fails the withdrawal.
    try {
      const { syncThreadFollowUp } = await import("@/server/services/mention-processor");
      for (const id of asked) await syncThreadFollowUp(id);
    } catch (err) {
      console.warn(`[mentions] closing a withdrawn question's follow-up: ${(err as Error)?.message ?? String(err)}`);
    }
  }
  return done;
}

/** A task the caller can see, for the "ask for an update" chip. Null when it does not exist or is hidden. */
export async function visibleTask(ctx: OrgContext, taskId: string) {
  return withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; title: string; status: string; assignee_membership_id: string }>(
    `SELECT id, title, status, assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
}


// ---- Channels, archiving, deleting, editing, reporting (owner decision, 25 September 2026) ----------------------

export const channelSchema = z.object({ title: z.string().trim().min(1).max(80), memberIds: z.array(z.uuid()).max(500).default([]) });

/** Creates a named channel with the caller and the chosen people. Anyone in the organisation may start one. */
export async function createChannel(ctx: OrgContext, input: z.infer<typeof channelSchema>) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.one<{ id: string }>(`SELECT app_create_channel($1, $2, $3::uuid[]) AS id`, [ctx.org.id, input.title, input.memberIds]);
    return { id: r.id };
  });
}

function channelError(err: unknown): never {
  const msg = (err as Error).message ?? "";
  if (msg.includes("CHANNEL_FORBIDDEN")) throw forbidden("Only the person who created this channel, the organisation owner or HR can change it.");
  throw err;
}

/** Renames a channel, replaces its people, or archives and restores it. */
export async function updateChannel(ctx: OrgContext, conversationId: string, input: { title?: string; memberIds?: string[]; archived?: boolean }) {
  return withUser(ctx.user.profileId, async (db) => {
    try {
      if (input.memberIds) await db.query(`SELECT app_channel_set_members($1, $2::uuid[])`, [conversationId, input.memberIds]);
      if (input.title !== undefined || input.archived !== undefined) await db.query(`SELECT app_channel_update($1, $2, $3)`, [conversationId, input.title ?? null, input.archived ?? null]);
    } catch (err) { channelError(err); }
    return { id: conversationId };
  });
}

/** Deletes a conversation for the caller: a channel is removed for everyone (creator, owner or HR); a direct thread is hidden for the caller only. */
export async function deleteConversation(ctx: OrgContext, conversationId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<{ id: string; kind: ConversationKind }>(`SELECT id, kind FROM conversations WHERE id = $1 AND organisation_id = $2`, [conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    if (conv.kind === "channel") { try { await db.query(`SELECT app_channel_delete($1)`, [conversationId]); } catch (err) { channelError(err); } return { deleted: true as const, hidden: false as const }; }
    if (conv.kind === "direct") {
      await db.query(`INSERT INTO conversation_hides(conversation_id, organisation_id, membership_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [conversationId, ctx.org.id, ctx.membership.id]);
      return { deleted: false as const, hidden: true as const };
    }
    throw invalid("Team and organisation channels cannot be deleted; they follow the team.");
  });
}

/**
 * The caller's own choices for a conversation (owner decision, 26 September 2026): mark it unread so it stands out in the
 * list until opened, or mute it so it stops notifying and counting on the badge. Both live on the person's reads row.
 */
export async function setConversationPrefs(ctx: OrgContext, conversationId: string, input: { unread?: boolean; muted?: boolean }) {
  return withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<{ id: string }>(`SELECT id FROM conversations WHERE id = $1 AND organisation_id = $2`, [conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at, marked_unread, muted_at)
       VALUES ($1, $2, $3, now(), COALESCE($4, false), CASE WHEN $5 THEN now() ELSE NULL END)
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET
         marked_unread = COALESCE($4, conversation_reads.marked_unread),
         last_read_at = CASE WHEN $4 = false THEN now() ELSE conversation_reads.last_read_at END,
         muted_at = CASE WHEN $5 IS NULL THEN conversation_reads.muted_at WHEN $5 THEN COALESCE(conversation_reads.muted_at, now()) ELSE NULL END`,
      [conversationId, ctx.org.id, ctx.membership.id, input.unread ?? null, input.muted ?? null]);
    return { id: conversationId, unread: input.unread ?? null, muted: input.muted ?? null };
  });
}

/** Changes the text of the caller's own message. The bubble shows it was edited. */
export async function editMessage(ctx: OrgContext, messageId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 4000) throw invalid("A message needs between 1 and 4000 characters.", { body: ["Between 1 and 4000 characters."] });
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.query<{ id: string }>(`UPDATE messages SET body = $4, edited_at = now() WHERE id = $1 AND organisation_id = $2 AND sender_membership_id = $3 AND deleted_at IS NULL AND voice_key IS NULL ${await notAssistantsOwn(db)} RETURNING id`, [messageId, ctx.org.id, ctx.membership.id, text]);
    if (r.length === 0) throw notFound("That message is not yours, was withdrawn, or is a voice note.");
    return { id: messageId };
  });
}

/** Reports a message to the organisation owner and HR, with a reason. */
export async function reportMessage(ctx: OrgContext, messageId: string, reason: string) {
  const why = reason.trim();
  if (!why) throw invalid("Say what is wrong with the message.", { reason: ["Required."] });
  return withUser(ctx.user.profileId, async (db) => {
    const m = await db.maybeOne<{ id: string; body: string; sender_name: string; conversation_id: string }>(`SELECT m.id, m.body, p.display_name AS sender_name, m.conversation_id FROM messages m JOIN memberships sm ON sm.id = m.sender_membership_id JOIN profiles p ON p.id = sm.user_id WHERE m.id = $1 AND m.organisation_id = $2`, [messageId, ctx.org.id]);
    if (!m) throw notFound("That message is not visible to you.");
    const r = await db.one<{ id: string }>(`INSERT INTO message_reports(organisation_id, message_id, reporter_membership_id, reason) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.org.id, messageId, ctx.membership.id, why.slice(0, 1000)]);
    const owners = await db.query<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role IN ('owner', 'hr') AND id <> $2`, [ctx.org.id, ctx.membership.id]);
    for (const o of owners) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: o.id, type: "message.reported", title: `${ctx.user.displayName} reported a message from ${m.sender_name}`, body: `${why.slice(0, 140)} — "${m.body.slice(0, 80)}"`, resourceType: "conversation", resourceId: m.conversation_id, href: `/app/${ctx.org.slug}/messages?c=${m.conversation_id}`, dedupKey: `message.report:${r.id}` });
    }
    return { id: r.id };
  });
}
