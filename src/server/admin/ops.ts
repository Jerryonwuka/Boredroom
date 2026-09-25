/**
 * Operations: the dashboard's numbers, usage and live activity, storage, system health and jobs, global search,
 * the administrative audit log, administrator management, impersonation.
 */
import { z } from "zod";
import { withSystem, type Db } from "@/server/db";
import { invalid, notFound, forbidden } from "@/server/lib/errors";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { ADMIN_ROLES, type AdminRole } from "@/server/admin/permissions";
import { runHealthChecks } from "@/server/lib/health";
import { paystackConfigured } from "@/server/admin/billing";
import { brevoConfigured } from "@/server/admin/marketing";
import { issueSession } from "@/server/auth";

// ---- Dashboard -----------------------------------------------------------------------------------------------------

export async function dashboardMetrics() {
  return withSystem(async (db) => {
    const platform = await db.one<{ orgs: number; active_orgs: number; new_today: number; new_week: number; new_month: number; users: number; active_users: number; online: number; clocked_in: number; suspended_orgs: number; suspended_users: number }>(
      `SELECT (SELECT count(*)::int FROM organisations) AS orgs,
              (SELECT count(*)::int FROM organisations WHERE status = 'active') AS active_orgs,
              (SELECT count(*)::int FROM organisations WHERE created_at::date = CURRENT_DATE) AS new_today,
              (SELECT count(*)::int FROM organisations WHERE created_at > now() - interval '7 days') AS new_week,
              (SELECT count(*)::int FROM organisations WHERE created_at > now() - interval '30 days') AS new_month,
              (SELECT count(*)::int FROM auth_users WHERE status <> 'deleted') AS users,
              (SELECT count(DISTINCT user_id)::int FROM auth_sessions WHERE last_seen_at > now() - interval '30 days' AND revoked_at IS NULL) AS active_users,
              (SELECT count(DISTINCT user_id)::int FROM work_sessions WHERE state = 'running' AND last_heartbeat_at > now() - interval '3 minutes') AS online,
              (SELECT count(*)::int FROM attendance_days WHERE local_date = CURRENT_DATE AND clock_out_at IS NULL) AS clocked_in,
              (SELECT count(*)::int FROM organisations WHERE status = 'suspended') AS suspended_orgs,
              (SELECT count(*)::int FROM auth_users WHERE status IN ('suspended','banned')) AS suspended_users`);
    const subs = await db.one<{ free: number; trial: number; paid: number; expiring: number; expired: number; cancelled: number; failed: number }>(
      `SELECT (SELECT count(*)::int FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE p.monthly_price = 0 AND s.status IN ('active','trial')) AS free,
              (SELECT count(*)::int FROM subscriptions WHERE status = 'trial') AS trial,
              (SELECT count(*)::int FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE p.monthly_price > 0 AND s.status = 'active') AS paid,
              (SELECT count(*)::int FROM subscriptions WHERE status IN ('active','trial') AND current_period_end BETWEEN now() AND now() + interval '14 days') AS expiring,
              (SELECT count(*)::int FROM subscriptions WHERE status = 'expired') AS expired,
              (SELECT count(*)::int FROM subscriptions WHERE status = 'cancelled') AS cancelled,
              (SELECT count(*)::int FROM subscriptions WHERE status IN ('payment_failed','past_due')) AS failed`);
    const usage = await db.one<{ tasks: number; tasks_done: number; clock_ins: number; heartbeats: number; videos: number; storage: number; active_sessions: number }>(
      `SELECT (SELECT count(*)::int FROM tasks WHERE archived_at IS NULL) AS tasks,
              (SELECT count(*)::int FROM tasks WHERE status = 'completed') AS tasks_done,
              (SELECT count(*)::int FROM attendance_days) AS clock_ins,
              (SELECT count(*)::int FROM work_sessions) AS heartbeats,
              (SELECT count(*)::int FROM recordings WHERE deleted_at IS NULL) AS videos,
              (COALESCE((SELECT SUM(received_bytes) FROM recordings WHERE deleted_at IS NULL), 0) + COALESCE((SELECT SUM(size_bytes) FROM deliverables), 0))::bigint AS storage,
              (SELECT count(*)::int FROM work_sessions WHERE state IN ('running','paused','interrupted')) AS active_sessions`);
    const alerts = await db.one<{ failed_jobs: number; failed_payments_7d: number; paystack_errors: number; brevo_errors: number; storage_heavy: number }>(
      `SELECT (SELECT count(*)::int FROM jobs WHERE state = 'failed') AS failed_jobs,
              (SELECT count(*)::int FROM payment_transactions WHERE status = 'failed' AND created_at > now() - interval '7 days') AS failed_payments_7d,
              (SELECT count(*)::int FROM paystack_events WHERE error IS NOT NULL) AS paystack_errors,
              (SELECT count(*)::int FROM marketing_contacts WHERE brevo_error IS NOT NULL) AS brevo_errors,
              (SELECT count(*)::int FROM (SELECT s.organisation_id FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE p.max_storage_bytes IS NOT NULL AND (COALESCE((SELECT SUM(received_bytes) FROM recordings r WHERE r.organisation_id = s.organisation_id AND r.deleted_at IS NULL), 0) + COALESCE((SELECT SUM(size_bytes) FROM deliverables d WHERE d.organisation_id = s.organisation_id), 0)) > p.max_storage_bytes * 0.8) x) AS storage_heavy`);
    const recentOrgs = await db.query<{ id: string; name: string; created_at: string; owner_email: string | null; plan: string | null }>(`SELECT o.id, o.name, o.created_at, (SELECT pr.email FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner_email, p.name AS plan FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id ORDER BY o.created_at DESC LIMIT 6`);
    return { platform, subs, usage, alerts, recentOrgs };
  });
}

