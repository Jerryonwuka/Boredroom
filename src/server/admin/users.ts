/**
 * The global user directory: every account across every organisation, with the moderation and support actions.
 * Suspension and bans act on auth_users; the session lookup refuses those accounts, so the effect is immediate.
 */
import { z } from "zod";
import { withSystem, type Db } from "@/server/db";
import { notFound, invalid } from "@/server/lib/errors";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { emitEvent } from "@/server/admin/events";
import { requestPasswordRecovery } from "@/server/auth";

export type UserListFilter = { q?: string; status?: "all" | "active" | "invited" | "suspended" | "banned" | "deleted" | "unverified"; org?: string; role?: string; page?: number; pageSize?: number };

export type UserRow = {
  auth_user_id: string; profile_id: string; display_name: string; email: string; status: string; email_verified_at: string | null; created_at: string; last_login_at: string | null; last_seen: string | null; presence: string;
  orgs: { id: string; name: string; slug: string; role: string; plan: string | null }[] | null; is_admin: boolean; online: boolean; clocked_in: boolean;
};

const USER_SELECT = `
  SELECT u.id AS auth_user_id, pr.id AS profile_id, pr.display_name, u.email, u.status, u.email_verified_at, u.created_at, u.last_login_at, pr.presence,
         (SELECT MAX(last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS last_seen,
         (SELECT json_agg(json_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'role', m.role, 'plan', p.name) ORDER BY o.name)
            FROM memberships m JOIN organisations o ON o.id = m.organisation_id LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id
            WHERE m.user_id = pr.id AND m.status = 'active') AS orgs,
         EXISTS (SELECT 1 FROM platform_admins a WHERE a.auth_user_id = u.id AND a.status = 'active') AS is_admin,
         EXISTS (SELECT 1 FROM work_sessions ws WHERE ws.user_id = pr.id AND ws.state = 'running' AND ws.last_heartbeat_at > now() - interval '3 minutes') AS online,
         EXISTS (SELECT 1 FROM attendance_days ad JOIN memberships m2 ON m2.id = ad.membership_id WHERE m2.user_id = pr.id AND ad.local_date = CURRENT_DATE AND ad.clock_out_at IS NULL) AS clocked_in
  FROM auth_users u JOIN profiles pr ON pr.auth_user_id = u.id`;

