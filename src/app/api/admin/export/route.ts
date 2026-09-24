import { adminRoute } from "@/server/admin/auth";
import { invalid } from "@/server/lib/errors";
import { withSystem } from "@/server/db";
import { adminAudit } from "@/server/admin/auth";

const csv = (v: unknown) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const EXPORTS: Record<string, { permission: "organization.view" | "user.view" | "payment.view" | "audit.view" | "subscription.view" | "usage.view"; sql: string }> = {
  organisations: { permission: "organization.view", sql: `SELECT o.id, o.name, o.slug, o.status, o.created_at, p.name AS plan, s.status AS subscription, s.current_period_end, (SELECT count(*) FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS users FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id ORDER BY o.created_at DESC` },
  users: { permission: "user.view", sql: `SELECT u.id, pr.display_name, u.email, u.status, u.email_verified_at, u.created_at, u.last_login_at FROM auth_users u JOIN profiles pr ON pr.auth_user_id = u.id ORDER BY u.created_at DESC` },
  payments: { permission: "payment.view", sql: `SELECT pt.reference, o.name AS organisation, pt.customer_email, p.name AS plan, pt.amount, pt.currency, pt.status, pt.channel, pt.paid_at, pt.created_at FROM payment_transactions pt LEFT JOIN organisations o ON o.id = pt.organisation_id LEFT JOIN plans p ON p.id = pt.plan_id ORDER BY pt.created_at DESC` },
  subscriptions: { permission: "subscription.view", sql: `SELECT o.name AS organisation, p.name AS plan, s.status, s.billing_interval, s.started_at, s.trial_ends_at, s.current_period_end, s.auto_renew, s.last_payment_at FROM subscriptions s JOIN organisations o ON o.id = s.organisation_id JOIN plans p ON p.id = s.plan_id ORDER BY s.current_period_end` },
  audit: { permission: "audit.view", sql: `SELECT a.occurred_at, u.email AS admin, a.action, a.target_type, a.target_label, a.reason, a.ip FROM platform_audit_events a LEFT JOIN auth_users u ON u.id = a.admin_user_id ORDER BY a.occurred_at DESC LIMIT 20000` },
  usage: { permission: "usage.view", sql: `SELECT o.name AS organisation, (SELECT count(*) FROM work_sessions ws WHERE ws.organisation_id = o.id) AS sessions, (SELECT count(*) FROM attendance_days a WHERE a.organisation_id = o.id) AS clock_ins, (SELECT count(*) FROM tasks t WHERE t.organisation_id = o.id) AS tasks, (SELECT count(*) FROM recordings r WHERE r.organisation_id = o.id AND r.deleted_at IS NULL) AS videos FROM organisations o ORDER BY o.name` },
};

/** CSV exports of the main datasets. */
export const GET = adminRoute("dashboard.view", async (req, { admin }) => {
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  const e = EXPORTS[kind];
  if (!e) throw invalid("Unknown export.");
  if (!admin.permissions.has(e.permission)) return new Response("Forbidden", { status: 403 });
  const rows = await withSystem(async (db) => { const r = await db.query<Record<string, unknown>>(e.sql); await adminAudit(db, admin, { action: `${kind}.exported`, targetType: kind, metadata: { count: r.length } }); return r; });
  const head = rows[0] ? Object.keys(rows[0]) : [];
  const body = [head.join(","), ...rows.map((r) => head.map((k) => csv(r[k])).join(","))].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