// ---- Usage and live activity -------------------------------------------------------------------------------------------

/** Sessions, clock-ins and completed tasks per day for the dashboard charts. The lighter sibling of usageOverview. */
export async function activityByDay(days = 30) {
  return withSystem((db) => db.query<{ day: string; sessions: number; clock_ins: number; tasks_completed: number }>(
    `SELECT d::date::text AS day,
            (SELECT count(*)::int FROM work_sessions WHERE started_at::date = d::date) AS sessions,
            (SELECT count(*)::int FROM attendance_days WHERE local_date = d::date) AS clock_ins,
            (SELECT count(*)::int FROM tasks WHERE completed_at::date = d::date) AS tasks_completed
     FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') d ORDER BY d`, [days]));
}

export async function usageOverview(days = 30) {
  return withSystem(async (db) => {
    const totals = await db.one<{ active_users: number; mau: number; clock_ins: number; clock_outs: number; sessions: number; tasks_created: number; tasks_completed: number; videos: number; hours: number }>(
      `SELECT (SELECT count(DISTINCT user_id)::int FROM auth_sessions WHERE last_seen_at > now() - interval '1 day') AS active_users,
              (SELECT count(DISTINCT user_id)::int FROM auth_sessions WHERE last_seen_at > now() - interval '30 days') AS mau,
              (SELECT count(*)::int FROM attendance_days WHERE local_date > CURRENT_DATE - $1::int) AS clock_ins,
              (SELECT count(*)::int FROM attendance_days WHERE local_date > CURRENT_DATE - $1::int AND clock_out_at IS NOT NULL) AS clock_outs,
              (SELECT count(*)::int FROM work_sessions WHERE started_at > now() - ($1 || ' days')::interval) AS sessions,
              (SELECT count(*)::int FROM tasks WHERE created_at > now() - ($1 || ' days')::interval) AS tasks_created,
              (SELECT count(*)::int FROM tasks WHERE completed_at > now() - ($1 || ' days')::interval) AS tasks_completed,
              (SELECT count(*)::int FROM recordings WHERE created_at > now() - ($1 || ' days')::interval AND deleted_at IS NULL) AS videos,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)))/3600 FROM session_intervals WHERE confirmation_status = 'confirmed' AND started_at > now() - ($1 || ' days')::interval), 0)::float AS hours`, [String(days)]);
    const byDay = await db.query<{ day: string; sessions: number; clock_ins: number; tasks_completed: number }>(
      `SELECT d::date::text AS day,
              (SELECT count(*)::int FROM work_sessions WHERE started_at::date = d::date) AS sessions,
              (SELECT count(*)::int FROM attendance_days WHERE local_date = d::date) AS clock_ins,
              (SELECT count(*)::int FROM tasks WHERE completed_at::date = d::date) AS tasks_completed
       FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') d ORDER BY d`, [days]);
    const byOrg = await db.query<{ id: string; name: string; plan: string | null; users: number; sessions: number; hours: number; clock_ins: number; storage: number }>(
      `SELECT o.id, o.name, p.name AS plan,
              (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS users,
              (SELECT count(*)::int FROM work_sessions ws WHERE ws.organisation_id = o.id AND ws.started_at > now() - ($1 || ' days')::interval) AS sessions,
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(i.ended_at, now()) - i.started_at)))/3600 FROM session_intervals i WHERE i.organisation_id = o.id AND i.confirmation_status = 'confirmed' AND i.started_at > now() - ($1 || ' days')::interval), 0)::float AS hours,
              (SELECT count(*)::int FROM attendance_days a WHERE a.organisation_id = o.id AND a.local_date > CURRENT_DATE - $1::int) AS clock_ins,
              (COALESCE((SELECT SUM(received_bytes) FROM recordings r WHERE r.organisation_id = o.id AND r.deleted_at IS NULL), 0) + COALESCE((SELECT SUM(size_bytes) FROM deliverables d WHERE d.organisation_id = o.id), 0))::bigint AS storage
       FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id ORDER BY sessions DESC, o.name LIMIT 100`, [String(days)]);
    const byPlan = await db.query<{ plan: string; orgs: number; users: number; sessions: number }>(
      `SELECT p.name AS plan, count(DISTINCT o.id)::int AS orgs, (SELECT count(*)::int FROM memberships m JOIN subscriptions s2 ON s2.organisation_id = m.organisation_id WHERE s2.plan_id = p.id AND m.status = 'active') AS users,
              (SELECT count(*)::int FROM work_sessions ws JOIN subscriptions s3 ON s3.organisation_id = ws.organisation_id WHERE s3.plan_id = p.id AND ws.started_at > now() - ($1 || ' days')::interval) AS sessions
       FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id LEFT JOIN organisations o ON o.id = s.organisation_id GROUP BY p.id, p.name, p.sort_order ORDER BY p.sort_order`, [String(days)]);
    return { days, totals, byDay, byOrg, byPlan };
  });
}