export async function listUsers(f: UserListFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(100, Math.max(10, f.pageSize ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`(pr.display_name ILIKE $${params.length} ESCAPE '\\' OR u.email::text ILIKE $${params.length} ESCAPE '\\' OR u.id::text = $${params.length})`); }
  switch (f.status) {
    case "active": where.push(`u.status = 'active' AND u.email_verified_at IS NOT NULL`); break;
    case "unverified": where.push(`u.email_verified_at IS NULL AND u.status = 'active'`); break;
    case "invited": where.push(`NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = pr.id)`); break;
    case "suspended": case "banned": case "deleted": where.push(`u.status = '${f.status}'`); break;
    default: break;
  }
  if (f.org) { params.push(f.org); where.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = pr.id AND m.organisation_id = $${params.length})`); }
  if (f.role) { params.push(f.role); where.push(`EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = pr.id AND m.role = $${params.length} AND m.status = 'active')`); }
  const sql = `${USER_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return withSystem(async (db) => {
    const rows = await db.query<UserRow>(`SELECT * FROM (${sql}) x ORDER BY created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params);
    return { rows, total: total.n, page, pageSize: size };
  });
}

export async function userDetail(authUserId: string) {
  return withSystem(async (db) => {
    const user = await db.maybeOne<UserRow & { status_reason: string | null; status_changed_at: string | null; title: string | null; status_text: string | null; avatar_key: string | null; has_password: boolean; google: boolean; admin_role: string | null }>(
      `${USER_SELECT.replace("SELECT u.id AS auth_user_id,", "SELECT u.status_reason, u.status_changed_at, pr.title, pr.status_text, pr.avatar_key, (u.password_hash IS NOT NULL) AS has_password, EXISTS (SELECT 1 FROM auth_identities i WHERE i.user_id = u.id AND i.provider = 'google') AS google, (SELECT role FROM platform_admins a WHERE a.auth_user_id = u.id) AS admin_role, u.id AS auth_user_id,")} WHERE u.id = $1`, [authUserId]);
    if (!user) throw notFound("User not found.");
    const [sessions, logins, clockIns, tasks, recordings, security, adminAudit] = await Promise.all([
      db.query<{ id: string; created_at: string; last_seen_at: string; expires_at: string; revoked_at: string | null; user_agent: string | null; impersonation_id: string | null }>(`SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent, impersonation_id FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [authUserId]),
      db.query<{ occurred_at: string; action: string; metadata: Record<string, unknown> }>(`SELECT occurred_at, action, metadata FROM audit_events WHERE actor_user_id = $1 AND action LIKE 'auth.%' ORDER BY occurred_at DESC LIMIT 30`, [authUserId]),
      db.query<{ local_date: string; org_name: string; clock_in_at: string; clock_out_at: string | null; late_seconds: number }>(`SELECT ad.local_date::text, o.name AS org_name, ad.clock_in_at, ad.clock_out_at, ad.late_seconds FROM attendance_days ad JOIN memberships m ON m.id = ad.membership_id JOIN profiles pr ON pr.id = m.user_id JOIN organisations o ON o.id = ad.organisation_id WHERE pr.auth_user_id = $1 ORDER BY ad.local_date DESC LIMIT 30`, [authUserId]),
      db.one<{ open: number; completed: number; sessions_30d: number; hours_30d: number }>(
        `SELECT (SELECT count(*)::int FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles pr ON pr.id = m.user_id WHERE pr.auth_user_id = $1 AND t.status <> 'completed' AND t.archived_at IS NULL) AS open,
                (SELECT count(*)::int FROM tasks t JOIN memberships m ON m.id = t.assignee_membership_id JOIN profiles pr ON pr.id = m.user_id WHERE pr.auth_user_id = $1 AND t.status = 'completed') AS completed,
                (SELECT count(*)::int FROM work_sessions ws JOIN profiles pr ON pr.id = ws.user_id WHERE pr.auth_user_id = $1 AND ws.started_at > now() - interval '30 days') AS sessions_30d,
                COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at)))/3600 FROM session_intervals i JOIN memberships m ON m.id = i.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE pr.auth_user_id = $1 AND i.confirmation_status = 'confirmed' AND i.started_at > now() - interval '30 days'), 0)::float AS hours_30d`, [authUserId]),
      db.one<{ count: number; bytes: number }>(`SELECT count(*)::int AS count, COALESCE(SUM(received_bytes), 0)::bigint AS bytes FROM recordings r JOIN memberships m ON m.id = r.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE pr.auth_user_id = $1 AND r.deleted_at IS NULL`, [authUserId]),
      db.query<{ occurred_at: string; action: string; metadata: Record<string, unknown> }>(`SELECT occurred_at, action, metadata FROM audit_events WHERE actor_user_id = $1 AND action NOT LIKE 'auth.sign_in%' ORDER BY occurred_at DESC LIMIT 20`, [authUserId]),
      db.query<{ id: string; action: string; reason: string | null; occurred_at: string; admin_email: string | null }>(`SELECT a.id, a.action, a.reason, a.occurred_at, u.email AS admin_email FROM platform_audit_events a LEFT JOIN auth_users u ON u.id = a.admin_user_id WHERE a.target_type = 'user' AND a.target_id = $1 ORDER BY a.occurred_at DESC LIMIT 30`, [authUserId]),
    ]);
    const memberships = await db.query<{ id: string; organisation_id: string; org_name: string; role: string }>(`SELECT m.id, m.organisation_id, o.name AS org_name, m.role FROM memberships m JOIN profiles pr ON pr.id = m.user_id JOIN organisations o ON o.id = m.organisation_id WHERE pr.auth_user_id = $1 AND m.status = 'active' ORDER BY o.name`, [authUserId]);
    return { user, sessions, logins, clockIns, tasks, recordings, security, adminAudit, memberships };
  });
}

