/**
 * A member's context outside their own request (owner decision, 8 October 2026: personal assistants, phase 4). A
 * follow-up is processed after the request that asked for it has ended (Next's `after()`), by the worker, or by someone
 * else's page settling an overdue one, and it must still act exactly as the person who asked: their facts are gathered
 * under their row-level security, and a model call is recorded against their allowance. This builds the context a
 * signed-in person would have, from the membership alone: the same query as the end-of-day report's recipient
 * (daily-report.ts), an active membership of an active sign-in, the organisation and its plan.
 */
import type { Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { resolveEntitlements } from "@/server/lib/entitlements";

type Row = {
  org_id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string;
  membership_id: string; role: OrgContext["membership"]["role"]; employee_code: string;
  profile_id: string; auth_user_id: string; display_name: string; email: string; email_verified_at: string | null;
};

/**
 * Who the context stands in for, as `user.sessionId`: "followup" (follow-ups and mentions, the default) or "routine" (a
 * scheduled routine, owner decision, 8 October 2026: phase 7a), or "standup" (the person's standup draft, owner
 * decisions, 8–9 October 2026: phase 7c). None is an interactive session: the consent rule (copilot's
 * `NON_INTERACTIVE_SESSIONS`) refuses a Confirm pressed with any of them, because an answer or agreement that arrives
 * through another person's assistant, a routine's run or a standup draft never confirms an action for the person.
 */
export type MemberSession = "followup" | "routine" | "standup";

/** The member as a signed-in person would be (`sessionId` "followup", "routine" or "standup"); null when they are no longer active. Run with the worker. */
export async function memberContext(db: Db, organisationId: string, membershipId: string, opts: { sessionId?: MemberSession } = {}): Promise<OrgContext | null> {
  const r = await db.maybeOne<Row>(
    `SELECT o.id AS org_id, o.slug, o.name, o.timezone, o.current_policy_id, o.status, m.id AS membership_id, m.role, m.employee_code,
            p.id AS profile_id, u.id AS auth_user_id, p.display_name, u.email, u.email_verified_at
     FROM memberships m JOIN organisations o ON o.id = m.organisation_id JOIN profiles p ON p.id = m.user_id JOIN auth_users u ON u.id = p.auth_user_id
     WHERE m.id = $1 AND m.organisation_id = $2 AND m.status = 'active' AND u.status = 'active'`, [membershipId, organisationId]);
  if (!r) return null;
  return {
    user: { profileId: r.profile_id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, emailVerified: !!r.email_verified_at, sessionId: opts.sessionId === "routine" || opts.sessionId === "standup" ? opts.sessionId : "followup" },
    org: { id: r.org_id, slug: r.slug, name: r.name, timezone: r.timezone, current_policy_id: r.current_policy_id, status: r.status },
    membership: { id: r.membership_id, role: r.role, employee_code: r.employee_code },
    plan: await resolveEntitlements(db, r.org_id),
  };
}