export async function liveActivity(filter: { org?: string; state?: "working" | "paused" | "clocked_in" | "all" } = {}) {
  return withSystem(async (db) => {
    const rows = await db.query<{ org_id: string; org_name: string; display_name: string; state: string; task_title: string | null; started_at: string | null; last_heartbeat_at: string | null; clocked_in_at: string | null; stale: boolean }>(
      `SELECT o.id AS org_id, o.name AS org_name, pr.display_name, COALESCE(s.state, CASE WHEN ad.id IS NOT NULL THEN 'clocked_in' ELSE 'offline' END) AS state, t.title AS task_title, s.started_at, s.last_heartbeat_at, ad.clock_in_at AS clocked_in_at,
              (s.state = 'running' AND s.last_heartbeat_at < now() - interval '3 minutes') AS stale
       FROM memberships m JOIN organisations o ON o.id = m.organisation_id JOIN profiles pr ON pr.id = m.user_id
       LEFT JOIN work_sessions s ON s.membership_id = m.id AND s.state IN ('running','paused','interrupted')
       LEFT JOIN tasks t ON t.id = s.task_id
       LEFT JOIN attendance_days ad ON ad.membership_id = m.id AND ad.local_date = CURRENT_DATE AND ad.clock_out_at IS NULL
       WHERE m.status = 'active' AND o.status = 'active' AND (s.id IS NOT NULL OR ad.id IS NOT NULL) AND ($1::uuid IS NULL OR o.id = $1)
       ORDER BY o.name, s.started_at DESC NULLS LAST, pr.display_name`, [filter.org && /^[0-9a-f-]{36}$/i.test(filter.org) ? filter.org : null]);
    const filtered = rows.filter((r) => filter.state === "working" ? r.state === "running" : filter.state === "paused" ? r.state === "paused" || r.state === "interrupted" : filter.state === "clocked_in" ? !!r.clocked_in_at : true);
    const groups = new Map<string, { id: string; name: string; people: typeof rows }>();
    for (const r of filtered) { const g = groups.get(r.org_id) ?? { id: r.org_id, name: r.org_name, people: [] }; g.people.push(r); groups.set(r.org_id, g); }
    return { groups: [...groups.values()], counts: { working: rows.filter((r) => r.state === "running").length, paused: rows.filter((r) => r.state === "paused" || r.state === "interrupted").length, clockedIn: rows.filter((r) => r.clocked_in_at).length } };
  });
}