async function userOr404(db: Db, id: string) {
  const u = await db.maybeOne<{ id: string; email: string; status: string; display_name: string }>(`SELECT u.id, u.email, u.status, pr.display_name FROM auth_users u JOIN profiles pr ON pr.auth_user_id = u.id WHERE u.id = $1`, [id]);
  if (!u) throw notFound("User not found.");
  return u;
}

async function revokeAll(db: Db, id: string) {
  const r = await db.query<{ id: string }>(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
  return r.length;
}

export async function setUserStatus(admin: Admin, id: string, status: "active" | "suspended" | "banned" | "deleted", reason: string) {
  if (admin.user.authUserId === id && status !== "active") throw invalid("You cannot suspend your own account from here.");
  await withSystem(async (db) => {
    const u = await userOr404(db, id);
    const isAdmin = await db.maybeOne(`SELECT 1 FROM platform_admins WHERE auth_user_id = $1 AND status = 'active'`, [id]);
    if (isAdmin && status !== "active" && admin.role !== "super_admin") throw invalid("Only a super admin can suspend another administrator.");
    await db.query(`UPDATE auth_users SET status = $2, status_reason = $3, status_changed_at = now(), updated_at = now() WHERE id = $1`, [id, status, status === "active" ? null : reason]);
    let revoked = 0;
    if (status !== "active") revoked = await revokeAll(db, id);
    await adminAudit(db, admin, { action: `user.${status === "active" ? "reinstated" : status}`, targetType: "user", targetId: id, targetLabel: u.email, before: { status: u.status }, after: { status }, reason, metadata: { sessionsRevoked: revoked } });
    if (status === "suspended" || status === "banned") await emitEvent(db, "USER_SUSPENDED", { authUserId: id, email: u.email, status, reason });
  });
}

export async function forceLogout(admin: Admin, id: string, reason: string) {
  await withSystem(async (db) => {
    const u = await userOr404(db, id);
    const revoked = await revokeAll(db, id);
    await adminAudit(db, admin, { action: "user.sessions_revoked", targetType: "user", targetId: id, targetLabel: u.email, reason, metadata: { sessionsRevoked: revoked } });
  });
}

export async function forcePasswordReset(admin: Admin, id: string, reason: string) {
  const u = await withSystem(async (db) => {
    const u = await userOr404(db, id);
    await revokeAll(db, id);
    await adminAudit(db, admin, { action: "user.password_reset_forced", targetType: "user", targetId: id, targetLabel: u.email, reason });
    return u;
  });
  await requestPasswordRecovery(u.email, admin.ip ?? undefined);
}

export const roleChangeSchema = z.object({ membershipId: z.string().uuid(), role: z.enum(["owner", "hr", "manager", "employee"]), reason: z.string().trim().min(3).max(1000) });

export async function changeMembershipRole(admin: Admin, id: string, input: z.infer<typeof roleChangeSchema>) {
  await withSystem(async (db) => {
    const u = await userOr404(db, id);
    const m = await db.maybeOne<{ id: string; role: string; organisation_id: string; org_name: string }>(`SELECT m.id, m.role, m.organisation_id, o.name AS org_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id JOIN organisations o ON o.id = m.organisation_id WHERE m.id = $1 AND pr.auth_user_id = $2`, [input.membershipId, id]);
    if (!m) throw notFound("That membership does not belong to this user.");
    await db.query(`UPDATE memberships SET role = $2 WHERE id = $1`, [m.id, input.role]);
    await adminAudit(db, admin, { action: "user.role_changed", targetType: "user", targetId: id, targetLabel: u.email, organisationId: m.organisation_id, before: { role: m.role }, after: { role: input.role }, reason: input.reason, metadata: { organisation: m.org_name } });
  });
}
