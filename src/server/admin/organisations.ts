/**
 * Organisations (tenants) as the Control Center sees them: the list with filters and search, the detail with its
 * tabs, and the moderation and billing actions. Everything runs in the system context after a permission check.
 */
import { z } from "zod";
import { withSystem, type Db } from "@/server/db";
import { notFound, invalid } from "@/server/lib/errors";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { emitEvent } from "@/server/admin/events";
import { FEATURE_KEYS } from "@/server/admin/settings";

export type OrgListFilter = { q?: string; status?: "all" | "active" | "trial" | "expiring" | "suspended" | "archived"; plan?: string; page?: number; pageSize?: number; sort?: "created" | "activity" | "users" | "name" };

export type OrgRow = {
  id: string; name: string; slug: string; status: string; created_at: string; suspended_at: string | null; archived_at: string | null;
  owner_name: string | null; owner_email: string | null; users: number; plan_code: string | null; plan_name: string | null;
  sub_status: string | null; period_end: string | null; trial_ends_at: string | null; last_activity_at: string | null; storage_bytes: number;
};

const ORG_SELECT = `
  SELECT o.id, o.name, o.slug, o.status, o.created_at, o.suspended_at, o.archived_at,
         ow.display_name AS owner_name, ow.email AS owner_email,
         (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS users,
         p.code AS plan_code, p.name AS plan_name, s.status AS sub_status, s.current_period_end AS period_end, s.trial_ends_at,
         (SELECT MAX(COALESCE(ws.ended_at, ws.last_heartbeat_at)) FROM work_sessions ws WHERE ws.organisation_id = o.id) AS last_activity_at,
         (COALESCE((SELECT SUM(received_bytes) FROM recordings r WHERE r.organisation_id = o.id AND r.deleted_at IS NULL), 0)
          + COALESCE((SELECT SUM(size_bytes) FROM deliverables d WHERE d.organisation_id = o.id), 0))::bigint AS storage_bytes
  FROM organisations o
  LEFT JOIN LATERAL (SELECT pr.display_name, pr.email FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = o.id AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1) ow ON true
  LEFT JOIN subscriptions s ON s.organisation_id = o.id
  LEFT JOIN plans p ON p.id = s.plan_id`;

export async function listOrganisations(f: OrgListFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(100, Math.max(10, f.pageSize ?? 25));
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) { params.push(q); where.push(`(o.name ILIKE $${params.length} ESCAPE '\\' OR o.slug ILIKE $${params.length} ESCAPE '\\' OR o.id::text = ${"$" + params.length} OR ow.email ILIKE $${params.length} ESCAPE '\\')`); }
  switch (f.status) {
    case "active": where.push(`o.status = 'active'`); break;
    case "trial": where.push(`s.status = 'trial'`); break;
    case "expiring": where.push(`s.current_period_end IS NOT NULL AND s.current_period_end BETWEEN now() AND now() + interval '30 days' AND s.status IN ('trial','active','past_due')`); break;
    case "suspended": where.push(`o.status = 'suspended'`); break;
    case "archived": where.push(`o.status = 'archived'`); break;
    default: break;
  }
  if (f.plan) { params.push(f.plan); where.push(`p.code = $${params.length}`); }
  // The ordering runs on the wrapped result, so it names output columns, not table aliases.
  const order = f.sort === "activity" ? "last_activity_at DESC NULLS LAST" : f.sort === "users" ? "users DESC" : f.sort === "name" ? "name" : "created_at DESC";
  const sql = `${ORG_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return withSystem(async (db) => {
    const rows = await db.query<OrgRow>(`SELECT * FROM (${sql}) x ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params);
    const plans = await db.query<{ code: string; name: string }>(`SELECT code, name FROM plans WHERE status <> 'archived' ORDER BY sort_order`);
    return { rows, total: total.n, page, pageSize: size, plans };
  });
}