export async function storageOverview() {
  return withSystem(async (db) => {
    const totals = await db.one<{ recordings: number; deliverables: number; avatars: number; voice: number }>(
      `SELECT COALESCE((SELECT SUM(received_bytes) FROM recordings WHERE deleted_at IS NULL), 0)::bigint AS recordings,
              COALESCE((SELECT SUM(size_bytes) FROM deliverables), 0)::bigint AS deliverables,
              (SELECT count(*)::int FROM profiles WHERE avatar_key IS NOT NULL) AS avatars,
              (SELECT count(*)::int FROM messages WHERE voice_key IS NOT NULL AND deleted_at IS NULL) AS voice`);
    const byOrg = await db.query<{ id: string; name: string; plan: string | null; quota: number | null; recordings: number; deliverables: number; total: number }>(
      `SELECT o.id, o.name, p.name AS plan, p.max_storage_bytes AS quota,
              COALESCE((SELECT SUM(received_bytes) FROM recordings r WHERE r.organisation_id = o.id AND r.deleted_at IS NULL), 0)::bigint AS recordings,
              COALESCE((SELECT SUM(size_bytes) FROM deliverables d WHERE d.organisation_id = o.id), 0)::bigint AS deliverables,
              (COALESCE((SELECT SUM(received_bytes) FROM recordings r WHERE r.organisation_id = o.id AND r.deleted_at IS NULL), 0) + COALESCE((SELECT SUM(size_bytes) FROM deliverables d WHERE d.organisation_id = o.id), 0))::bigint AS total
       FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id ORDER BY total DESC LIMIT 100`);
    const growth = await db.query<{ month: string; bytes: number }>(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, SUM(received_bytes)::bigint AS bytes FROM recordings WHERE created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`);
    return { totals, byOrg, growth };
  });
}

// ---- System ---------------------------------------------------------------------------------------------------------

export async function systemOverview() {
  const health = await runHealthChecks().catch((err) => ({ ok: false, checks: { health: { ok: false, detail: (err as Error).message } }, nodeEnv: process.env.NODE_ENV, mailProvider: "?", storageProvider: "?", assistantServerKey: false }));
  const jobs = await withSystem(async (db) => {
    const counts = await db.one<{ pending: number; running: number; failed: number; succeeded_24h: number; oldest_pending: string | null }>(`SELECT count(*) FILTER (WHERE state = 'pending')::int AS pending, count(*) FILTER (WHERE state = 'running')::int AS running, count(*) FILTER (WHERE state = 'failed')::int AS failed, count(*) FILTER (WHERE state = 'succeeded' AND finished_at > now() - interval '1 day')::int AS succeeded_24h, (SELECT MIN(next_run_at) FROM jobs WHERE state = 'pending')::text AS oldest_pending FROM jobs`);
    const recent = await db.query<{ id: string; type: string; state: string; attempts: number; max_attempts: number; next_run_at: string; finished_at: string | null; last_error: string | null; created_at: string }>(`SELECT id, type, state, attempts, max_attempts, next_run_at, finished_at, last_error, created_at FROM jobs ORDER BY created_at DESC LIMIT 100`);
    const failed = await db.query<{ id: string; type: string; attempts: number; last_error: string | null; created_at: string }>(`SELECT id, type, attempts, last_error, created_at FROM jobs WHERE state = 'failed' ORDER BY created_at DESC LIMIT 50`);
    const byType = await db.query<{ type: string; total: number; failed: number }>(`SELECT type, count(*)::int AS total, count(*) FILTER (WHERE state = 'failed')::int AS failed FROM jobs WHERE created_at > now() - interval '7 days' GROUP BY type ORDER BY total DESC`);
    const integrations = await db.one<{ paystack_errors: number; paystack_events_24h: number; brevo_errors: number; brevo_synced_24h: number; email_failed_24h: number; email_sent_24h: number }>(`SELECT (SELECT count(*)::int FROM paystack_events WHERE error IS NOT NULL) AS paystack_errors, (SELECT count(*)::int FROM paystack_events WHERE received_at > now() - interval '1 day') AS paystack_events_24h, (SELECT count(*)::int FROM marketing_contacts WHERE brevo_error IS NOT NULL) AS brevo_errors, (SELECT count(*)::int FROM marketing_contacts WHERE brevo_synced_at > now() - interval '1 day') AS brevo_synced_24h, (SELECT count(*)::int FROM email_log WHERE status = 'failed' AND created_at > now() - interval '1 day') AS email_failed_24h, (SELECT count(*)::int FROM email_log WHERE status = 'sent' AND created_at > now() - interval '1 day') AS email_sent_24h`);
    const errors = await db.query<{ occurred_at: string; action: string; metadata: Record<string, unknown> }>(`SELECT occurred_at, action, metadata FROM audit_events WHERE action LIKE '%.failed' OR action LIKE '%error%' ORDER BY occurred_at DESC LIMIT 50`);
    return { counts, recent, failed, byType, integrations, errors };
  });
  return { health, jobs, paystack: paystackConfigured(), brevo: brevoConfigured() };
}

export async function retryJob(admin: Admin, id: string) {
  await withSystem(async (db) => {
    const j = await db.maybeOne<{ type: string }>(`UPDATE jobs SET state = 'pending', next_run_at = now(), attempts = 0, last_error = NULL, locked_at = NULL, locked_by = NULL WHERE id = $1 AND state = 'failed' RETURNING type`, [id]);
    if (!j) throw notFound("That job is not failed.");
    await adminAudit(db, admin, { action: "job.retried", targetType: "job", targetId: id, targetLabel: j.type });
  });
}

// ---- Global search --------------------------------------------------------------------------------------------------------

export async function globalSearch(q: string) {
  const term = q.trim();
  if (!term) return { users: [], organisations: [], payments: [], contacts: [], subscriptions: [], campaigns: [] };
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return withSystem(async (db) => {
    const [users, organisations, payments, contacts, subscriptions, campaigns] = await Promise.all([
      db.query<{ id: string; display_name: string; email: string; status: string }>(`SELECT u.id, pr.display_name, u.email, u.status FROM auth_users u JOIN profiles pr ON pr.auth_user_id = u.id WHERE pr.display_name ILIKE $1 ESCAPE '\\' OR u.email::text ILIKE $1 ESCAPE '\\' OR u.id::text = $2 ORDER BY pr.display_name LIMIT 8`, [like, term]),
      db.query<{ id: string; name: string; slug: string; status: string }>(`SELECT id, name, slug, status FROM organisations WHERE name ILIKE $1 ESCAPE '\\' OR slug ILIKE $1 ESCAPE '\\' OR id::text = $2 ORDER BY name LIMIT 8`, [like, term]),
      db.query<{ id: string; reference: string; amount: number; currency: string; status: string }>(`SELECT id, reference, amount, currency, status FROM payment_transactions WHERE reference ILIKE $1 ESCAPE '\\' OR customer_email::text ILIKE $1 ESCAPE '\\' OR paystack_id::text = $2 ORDER BY created_at DESC LIMIT 8`, [like, term]),
      db.query<{ id: string; email: string; first_name: string | null; last_name: string | null; status: string }>(`SELECT id, email, first_name, last_name, status FROM marketing_contacts WHERE email::text ILIKE $1 ESCAPE '\\' OR first_name ILIKE $1 ESCAPE '\\' OR last_name ILIKE $1 ESCAPE '\\' OR company ILIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 8`, [like]),
      db.query<{ id: string; org_name: string; status: string; code: string | null }>(`SELECT s.id, o.name AS org_name, s.status, s.paystack_subscription_code AS code FROM subscriptions s JOIN organisations o ON o.id = s.organisation_id WHERE s.id::text = $2 OR s.paystack_subscription_code ILIKE $1 ESCAPE '\\' LIMIT 5`, [like, term]),
      db.query<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM campaigns WHERE name ILIKE $1 ESCAPE '\\' OR subject ILIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 5`, [like]),
    ]);
    return { users, organisations, payments, contacts, subscriptions, campaigns };
  });
}

