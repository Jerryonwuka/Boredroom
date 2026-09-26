import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { unreadMessageCount, unreadMessagesSql } from "@/server/services/messaging";

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
         ${unreadMessagesSql("$1", "$2")} AS messages,
         (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'is_manager', tm.is_manager) ORDER BY t.name)
            FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $2 AND t.archived_at IS NULL) AS teams,
         ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM policy_acknowledgements WHERE membership_id = $2 AND policy_id = $3)) AS acknowledged,
         (SELECT json_agg(n) FROM (SELECT id, type, title, body, href, read_at, created_at::text AS created_at FROM notifications WHERE recipient_membership_id = $2 ORDER BY created_at DESC LIMIT 6) n) AS recent`,
      [ctx.org.id, ctx.membership.id, opts.checkPolicy === false ? null : ctx.org.current_policy_id, supervisor]);
    return { counts: { unread: r.unread, attention: r.attention, messages: r.messages, recent: r.recent ?? [] }, teams: r.teams ?? [], acknowledged: r.acknowledged };
  });
}


/** The hover card for a person in a list. Email is included only for the organisation account. */
export async function memberCard(ctx: OrgContext, membershipId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
    const row = await db.maybeOne<{ membership_id: string; display_name: string; role: string; employee_code: string; profile_id: string; avatar_key: string | null; presence: string; title: string | null; status_text: string | null; teams: string | null; email: string | null; joined_at: string }>(
      `SELECT m.id AS membership_id, p.display_name, m.role, m.employee_code, p.id AS profile_id, p.avatar_key, p.presence, p.title, p.status_text,
              (SELECT string_agg(t.name, ', ' ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL) AS teams,
              CASE WHEN $3::boolean THEN p.email ELSE NULL END AS email, m.created_at::text AS joined_at
       FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.id = $1 AND m.organisation_id = $2 AND m.status = 'active'`, [membershipId, ctx.org.id, isOrg]);
    if (!row) throw notFound("That person is not an active member.");
    return row;
  });
}
