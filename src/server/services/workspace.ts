import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { unreadMessageCount } from "@/server/services/messaging";

export type RecentNotification = { id: string; type: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };
export type NavCounts = { unread: number; attention: number; messages: number; recent?: RecentNotification[] };

export async function navCounts(ctx: OrgContext): Promise<NavCounts> {
  return withUser(ctx.user.profileId, async (db) => {
    const unread = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND read_at IS NULL`, [ctx.membership.id]);
    let attention = 0;
    if (ctx.membership.role !== "employee") {
      const r = await db.one<{ n: number }>(
        `SELECT (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $2)
              + (SELECT count(*) FROM daily_reports r WHERE r.organisation_id = $1 AND r.status = 'submitted' AND r.membership_id <> $2)
              + (SELECT count(*) FROM time_adjustments a WHERE a.organisation_id = $1 AND a.status = 'pending' AND a.membership_id <> $2)
              + (SELECT count(*) FROM capture_exceptions c WHERE c.organisation_id = $1 AND c.status = 'pending' AND c.membership_id <> $2) AS n`, [ctx.org.id, ctx.membership.id]);
      attention = Number(r.n);
    }
    const messages = await unreadMessageCount(db, ctx);
    return { unread: unread.n, attention, messages };
  });
}

export async function policyAcknowledged(ctx: OrgContext): Promise<boolean> {
  if (!ctx.org.current_policy_id) return true;
  return withUser(ctx.user.profileId, async (db) => !!(await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id])));
}

export type WorkspaceShell = { counts: NavCounts; teams: { id: string; name: string; is_manager: boolean }[]; acknowledged: boolean };

/**
 * Everything the app shell needs before a page renders, in one statement inside one transaction: unread
 * notifications, the review-queue count, unread messages, the caller's teams and whether the current policy is
 * acknowledged. Replaces three separate transactions (about fifteen round trips) with three.
 */
export async function workspaceShell(ctx: OrgContext, opts: { checkPolicy?: boolean } = {}): Promise<WorkspaceShell> {
  const supervisor = ctx.membership.role !== "employee";
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.one<{ unread: number; attention: number; messages: number; teams: { id: string; name: string; is_manager: boolean }[] | null; acknowledged: boolean; recent: RecentNotification[] | null }>(
      `SELECT
         (SELECT count(*)::int FROM notifications WHERE recipient_membership_id = $2 AND read_at IS NULL) AS unread,
         CASE WHEN $4::boolean THEN
           (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $2)
           + (SELECT count(*) FROM daily_reports r WHERE r.organisation_id = $1 AND r.status = 'submitted' AND r.membership_id <> $2)
           + (SELECT count(*) FROM time_adjustments a WHERE a.organisation_id = $1 AND a.status = 'pending' AND a.membership_id <> $2)
           + (SELECT count(*) FROM capture_exceptions c WHERE c.organisation_id = $1 AND c.status = 'pending' AND c.membership_id <> $2)
         ELSE 0 END::int AS attention,
         (SELECT count(*)::int FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            LEFT JOIN conversation_reads r ON r.conversation_id = c.id AND r.membership_id = $2
            WHERE c.organisation_id = $1 AND m.deleted_at IS NULL AND m.sender_membership_id <> $2
              AND m.created_at > COALESCE(r.last_read_at, (SELECT created_at FROM memberships WHERE id = $2))) AS messages,
         (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'is_manager', tm.is_manager) ORDER BY t.name)
            FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $2 AND t.archived_at IS NULL) AS teams,
         ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM policy_acknowledgements WHERE membership_id = $2 AND policy_id = $3)) AS acknowledged,
         (SELECT json_agg(n) FROM (SELECT id, type, title, body, href, read_at, created_at::text AS created_at FROM notifications WHERE recipient_membership_id = $2 ORDER BY created_at DESC LIMIT 6) n) AS recent`,
      [ctx.org.id, ctx.membership.id, opts.checkPolicy === false ? null : ctx.org.current_policy_id, supervisor]);
    return { counts: { unread: r.unread, attention: r.attention, messages: r.messages, recent: r.recent ?? [] }, teams: r.teams ?? [], acknowledged: r.acknowledged };
  });
}