// ---- Audit ----------------------------------------------------------------------------------------------------------

export type AuditFilter = { q?: string; action?: string; admin?: string; org?: string; from?: string; to?: string; page?: number; pageSize?: number };

export async function auditLog(f: AuditFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(200, Math.max(10, f.pageSize ?? 50));
  const where: string[] = []; const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(a.target_label ILIKE $${params.length} OR a.action ILIKE $${params.length} OR a.reason ILIKE $${params.length} OR a.target_id ILIKE $${params.length})`); }
  if (f.action) { params.push(`${f.action}%`); where.push(`a.action LIKE $${params.length}`); }
  if (f.admin) { params.push(f.admin); where.push(`a.admin_user_id = $${params.length}`); }
  if (f.org) { params.push(f.org); where.push(`a.organisation_id = $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`a.occurred_at >= $${params.length}::timestamptz`); }
  if (f.to) { params.push(f.to); where.push(`a.occurred_at < $${params.length}::timestamptz + interval '1 day'`); }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  return withSystem(async (db) => {
    const rows = await db.query<{ id: string; action: string; target_type: string; target_id: string | null; target_label: string | null; organisation_id: string | null; org_name: string | null; before: unknown; after: unknown; reason: string | null; ip: string | null; metadata: Record<string, unknown>; occurred_at: string; admin_email: string | null; admin_name: string | null }>(
      `SELECT a.*, u.email AS admin_email, pr.display_name AS admin_name, o.name AS org_name FROM platform_audit_events a LEFT JOIN auth_users u ON u.id = a.admin_user_id LEFT JOIN profiles pr ON pr.auth_user_id = u.id LEFT JOIN organisations o ON o.id = a.organisation_id${w} ORDER BY a.occurred_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM platform_audit_events a${w}`, params);
    const actions = await db.query<{ action: string }>(`SELECT DISTINCT split_part(action, '.', 1) AS action FROM platform_audit_events ORDER BY 1`);
    const admins = await db.query<{ id: string; email: string }>(`SELECT u.id, u.email FROM platform_admins a JOIN auth_users u ON u.id = a.auth_user_id ORDER BY u.email`);
    return { rows, total: total.n, page, pageSize: size, actions: actions.map((a) => a.action), admins };
  });
}