export async function organisationDetail(id: string) {
  return withSystem(async (db) => {
    const org = await db.maybeOne<OrgRow & { timezone: string; suspended_reason: string | null; feature_overrides: Record<string, boolean>; setup_state: unknown; plan_features: Record<string, boolean> | null; plan_max_users: number | null; plan_max_storage: number | null; sub_id: string | null; billing_interval: string | null; auto_renew: boolean | null; last_payment_at: string | null; payment_status: string | null }>(
      `${ORG_SELECT.replace("SELECT o.id,", "SELECT o.timezone, o.suspended_reason, o.feature_overrides, o.setup_state, p.features AS plan_features, p.max_users AS plan_max_users, p.max_storage_bytes AS plan_max_storage, s.id AS sub_id, s.billing_interval, s.auto_renew, s.last_payment_at, s.payment_status, o.id,")} WHERE o.id = $1`, [id]);
    if (!org) throw notFound("Organisation not found.");
    const [members, teams, tasks, attendance, activity, payments, audit, usage] = await Promise.all([
      db.query<{ membership_id: string; profile_id: string; auth_user_id: string; display_name: string; email: string; role: string; status: string; employee_code: string; joined: string; user_status: string; last_seen: string | null; presence: string }>(
        `SELECT m.id AS membership_id, pr.id AS profile_id, pr.auth_user_id, pr.display_name, pr.email, m.role, m.status, m.employee_code, m.created_at AS joined, u.status AS user_status, pr.presence,
                (SELECT MAX(last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_seen
         FROM memberships m JOIN profiles pr ON pr.id = m.user_id JOIN auth_users u ON u.id = pr.auth_user_id WHERE m.organisation_id = $1 ORDER BY m.role, pr.display_name`, [id]),
      db.query<{ id: string; name: string; members: number; leads: string[]; archived_at: string | null }>(
        `SELECT t.id, t.name, t.archived_at, (SELECT count(*)::int FROM team_members tm WHERE tm.team_id = t.id) AS members,
                COALESCE((SELECT array_agg(pr.display_name) FROM team_members tm JOIN memberships m ON m.id = tm.membership_id JOIN profiles pr ON pr.id = m.user_id WHERE tm.team_id = t.id AND tm.is_manager), '{}') AS leads
         FROM teams t WHERE t.organisation_id = $1 ORDER BY t.archived_at NULLS FIRST, t.name`, [id]),
      db.one<{ total: number; open: number; blocked: number; in_review: number; completed: number; completed_30d: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('todo','in_progress'))::int AS open, count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
                count(*) FILTER (WHERE status = 'in_review')::int AS in_review, count(*) FILTER (WHERE status = 'completed')::int AS completed,
                count(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '30 days')::int AS completed_30d
         FROM tasks WHERE organisation_id = $1 AND archived_at IS NULL`, [id]),
      db.query<{ local_date: string; clock_ins: number; late: number }>(
        `SELECT local_date::text, count(*)::int AS clock_ins, count(*) FILTER (WHERE late_seconds > 0)::int AS late FROM attendance_days WHERE organisation_id = $1 AND local_date > CURRENT_DATE - 14 GROUP BY local_date ORDER BY local_date DESC`, [id]),
      db.query<{ display_name: string; state: string; task_title: string; started_at: string; last_heartbeat_at: string }>(
        `SELECT pr.display_name, s.state, t.title AS task_title, s.started_at, s.last_heartbeat_at FROM work_sessions s JOIN memberships m ON m.id = s.membership_id JOIN profiles pr ON pr.id = m.user_id JOIN tasks t ON t.id = s.task_id
         WHERE s.organisation_id = $1 AND s.state IN ('running','paused','interrupted') ORDER BY s.started_at DESC`, [id]),
      db.query<{ id: string; reference: string; amount: number; currency: string; status: string; paid_at: string | null; created_at: string; plan_name: string | null; channel: string | null }>(
        `SELECT pt.id, pt.reference, pt.amount, pt.currency, pt.status, pt.paid_at, pt.created_at, pt.channel, p.name AS plan_name FROM payment_transactions pt LEFT JOIN plans p ON p.id = pt.plan_id WHERE pt.organisation_id = $1 ORDER BY pt.created_at DESC LIMIT 50`, [id]),
      db.query<{ id: string; action: string; target_type: string; target_label: string | null; reason: string | null; occurred_at: string; admin_email: string | null }>(
        `SELECT a.id, a.action, a.target_type, a.target_label, a.reason, a.occurred_at, u.email AS admin_email FROM platform_audit_events a LEFT JOIN auth_users u ON u.id = a.admin_user_id WHERE a.organisation_id = $1 ORDER BY a.occurred_at DESC LIMIT 50`, [id]),
      db.one<{ sessions_30d: number; hours_30d: number; recordings: number; recording_bytes: number; deliverable_bytes: number; clock_ins_30d: number; active_users_7d: number }>(
        `SELECT (SELECT count(*)::int FROM work_sessions WHERE organisation_id = $1 AND started_at > now() - interval '30 days') AS sessions_30d,
                COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)))/3600 FROM session_intervals WHERE organisation_id = $1 AND confirmation_status = 'confirmed' AND started_at > now() - interval '30 days'), 0)::float AS hours_30d,
                (SELECT count(*)::int FROM recordings WHERE organisation_id = $1 AND deleted_at IS NULL) AS recordings,
                COALESCE((SELECT SUM(received_bytes) FROM recordings WHERE organisation_id = $1 AND deleted_at IS NULL), 0)::bigint AS recording_bytes,
                COALESCE((SELECT SUM(size_bytes) FROM deliverables WHERE organisation_id = $1), 0)::bigint AS deliverable_bytes,
                (SELECT count(*)::int FROM attendance_days WHERE organisation_id = $1 AND local_date > CURRENT_DATE - 30) AS clock_ins_30d,
                (SELECT count(DISTINCT membership_id)::int FROM work_sessions WHERE organisation_id = $1 AND started_at > now() - interval '7 days') AS active_users_7d`, [id]),
    ]);
    const plans = await db.query<{ id: string; code: string; name: string }>(`SELECT id, code, name FROM plans WHERE status <> 'archived' ORDER BY sort_order`);
    return { org, members, teams, tasks, attendance, activity, payments, audit, usage, plans, featureKeys: FEATURE_KEYS };
  });
}

// ---- Actions -----------------------------------------------------------------------

async function orgOr404(db: Db, id: string) {
  const o = await db.maybeOne<{ id: string; name: string; status: string; suspended_reason: string | null }>(`SELECT id, name, status, suspended_reason FROM organisations WHERE id = $1`, [id]);
  if (!o) throw notFound("Organisation not found.");
  return o;
}

export async function suspendOrganisation(admin: Admin, id: string, reason: string) {
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    await db.query(`UPDATE organisations SET status = 'suspended', suspended_at = now(), suspended_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
    // Members are signed out; they cannot sign back in while the organisation is suspended (orgContext refuses).
    await db.query(`UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT pr.auth_user_id FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active')`, [id]);
    await adminAudit(db, admin, { action: "organization.suspended", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before: { status: o.status }, after: { status: "suspended" }, reason });
    await emitEvent(db, "ORGANIZATION_SUSPENDED", { organisationId: id, reason });
  });
}

