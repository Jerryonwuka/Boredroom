import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { unreadMessageCount, unreadMessagesSql } from "@/server/services/messaging";
import { membersOnCall } from "@/server/services/calls";

export type RecentNotification = { id: string; type: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string };
export type NavCounts = { unread: number; attention: number; messages: number; recent?: RecentNotification[] };

export async function navCounts(ctx: OrgContext): Promise<NavCounts> {
  return withUser(ctx.user.profileId, async (db) => {
    const unread = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE recipient_membership_id = $1 AND read_at IS NULL`, [ctx.membership.id]);
    let attention = 0;
    if (ctx.membership.role !== "employee") {
      const r = await db.one<{ n: number }>(
        `SELECT (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $2)
              + (SELECT count(*) FROM time_adjustments a WHERE a.organisation_id = $1 AND a.status = 'pending' AND a.membership_id <> $2) AS n`, [ctx.org.id, ctx.membership.id]);
      attention = Number(r.n);
    }
    const messages = await unreadMessageCount(db, ctx);
    return { unread: unread.n, attention, messages };
  });
}

export type WorkspaceShell = { counts: NavCounts; teams: { id: string; name: string; is_manager: boolean }[] };

/**
 * Everything the app shell needs before a page renders, in one statement inside one transaction: unread
 * notifications, the review-queue count, unread messages and the caller's teams. Replaces three separate
 * transactions (about fifteen round trips) with three. There is no policy check here: the general sign-off is gone
 * (owner decision, 5 October 2026), and nobody is asked to agree to anything since screen recording went (owner
 * decision, 8 October 2026: phase 8). The review count is submissions and time corrections (capture exceptions went too).
 */
export async function workspaceShell(ctx: OrgContext): Promise<WorkspaceShell> {
  const supervisor = ctx.membership.role !== "employee";
  return withUser(ctx.user.profileId, async (db) => {
    const r = await db.one<{ unread: number; attention: number; messages: number; teams: { id: string; name: string; is_manager: boolean }[] | null; recent: RecentNotification[] | null }>(
      `SELECT
         (SELECT count(*)::int FROM notifications WHERE recipient_membership_id = $2 AND read_at IS NULL) AS unread,
         CASE WHEN $3::boolean THEN
           (SELECT count(*) FROM tasks t WHERE t.organisation_id = $1 AND t.status = 'in_review' AND t.reviewer_membership_id = $2)
           + (SELECT count(*) FROM time_adjustments a WHERE a.organisation_id = $1 AND a.status = 'pending' AND a.membership_id <> $2)
         ELSE 0 END::int AS attention,
         ${unreadMessagesSql("$1", "$2")} AS messages,
         (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'is_manager', tm.is_manager) ORDER BY t.name)
            FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = $2 AND t.archived_at IS NULL) AS teams,
         (SELECT json_agg(n) FROM (SELECT id, type, title, body, href, read_at, created_at::text AS created_at FROM notifications WHERE recipient_membership_id = $2 ORDER BY created_at DESC LIMIT 6) n) AS recent`,
      [ctx.org.id, ctx.membership.id, supervisor]);
    return { counts: { unread: r.unread, attention: r.attention, messages: r.messages, recent: r.recent ?? [] }, teams: r.teams ?? [] };
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
    // Phase 8 (owner decision, 8 October 2026): "On a call" on the person's card (who is in a call, never which call).
    const onCall = await membersOnCall(db, ctx.org.id);
    return { ...row, on_call: onCall.has(row.membership_id) };
  });
}
