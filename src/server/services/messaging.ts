/**
 * Messaging: direct threads between any two people in an organisation, a channel per team and one
 * organisation-wide channel. A message can point at a task ("how far with this?"). Access is enforced by
 * row-level security (see db/migrations/0015_messaging.sql); this module only shapes queries.
 */
import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { invalid, notFound, conflict, forbidden } from "@/server/lib/errors";
import { notify } from "@/server/services/common";
import { storage, tenantKey } from "@/server/lib/storage";
import type { Presence } from "@/lib/presence";

export type Participant = { membership_id: string; display_name: string; role: string; profile_id: string; avatar_key: string | null; presence: Presence };

export type ConversationKind = "direct" | "team" | "organisation" | "channel";
export type ConversationSummary = {
  id: string; kind: ConversationKind; title: string; subtitle: string | null; team_id: string | null; other_membership_id: string | null;
  other_profile_id: string | null; other_avatar_key: string | null; other_presence: Presence | null;
  archived_at: string | null; created_by: string | null; can_manage: boolean;
  last_message_at: string | null; last_body: string | null; last_sender_name: string | null; unread: number;
  muted: boolean; marked_unread: boolean;
};
export type MessageRow = {
  id: string; sender_membership_id: string; sender_name: string; sender_profile_id: string; sender_avatar_key: string | null; body: string; created_at: string; deleted_at: string | null; edited_at: string | null;
  task_id: string | null; task_title: string | null; task_status: string | null; mine: boolean;
  voice_key: string | null; voice_mime: string | null; voice_seconds: number | null;
  reply_to_id: string | null; reply_body: string | null; reply_sender_name: string | null; reply_mine: boolean | null;
};
export type Thread = {
  conversation: ConversationSummary & { people: Participant[] };
  messages: MessageRow[];
};

/** Unread messages across every conversation the person can read, muted ones left out, plus conversations they marked unread; used for the sidebar badge. */
export async function unreadMessageCount(db: Db, ctx: OrgContext): Promise<number> {
  const r = await db.one<{ n: number }>(
    `SELECT (
       (SELECT count(*)::int
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
          WHERE c.organisation_id = $1 AND m.deleted_at IS NULL AND m.sender_membership_id <> $2 AND c.archived_at IS NULL AND r.muted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = $2)
            AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = $2)))
       + (SELECT count(*)::int
            FROM conversation_reads r JOIN conversations c ON c.id = r.conversation_id
            WHERE c.organisation_id = $1 AND r.membership_id = $2 AND r.marked_unread AND r.muted_at IS NULL AND c.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = $2)
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_membership_id <> $2 AND m.created_at > r.last_read_at))
     ) AS n`, [ctx.org.id, ctx.membership.id]);
  return r.n;
}

/** Makes sure the organisation channel and the caller's team channels exist, so the inbox always lists them. */
async function ensureChannels(db: Db, ctx: OrgContext) {
  await db.query(`SELECT app_channel_conversation($1, NULL)`, [ctx.org.id]);
  const teams = await db.query<{ team_id: string }>(`SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $1 AND t.archived_at IS NULL`, [ctx.membership.id]);
  for (const t of teams) await db.query(`SELECT app_channel_conversation($1, $2)`, [ctx.org.id, t.team_id]);
}

const SUMMARY_SQL = `
  SELECT c.id, c.kind, c.team_id, c.last_message_at, c.archived_at, c.created_by,
         (c.kind = 'channel' AND (c.created_by = $2 OR app_has_role(c.organisation_id, 'owner', 'hr'))) AS can_manage,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN t.name WHEN 'channel' THEN c.title ELSE po.display_name END AS title,
         CASE c.kind WHEN 'organisation' THEN o.name WHEN 'team' THEN 'Team channel' WHEN 'channel' THEN (SELECT count(*)::text || ' people' FROM conversation_participants pp WHERE pp.conversation_id = c.id) ELSE NULLIF(concat_ws(', ', CASE mo.role WHEN 'manager' THEN 'Team lead' WHEN 'owner' THEN 'Organisation owner' WHEN 'hr' THEN 'HR' ELSE 'Staff' END, ot.teams), '') END AS subtitle,
         mo.id AS other_membership_id, po.id AS other_profile_id, po.avatar_key AS other_avatar_key, po.presence AS other_presence,
         lm.body AS last_body, lp.display_name AS last_sender_name,
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
  LEFT JOIN LATERAL (SELECT CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.sender_membership_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
  LEFT JOIN memberships lms ON lms.id = lm.sender_membership_id
  LEFT JOIN profiles lp ON lp.id = lms.user_id
  WHERE c.organisation_id = $1 AND (t.id IS NULL OR t.archived_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM conversation_hides h WHERE h.conversation_id = c.id AND h.membership_id = $2)`;

