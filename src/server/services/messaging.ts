/**
 * Messaging: direct threads between any two people in an organisation, a channel per team and one
 * organisation-wide channel. A message can point at a task ("how far with this?"). Access is enforced by
 * row-level security (see db/migrations/0015_messaging.sql); this module only shapes queries.
 */
import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { invalid, notFound } from "@/server/lib/errors";
import { notify } from "@/server/services/common";

export type ConversationKind = "direct" | "team" | "organisation";
export type ConversationSummary = {
  id: string; kind: ConversationKind; title: string; subtitle: string | null; team_id: string | null; other_membership_id: string | null;
  last_message_at: string | null; last_body: string | null; last_sender_name: string | null; unread: number;
};
export type MessageRow = {
  id: string; sender_membership_id: string; sender_name: string; body: string; created_at: string; deleted_at: string | null;
  task_id: string | null; task_title: string | null; task_status: string | null; mine: boolean;
};
export type Thread = {
  conversation: ConversationSummary & { people: { membership_id: string; display_name: string; role: string }[] };
  messages: MessageRow[];
};

/** Unread messages across every conversation the person can read; used for the sidebar badge. */
export async function unreadMessageCount(db: Db, ctx: OrgContext): Promise<number> {
  const r = await db.one<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
     WHERE c.organisation_id = $1 AND m.deleted_at IS NULL AND m.sender_membership_id <> $2
       AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = $2))`, [ctx.org.id, ctx.membership.id]);
  return r.n;
}

/** Makes sure the organisation channel and the caller's team channels exist, so the inbox always lists them. */
async function ensureChannels(db: Db, ctx: OrgContext) {
  await db.query(`SELECT app_channel_conversation($1, NULL)`, [ctx.org.id]);
  const teams = await db.query<{ team_id: string }>(`SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $1 AND t.archived_at IS NULL`, [ctx.membership.id]);
  for (const t of teams) await db.query(`SELECT app_channel_conversation($1, $2)`, [ctx.org.id, t.team_id]);
}

const SUMMARY_SQL = `
  SELECT c.id, c.kind, c.team_id, c.last_message_at,
         CASE c.kind WHEN 'organisation' THEN 'Everyone' WHEN 'team' THEN t.name ELSE po.display_name END AS title,
         CASE c.kind WHEN 'organisation' THEN o.name WHEN 'team' THEN 'Team channel' ELSE NULLIF(concat_ws(', ', CASE mo.role WHEN 'manager' THEN 'Team lead' WHEN 'owner' THEN 'Organisation owner' WHEN 'hr' THEN 'HR' ELSE 'Staff' END, ot.teams), '') END AS subtitle,
         mo.id AS other_membership_id,
         lm.body AS last_body, lp.display_name AS last_sender_name,
         (SELECT count(*)::int FROM messages m
            WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_membership_id <> $2
              AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = $2))) AS unread
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
  WHERE c.organisation_id = $1 AND (t.id IS NULL OR t.archived_at IS NULL)`;

/** Every conversation the person can see: channels first, then direct threads, most recent activity first. */
export async function inbox(ctx: OrgContext): Promise<{ channels: ConversationSummary[]; direct: ConversationSummary[] }> {
  return withUser(ctx.user.profileId, async (db) => {
    await ensureChannels(db, ctx);
    const rows = await db.query<ConversationSummary>(`${SUMMARY_SQL} ORDER BY c.last_message_at DESC NULLS LAST, c.created_at`, [ctx.org.id, ctx.membership.id]);
    const channels = rows.filter((r) => r.kind !== "direct").sort((a, b) => (a.kind === "organisation" ? -1 : b.kind === "organisation" ? 1 : a.title.localeCompare(b.title)));
    const direct = rows.filter((r) => r.kind === "direct");
    return { channels, direct };
  });
}

/** Everyone the person could start a direct thread with (all active members except themself). */
export async function peopleToMessage(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => db.query<{ membership_id: string; display_name: string; role: string; teams: string | null }>(
    `SELECT m.id AS membership_id, p.display_name, m.role,
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
    const people = await db.query<{ membership_id: string; display_name: string; role: string }>(
      conv.kind === "direct"
        ? `SELECT m.id AS membership_id, p.display_name, m.role FROM conversation_participants cp JOIN memberships m ON m.id = cp.membership_id JOIN profiles p ON p.id = m.user_id WHERE cp.conversation_id = $1 ORDER BY p.display_name`
        : conv.kind === "team"
          ? `SELECT m.id AS membership_id, p.display_name, m.role FROM team_members tm JOIN memberships m ON m.id = tm.membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id WHERE tm.team_id = (SELECT team_id FROM conversations WHERE id = $1) ORDER BY p.display_name`
          : `SELECT m.id AS membership_id, p.display_name, m.role FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = (SELECT organisation_id FROM conversations WHERE id = $1) AND m.status = 'active' ORDER BY p.display_name`,
      [conversationId]);
    const messages = await db.query<MessageRow>(
      `SELECT * FROM (
         SELECT m.id, m.sender_membership_id, p.display_name AS sender_name, CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.created_at, m.deleted_at,
                m.task_id, t.title AS task_title, t.status AS task_status, (m.sender_membership_id = $2) AS mine
         FROM messages m
         JOIN memberships sm ON sm.id = m.sender_membership_id
         JOIN profiles p ON p.id = sm.user_id
         LEFT JOIN tasks t ON t.id = m.task_id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC LIMIT 200) x ORDER BY created_at`, [conversationId, ctx.membership.id]);
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now()`, [conversationId, ctx.org.id, ctx.membership.id]);
    return { conversation: { ...conv, unread: 0, people }, messages };
  });
}

export const sendSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(4000, "Keep a message under 4000 characters."),
  taskId: z.uuid().nullable().optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

/** Posts a message. In a direct thread the other person gets an in-app notification; channels rely on the unread badge. */
export async function sendMessage(ctx: OrgContext, input: SendInput) {
  return withUser(ctx.user.profileId, async (db) => {
    const conv = await db.maybeOne<{ id: string; kind: ConversationKind }>(`SELECT id, kind FROM conversations WHERE id = $1 AND organisation_id = $2`, [input.conversationId, ctx.org.id]);
    if (!conv) throw notFound("That conversation does not exist or you are not part of it.");
    let task: { id: string; title: string } | null = null;
    if (input.taskId) {
      task = await db.maybeOne<{ id: string; title: string }>(`SELECT id, title FROM tasks WHERE id = $1 AND organisation_id = $2`, [input.taskId, ctx.org.id]);
      if (!task) throw invalid("That task is not visible to you.", { taskId: ["Pick a task you can see."] });
    }
    const m = await db.one<{ id: string; created_at: string }>(
      `INSERT INTO messages(organisation_id, conversation_id, sender_membership_id, body, task_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [ctx.org.id, conv.id, ctx.membership.id, input.body, task?.id ?? null]);
    // The sender has read their own thread up to now.
    await db.query(
      `INSERT INTO conversation_reads(conversation_id, organisation_id, membership_id, last_read_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (conversation_id, membership_id) DO UPDATE SET last_read_at = now()`, [conv.id, ctx.org.id, ctx.membership.id]);
    if (conv.kind === "direct") {
      const others = await db.query<{ membership_id: string }>(`SELECT membership_id FROM conversation_participants WHERE conversation_id = $1 AND membership_id <> $2`, [conv.id, ctx.membership.id]);
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

/** Withdraws one of the caller's own messages. The row stays (with an empty body) so the thread keeps its shape. */
export async function withdrawMessage(ctx: OrgContext, messageId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.query<{ id: string }>(`UPDATE messages SET deleted_at = now() WHERE id = $1 AND organisation_id = $2 AND sender_membership_id = $3 AND deleted_at IS NULL RETURNING id`, [messageId, ctx.org.id, ctx.membership.id]);
    if (r.length === 0) throw notFound("That message is not yours or was already withdrawn.");
    return { id: messageId };
  });
}

/** A task the caller can see, for the "ask for an update" chip. Null when it does not exist or is hidden. */
export async function visibleTask(ctx: OrgContext, taskId: string) {
  return withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; title: string; status: string; assignee_membership_id: string }>(
    `SELECT id, title, status, assignee_membership_id FROM tasks WHERE id = $1 AND organisation_id = $2`, [taskId, ctx.org.id]));
}