export async function unsuspendOrganisation(admin: Admin, id: string, reason: string) {
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    await db.query(`UPDATE organisations SET status = 'active', suspended_at = NULL, suspended_reason = NULL, archived_at = NULL, updated_at = now() WHERE id = $1`, [id]);
    await adminAudit(db, admin, { action: "organization.unsuspended", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before: { status: o.status }, after: { status: "active" }, reason });
  });
}

export async function archiveOrganisation(admin: Admin, id: string, reason: string) {
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    await db.query(`UPDATE organisations SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1`, [id]);
    await db.query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), auto_renew = false, updated_at = now() WHERE organisation_id = $1`, [id]);
    await adminAudit(db, admin, { action: "organization.archived", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before: { status: o.status }, after: { status: "archived" }, reason });
  });
}

export const featureOverridesSchema = z.record(z.string().regex(/^[A-Z_]{3,40}$/), z.boolean());

export async function setFeatureOverrides(admin: Admin, id: string, overrides: Record<string, boolean>, reason: string | null) {
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    const before = await db.one<{ feature_overrides: Record<string, boolean> }>(`SELECT feature_overrides FROM organisations WHERE id = $1`, [id]);
    await db.query(`UPDATE organisations SET feature_overrides = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify(overrides)]);
    await adminAudit(db, admin, { action: "organization.features.updated", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before: before.feature_overrides, after: overrides, reason });
  });
}

export const changePlanSchema = z.object({ planId: z.string().uuid(), interval: z.enum(["monthly", "annual"]).optional(), status: z.enum(["trial", "active", "cancelled", "expired", "suspended", "past_due"]).optional(), periodEnd: z.string().datetime({ offset: true }).nullable().optional(), reason: z.string().trim().min(3).max(1000) });

export async function changePlan(admin: Admin, id: string, input: z.infer<typeof changePlanSchema>) {
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    const plan = await db.maybeOne<{ id: string; name: string; trial_days: number }>(`SELECT id, name, trial_days FROM plans WHERE id = $1`, [input.planId]);
    if (!plan) throw invalid("That plan does not exist.");
    const before = await db.maybeOne<{ plan_id: string; status: string; current_period_end: string | null; billing_interval: string }>(`SELECT plan_id, status, current_period_end, billing_interval FROM subscriptions WHERE organisation_id = $1`, [id]);
    const status = input.status ?? before?.status ?? "active";
    await db.query(
      `INSERT INTO subscriptions(organisation_id, plan_id, status, billing_interval, current_period_end, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, billing_interval = EXCLUDED.billing_interval, current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end), updated_at = now()`,
      [id, plan.id, status, input.interval ?? before?.billing_interval ?? "monthly", input.periodEnd ?? null]);
    await adminAudit(db, admin, { action: "subscription.plan_changed", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before, after: { planId: plan.id, plan: plan.name, status, periodEnd: input.periodEnd ?? before?.current_period_end ?? null }, reason: input.reason });
    await emitEvent(db, "SUBSCRIPTION_CREATED", { organisationId: id, planId: plan.id, plan: plan.name, byAdmin: true });
  });
}

export async function extendTrial(admin: Admin, id: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw invalid("Days must be between 1 and 365.");
  await withSystem(async (db) => {
    const o = await orgOr404(db, id);
    const before = await db.maybeOne<{ status: string; trial_ends_at: string | null; current_period_end: string | null }>(`SELECT status, trial_ends_at, current_period_end FROM subscriptions WHERE organisation_id = $1`, [id]);
    const r = await db.one<{ trial_ends_at: string; current_period_end: string }>(
      `UPDATE subscriptions SET status = CASE WHEN status IN ('expired','cancelled','past_due','payment_failed') THEN 'trial' ELSE status END,
              trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + ($2 || ' days')::interval,
              current_period_end = GREATEST(COALESCE(current_period_end, now()), now()) + ($2 || ' days')::interval, updated_at = now()
       WHERE organisation_id = $1 RETURNING trial_ends_at, current_period_end`, [id, String(days)]);
    await adminAudit(db, admin, { action: "subscription.trial_extended", targetType: "organisation", targetId: id, targetLabel: o.name, organisationId: id, before, after: r, reason, metadata: { days } });
  });
}