/** Every conversation the person can see: channels first, then direct threads, most recent activity first. */
export async function inbox(ctx: OrgContext): Promise<{ channels: ConversationSummary[]; direct: ConversationSummary[]; archived: ConversationSummary[] }> {
  return withUser(ctx.user.profileId, async (db) => {
    await ensureChannels(db, ctx);
    const rows = await db.query<ConversationSummary>(`${SUMMARY_SQL} ORDER BY c.last_message_at DESC NULLS LAST, c.created_at`, [ctx.org.id, ctx.membership.id]);
    const channels = rows.filter((r) => r.kind !== "direct" && !r.archived_at).sort((a, b) => (a.kind === "organisation" ? -1 : b.kind === "organisation" ? 1 : a.title.localeCompare(b.title)));
    const archived = rows.filter((r) => r.kind !== "direct" && !!r.archived_at).sort((a, b) => a.title.localeCompare(b.title));
    const direct = rows.filter((r) => r.kind === "direct");
    return { channels, direct, archived };
  });
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

/** One conversation with its last 200 messages. Opening it marks everything up to now as read. */
export async function thread(ctx: OrgContext, conversationId: string): Promise<Thread | null> {
  return withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<ConversationSummary>(`${SUMMARY_SQL} AND c.id = $3`, [ctx.org.id, ctx.membership.id, conversationId]);
    if (!conv) return null;
    const people = await db.query<Participant>(
      conv.kind === "direct" || conv.kind === "channel"
        ? `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence FROM conversation_participants cp JOIN memberships m ON m.id = cp.membership_id JOIN profiles p ON p.id = m.user_id WHERE cp.conversation_id = $1 ORDER BY p.display_name`
        : conv.kind === "team"
          ? `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id WHERE tm.team_id = (SELECT team_id FROM conversations WHERE id = $1) ORDER BY p.display_name`
          : `SELECT m.id AS membership_id, p.display_name, m.role, p.id AS profile_id, p.avatar_key, p.presence FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = (SELECT organisation_id FROM conversations WHERE id = $1) AND m.status = 'active' ORDER BY p.display_name`,
      [conversationId]);
    const messages = await db.query<MessageRow>(
      `SELECT * FROM (
         SELECT m.id, m.sender_membership_id, p.display_name AS sender_name, p.id AS sender_profile_id, p.avatar_key AS sender_avatar_key, CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.created_at, m.deleted_at, m.edited_at,
                m.task_id, t.title AS task_title, t.status AS task_status, (m.sender_membership_id = $2) AS mine,
                m.voice_key, m.voice_mime, m.voice_seconds,
                m.reply_to_id, CASE WHEN rm.id IS NULL THEN NULL WHEN rm.deleted_at IS NOT NULL THEN '' ELSE rm.body END AS reply_body, rp.display_name AS reply_sender_name, (rm.sender_membership_id = $2) AS reply_mine
         FROM messages m
         JOIN memberships sm ON sm.id = m.sender_membership_id
         JOIN profiles p ON p.id = sm.user_id
         LEFT JOIN tasks t ON t.id = m.task_id
         LEFT JOIN messages rm ON rm.id = m.reply_to_id
         LEFT JOIN memberships rsm ON rsm.id = rm.sender_membership_id
         LEFT JOIN profiles rp ON rp.id = rsm.user_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC LIMIT 200) x ORDER BY created_at`, [conversationId, ctx.membership.id]);
    // Opening the thread reads it up to now and clears a "mark as unread".
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now(), marked_unread = false`, [conversationId, ctx.org.id, ctx.membership.id]);
    return { conversation: { ...conv, unread: 0, marked_unread: false, people }, messages };
  });
}

export const sendSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(4000, "Keep a message under 4000 characters."),
  taskId: z.uuid().nullable().optional(),
  replyToId: z.uuid().nullable().optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

/** Posts a message. In a direct thread the other person gets an in-app notification unless they muted the thread; channels rely on the unread badge. */
export async function sendMessage(ctx: OrgContext, input: SendInput) {
  return withUser(ctx.user.profileId, async (db) => {
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
    const m = await db.one<{ id: string; created_at: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, task_id, reply_to_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [ctx.org.id, conv.id, ctx.membership.id, input.body, task?.id ?? null, replyTo]);
    // The sender has read their own thread up to now.
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now(), marked_unread = false`, [conv.id, ctx.org.id, ctx.membership.id]);
    if (conv.kind === "direct") {
      const others = await db.query<{ membership_id: string }>(`SELECT membership_id FROM conversation_participants WHERE conversation_id = $1 AND membership_id <> $2 AND NOT app_conversation_muted($1, membership_id)`, [conv.id, ctx.membership.id]);
      const preview = input.body.length > 120 ? `${input.body.slice(0, 117)}…` : input.body;
      for (const o of others) {
        await notify(db, {
          organisationId: ctx.org.id, recipientMembershipId: o.membership_id, type: "message.direct",
          title: `${ctx.user.displayName} sent you a message${task ? ` about “${task.title}”` : ""}`, body: preview,
          resourceType: "conversation", resourceId: conv.id, href: `/app/${ctx.org.slug}/messages?c=${conv.id}`, dedupKey: `message:${m.id}`,
        });
      }
    }
    return { id: m.id, createdAt: m.created_at };
  });
}

