import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";

export type NavCounts = { unread: number; attention: number };

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
    return { unread: unread.n, attention };
  });
}

export async function policyAcknowledged(ctx: OrgContext): Promise<boolean> {
  if (!ctx.org.current_policy_id) return true;
  return withUser(ctx.user.profileId, async (db) => !!(await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id])));
}
