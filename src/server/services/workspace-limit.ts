import { withSystem } from "@/server/db";
import { forbidden } from "@/server/lib/errors";

export type WorkspaceAllowance = { used: number; limit: number | null; plan: string; nextPlan: string | null };

/**
 * How many workspaces a person may own. The best plan among the workspaces they already own decides: Free owns one,
 * Pro up to five, Enterprise as many as they like (owner decision, 25 September 2026). Someone who owns nothing yet
 * gets the Free allowance, which is enough for their first workspace.
 */
export async function workspaceAllowance(userId: string): Promise<WorkspaceAllowance> {
  return withSystem(async (db) => {
    const owned = await db.query<{ plan_name: string | null; max_workspaces: number | null; sort_order: number | null }>(
      `SELECT p.name AS plan_name, p.max_workspaces, p.sort_order
         FROM memberships m JOIN organisations o ON o.id = m.organisation_id
         LEFT JOIN subscriptions s ON s.organisation_id = o.id AND s.status IN ('active', 'trial')
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE m.user_id = $1 AND m.role = 'owner' AND m.status = 'active' AND o.status = 'active'`, [userId]);
    const free = await db.maybeOne<{ name: string; max_workspaces: number | null }>(`SELECT name, max_workspaces FROM plans WHERE code = 'free'`);
    const best = owned.reduce<{ name: string; limit: number | null; sort: number } | null>((acc, o) => {
      const limit = o.plan_name ? o.max_workspaces : (free?.max_workspaces ?? 1);
      const name = o.plan_name ?? free?.name ?? "Free";
      const sort = o.sort_order ?? 0;
      if (!acc) return { name, limit, sort };
      if (acc.limit === null) return acc;
      if (limit === null || limit > acc.limit) return { name, limit, sort };
      return acc;
    }, null);
    const limit = best ? best.limit : (free?.max_workspaces ?? 1);
    const plan = best?.name ?? free?.name ?? "Free";
    const next = limit === null ? null : await db.maybeOne<{ name: string }>(`SELECT name FROM plans WHERE status = 'active' AND (max_workspaces IS NULL OR max_workspaces > $1) ORDER BY sort_order LIMIT 1`, [limit]);
    return { used: owned.length, limit, plan, nextPlan: next?.name ?? null };
  });
}

/** Throws when the person has used up their allowance, with a message that says what would lift it. */
export async function assertCanCreateWorkspace(userId: string) {
  const a = await workspaceAllowance(userId);
  if (a.limit !== null && a.used >= a.limit) {
    throw forbidden(`Your ${a.plan} plan allows ${a.limit} workspace${a.limit === 1 ? "" : "s"} and you already own ${a.used}.${a.nextPlan ? ` Move one of your workspaces to ${a.nextPlan} to open more.` : ""}`);
  }
  return a;
}