// ---- Admins ------------------------------------------------------------------------------------------------------------

export type AdminRow = { id: string; auth_user_id: string; email: string; display_name: string; role: AdminRole; status: string; created_at: string; last_login_at: string | null; created_by_email: string | null; mfa: boolean; sessions: number };

export const listAdmins = () => withSystem((db) => db.query<AdminRow>(`SELECT a.id, a.auth_user_id, u.email, pr.display_name, a.role, a.status, a.created_at, a.last_login_at, cu.email AS created_by_email, u.mfa_required AS mfa, (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions FROM platform_admins a JOIN auth_users u ON u.id = a.auth_user_id JOIN profiles pr ON pr.auth_user_id = u.id LEFT JOIN auth_users cu ON cu.id = a.created_by ORDER BY a.created_at`));

export const adminCreateSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ADMIN_ROLES) });

export async function createAdmin(admin: Admin, input: z.infer<typeof adminCreateSchema>) {
  if (admin.role !== "super_admin") throw forbidden("Only a super admin manages administrators.");
  return withSystem(async (db) => {
    const u = await db.maybeOne<{ id: string }>(`SELECT id FROM auth_users WHERE email = $1 AND status = 'active'`, [input.email]);
    if (!u) throw invalid("No active Boredroom account has that email. The person creates an account first, then you make them an administrator.");
    const row = await db.one<{ id: string }>(`INSERT INTO platform_admins(auth_user_id, role, status, created_by) VALUES ($1, $2, 'active', $3) ON CONFLICT (auth_user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', disabled_at = NULL RETURNING id`, [u.id, input.role, admin.user.authUserId]);
    await adminAudit(db, admin, { action: "admin.created", targetType: "admin", targetId: u.id, targetLabel: input.email, after: { role: input.role } });
    return row;
  });
}

export async function updateAdmin(admin: Admin, id: string, input: { role?: AdminRole; status?: "active" | "disabled"; revokeSessions?: boolean; reason?: string | null }) {
  if (admin.role !== "super_admin") throw forbidden("Only a super admin manages administrators.");
  await withSystem(async (db) => {
    const a = await db.maybeOne<{ auth_user_id: string; role: AdminRole; status: string; email: string }>(`SELECT a.auth_user_id, a.role, a.status, u.email FROM platform_admins a JOIN auth_users u ON u.id = a.auth_user_id WHERE a.id = $1`, [id]);
    if (!a) throw notFound("Administrator not found.");
    if (a.auth_user_id === admin.user.authUserId && (input.status === "disabled" || (input.role && input.role !== "super_admin"))) throw invalid("You cannot remove your own super admin access.");
    if (input.role || input.status) await db.query(`UPDATE platform_admins SET role = COALESCE($2, role), status = COALESCE($3, status), disabled_at = CASE WHEN $3 = 'disabled' THEN now() WHEN $3 = 'active' THEN NULL ELSE disabled_at END WHERE id = $1`, [id, input.role ?? null, input.status ?? null]);
    if (input.revokeSessions || input.status === "disabled") await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [a.auth_user_id]);
    await adminAudit(db, admin, { action: input.status === "disabled" ? "admin.disabled" : input.revokeSessions ? "admin.sessions_revoked" : "admin.updated", targetType: "admin", targetId: a.auth_user_id, targetLabel: a.email, before: { role: a.role, status: a.status }, after: input, reason: input.reason });
  });
}