export type IncomingMessage = { id: string; conversation_id: string; kind: ConversationKind; conversation_title: string; sender_name: string; sender_profile_id: string; sender_avatar_key: string | null; body: string; created_at: string };

/** Messages from other people since `after`, in conversations the caller can read; feeds the toast. Withdrawn ones are left out. */
export async function incomingMessages(ctx: OrgContext, after: string): Promise<IncomingMessage[]> {
  return withUser(ctx.user.profileId, (db) => db.query<IncomingMessage>(
    `SELECT m.id, m.conversation_id, c.kind, CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN t.name ELSE p.display_name END AS conversation_title,
            p.display_name AS sender_name, p.id AS sender_profile_id, p.avatar_key AS sender_avatar_key, m.body, m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN teams t ON t.id = c.team_id
     JOIN memberships sm ON sm.id = m.sender_membership_id JOIN profiles p ON p.id = sm.user_id
     WHERE m.organisation_id = $1 AND m.sender_membership_id <> $2 AND m.deleted_at IS NULL AND m.created_at > $3::timestamptz
       AND NOT EXISTS (SELECT 1 FROM conversation_reads r WHERE r.conversation_id = c.id AND r.membership_id = $2 AND r.muted_at IS NOT NULL)
     ORDER BY m.created_at DESC LIMIT 10`, [ctx.org.id, ctx.membership.id, after]));
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

/** Withdraws one of the caller's own messages. The row stays (with an empty body) so the thread keeps its shape. */
export async function withdrawMessage(ctx: OrgContext, messageId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.query<{ id: string; voice_key: string | null }>(`UPDATE messages SET deleted_at = now() WHERE id = $1 AND organisation_id = $2 AND sender_membership_id = $3 AND deleted_at IS NULL RETURNING id, voice_key`, [messageId, ctx.org.id, ctx.membership.id]);
    if (r.length === 0) throw notFound("That message is not yours or was already withdrawn.");
    if (r[0].voice_key) await storage().delete(r[0].voice_key).catch(() => undefined);
    return { id: messageId };
  });
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
    const r = await db.query<{ id: string }>(`UPDATE messages SET body = $4, edited_at = now() WHERE id = $1 AND organisation_id = $2 AND sender_membership_id = $3 AND deleted_at IS NULL AND voice_key IS NULL RETURNING id`, [messageId, ctx.org.id, ctx.membership.id, text]);
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