// ---- Impersonation --------------------------------------------------------------------------------------------------------

/** Starts viewing Boredroom as another person: a fresh session for them, marked with the impersonation record. */
export async function startImpersonation(admin: Admin, targetUserId: string, reason: string, meta: { userAgent?: string }) {
  return withSystem(async (db) => {
    const t = await db.maybeOne<{ id: string; email: string; status: string; is_admin: boolean }>(`SELECT u.id, u.email, u.status, EXISTS (SELECT 1 FROM platform_admins a WHERE a.auth_user_id = u.id AND a.status = 'active') AS is_admin FROM auth_users u WHERE u.id = $1`, [targetUserId]);
    if (!t) throw notFound("User not found.");
    if (t.id === admin.user.authUserId) throw invalid("That is you.");
    if (t.is_admin) throw forbidden("Administrators cannot be impersonated.");
    if (t.status !== "active") throw invalid("That account is not active.");
    const rec = await db.one<{ id: string }>(`INSERT INTO admin_impersonations(admin_user_id, target_user_id, reason) VALUES ($1, $2, $3) RETURNING id`, [admin.user.authUserId, t.id, reason]);
    const token = await issueSession(db, t.id, { ip: admin.ip ?? undefined, userAgent: meta.userAgent, method: "google" });
    const s = await db.one<{ id: string }>(`UPDATE auth_sessions SET impersonation_id = $2, expires_at = LEAST(expires_at, now() + interval '2 hours') WHERE token_hash = encode(sha256($1::bytea), 'hex') RETURNING id`, [Buffer.from(token), rec.id]);
    await db.query(`UPDATE admin_impersonations SET session_id = $2 WHERE id = $1`, [rec.id, s.id]);
    await adminAudit(db, admin, { action: "user.impersonation_started", targetType: "user", targetId: t.id, targetLabel: t.email, reason, metadata: { impersonationId: rec.id } });
    return { token, impersonationId: rec.id, email: t.email };
  });
}

export async function endImpersonation(impersonationId: string, adminUserId: string | null) {
  await withSystem(async (db) => {
    const r = await db.maybeOne<{ id: string; session_id: string | null; target_user_id: string }>(`UPDATE admin_impersonations SET ended_at = now() WHERE id = $1 AND ended_at IS NULL RETURNING id, session_id, target_user_id`, [impersonationId]);
    if (!r) return;
    if (r.session_id) await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [r.session_id]);
    await db.query(`INSERT INTO platform_audit_events(admin_user_id, action, target_type, target_id, metadata) VALUES ($1, 'user.impersonation_ended', 'user', $2, $3)`, [adminUserId, r.target_user_id, JSON.stringify({ impersonationId })]);
  });
}

/** Whether a session is an impersonation, for the banner in the app shell. */
export async function impersonationForSession(db: Db, sessionId: string) {
  return db.maybeOne<{ id: string; admin_email: string; started_at: string }>(`SELECT i.id, u.email AS admin_email, i.started_at FROM auth_sessions s JOIN admin_impersonations i ON i.id = s.impersonation_id JOIN auth_users u ON u.id = i.admin_user_id WHERE s.id = $1 AND i.ended_at IS NULL`, [sessionId]);
}

export const impersonations = () => withSystem((db) => db.query<{ id: string; admin_email: string; target_email: string; target_name: string; reason: string; started_at: string; ended_at: string | null }>(`SELECT i.id, au.email AS admin_email, tu.email AS target_email, pr.display_name AS target_name, i.reason, i.started_at, i.ended_at FROM admin_impersonations i JOIN auth_users au ON au.id = i.admin_user_id JOIN auth_users tu ON tu.id = i.target_user_id JOIN profiles pr ON pr.auth_user_id = tu.id ORDER BY i.started_at DESC LIMIT 100`));
