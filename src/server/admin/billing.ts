/**
 * Plans, subscriptions and payments, with Paystack as the processor.
 *
 * Money is stored in minor units (kobo for NGN). Paystack talks to us two ways: the browser is sent to a Paystack
 * checkout we initialise (and comes back to /api/billing/paystack/callback, where we verify the reference), and
 * Paystack posts webhooks to /api/billing/paystack/webhook, verified with the HMAC the secret key produces. Both
 * paths land in `recordPayment`, which is idempotent on the reference, so a redelivered webhook changes nothing.
 */
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystem, withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, invalid, notFound, forbidden } from "@/server/lib/errors";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { emitEvent } from "@/server/admin/events";
import { paystackConfig, type PaymentMode } from "@/server/admin/paystack-config";
import { notifyBilling } from "@/server/admin/billing-reminders";
import { dateOnly } from "@/lib/format";

// ---- Plans ---------------------------------------------------------------------------------------------------

export const planSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3).default("NGN"),
  monthlyPrice: z.number().int().min(0),
  annualPrice: z.number().int().min(0),
  maxUsers: z.number().int().positive().nullable().optional(),
  maxStorageGb: z.number().positive().nullable().optional(),
  maxWorkspaces: z.number().int().positive().nullable().optional(),
  trialDays: z.number().int().min(0).max(365).default(0),
  features: z.record(z.string(), z.boolean()).default({}),
  status: z.enum(["active", "hidden", "archived"]).default("active"),
  sortOrder: z.number().int().default(0),
});

export type PlanRow = { id: string; code: string; name: string; description: string | null; currency: string; monthly_price: number; annual_price: number; max_users: number | null; max_storage_bytes: number | null; max_workspaces: number | null; trial_days: number; features: Record<string, boolean>; status: string; sort_order: number; subscribers: number; created_at: string };

export async function listPlans(includeArchived = true) {
  return withSystem((db) => db.query<PlanRow>(`SELECT p.*, (SELECT count(*)::int FROM subscriptions s WHERE s.plan_id = p.id) AS subscribers FROM plans p ${includeArchived ? "" : "WHERE p.status <> 'archived'"} ORDER BY p.sort_order, p.created_at`));
}

export async function savePlan(admin: Admin, id: string | null, input: z.infer<typeof planSchema>) {
  return withSystem(async (db) => {
    const bytes = input.maxStorageGb ? Math.round(input.maxStorageGb * 1024 * 1024 * 1024) : null;
    const before = id ? await db.maybeOne<PlanRow>(`SELECT * FROM plans WHERE id = $1`, [id]) : null;
    if (id && !before) throw notFound("Plan not found.");
    const row = id
      ? await db.one<{ id: string }>(`UPDATE plans SET code = $2, name = $3, description = $4, currency = $5, monthly_price = $6, annual_price = $7, max_users = $8, max_storage_bytes = $9, trial_days = $10, features = $11, status = $12, sort_order = $13, max_workspaces = $14, updated_at = now() WHERE id = $1 RETURNING id`,
          [id, input.code, input.name, input.description ?? null, input.currency, input.monthlyPrice, input.annualPrice, input.maxUsers ?? null, bytes, input.trialDays, JSON.stringify(input.features), input.status, input.sortOrder, input.maxWorkspaces ?? null])
      : await db.one<{ id: string }>(`INSERT INTO plans(code, name, description, currency, monthly_price, annual_price, max_users, max_storage_bytes, trial_days, features, status, sort_order, max_workspaces) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [input.code, input.name, input.description ?? null, input.currency, input.monthlyPrice, input.annualPrice, input.maxUsers ?? null, bytes, input.trialDays, JSON.stringify(input.features), input.status, input.sortOrder, input.maxWorkspaces ?? null]);
    await adminAudit(db, admin, { action: id ? "plan.updated" : "plan.created", targetType: "plan", targetId: row.id, targetLabel: input.name, before, after: input });
    return row;
  });
}

// ---- Subscriptions ----------------------------------------------------------------------------------------------

export type SubscriptionFilter = { status?: "all" | "active" | "trial" | "expiring" | "expired" | "cancelled" | "past_due"; within?: number; page?: number; pageSize?: number; q?: string };
export type SubscriptionRow = { id: string; organisation_id: string; org_name: string; org_slug: string; owner_email: string | null; owner_name: string | null; plan_name: string; plan_code: string; currency: string; amount: number; status: string; billing_interval: string; started_at: string; trial_ends_at: string | null; current_period_end: string | null; auto_renew: boolean; last_payment_at: string | null; payment_status: string | null; paystack_subscription_code: string | null };

const SUB_SELECT = `
  SELECT s.id, s.organisation_id, o.name AS org_name, o.slug AS org_slug, ow.email AS owner_email, ow.display_name AS owner_name, p.name AS plan_name, p.code AS plan_code, p.currency,
         CASE WHEN s.billing_interval = 'annual' THEN p.annual_price ELSE p.monthly_price END AS amount,
         s.status, s.billing_interval, s.started_at, s.trial_ends_at, s.current_period_end, s.auto_renew, s.last_payment_at, s.payment_status, s.paystack_subscription_code
  FROM subscriptions s JOIN organisations o ON o.id = s.organisation_id JOIN plans p ON p.id = s.plan_id
  LEFT JOIN LATERAL (SELECT pr.display_name, pr.email FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = o.id AND m.role = 'owner' AND m.status = 'active' ORDER BY m.created_at LIMIT 1) ow ON true`;

export async function listSubscriptions(f: SubscriptionFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(100, Math.max(10, f.pageSize ?? 25));
  const where: string[] = []; const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(o.name ILIKE $${params.length} OR ow.email::text ILIKE $${params.length} OR s.paystack_subscription_code ILIKE $${params.length})`); }
  switch (f.status) {
    case "active": where.push(`s.status = 'active'`); break;
    case "trial": where.push(`s.status = 'trial'`); break;
    case "expired": where.push(`s.status = 'expired'`); break;
    case "cancelled": where.push(`s.status = 'cancelled'`); break;
    case "past_due": where.push(`s.status IN ('past_due','payment_failed')`); break;
    case "expiring": { params.push(String(f.within ?? 30)); where.push(`s.status IN ('trial','active','past_due') AND s.current_period_end IS NOT NULL AND s.current_period_end BETWEEN now() AND now() + ($${params.length} || ' days')::interval`); break; }
    default: break;
  }
  const sql = `${SUB_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return withSystem(async (db) => {
    const rows = await db.query<SubscriptionRow>(`SELECT * FROM (${sql}) x ORDER BY current_period_end ASC NULLS LAST, org_name LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params);
    return { rows, total: total.n, page, pageSize: size };
  });
}

/** Counts for the expiry dashboard buckets. */
export async function expiryBuckets() {
  return withSystem((db) => db.one<{ today: number; tomorrow: number; d3: number; d7: number; d14: number; d30: number; expired: number }>(
    `SELECT count(*) FILTER (WHERE current_period_end::date = CURRENT_DATE)::int AS today,
            count(*) FILTER (WHERE current_period_end::date = CURRENT_DATE + 1)::int AS tomorrow,
            count(*) FILTER (WHERE current_period_end BETWEEN now() AND now() + interval '3 days')::int AS d3,
            count(*) FILTER (WHERE current_period_end BETWEEN now() AND now() + interval '7 days')::int AS d7,
            count(*) FILTER (WHERE current_period_end BETWEEN now() AND now() + interval '14 days')::int AS d14,
            count(*) FILTER (WHERE current_period_end BETWEEN now() AND now() + interval '30 days')::int AS d30,
            count(*) FILTER (WHERE status = 'expired' OR (current_period_end < now() AND status IN ('active','trial','past_due')))::int AS expired
     FROM subscriptions WHERE status NOT IN ('cancelled')`));
}

export const subscriptionEditSchema = z.object({ status: z.enum(["trial", "active", "payment_failed", "past_due", "cancelled", "expired", "suspended"]).optional(), periodEnd: z.string().datetime({ offset: true }).nullable().optional(), autoRenew: z.boolean().optional(), notes: z.string().max(2000).nullable().optional(), reason: z.string().trim().min(3).max(1000) });

export async function editSubscription(admin: Admin, id: string, input: z.infer<typeof subscriptionEditSchema>) {
  await withSystem(async (db) => {
    const before = await db.maybeOne<{ organisation_id: string; status: string; current_period_end: string | null; auto_renew: boolean; notes: string | null; org_name: string }>(`SELECT s.organisation_id, s.status, s.current_period_end, s.auto_renew, s.notes, o.name AS org_name FROM subscriptions s JOIN organisations o ON o.id = s.organisation_id WHERE s.id = $1`, [id]);
    if (!before) throw notFound("Subscription not found.");
    await db.query(`UPDATE subscriptions SET status = COALESCE($2, status), current_period_end = CASE WHEN $3::boolean THEN $4::timestamptz ELSE current_period_end END, auto_renew = COALESCE($5, auto_renew), notes = COALESCE($6, notes), cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END, updated_at = now() WHERE id = $1`,
      [id, input.status ?? null, input.periodEnd !== undefined, input.periodEnd ?? null, input.autoRenew ?? null, input.notes ?? null]);
    await adminAudit(db, admin, { action: "subscription.updated", targetType: "subscription", targetId: id, targetLabel: before.org_name, organisationId: before.organisation_id, before, after: input, reason: input.reason });
    if (input.status === "cancelled") await emitEvent(db, "SUBSCRIPTION_CANCELLED", { organisationId: before.organisation_id, byAdmin: true });
  });
}

// ---- Payments ----------------------------------------------------------------------------------------------

export type PaymentFilter = { status?: "all" | "success" | "failed" | "refunded" | "pending"; q?: string; from?: string; to?: string; org?: string; page?: number; pageSize?: number };
export type PaymentRow = { id: string; reference: string; organisation_id: string | null; org_name: string | null; customer_email: string | null; plan_name: string | null; amount: number; currency: string; status: string; channel: string | null; paid_at: string | null; created_at: string; paystack_id: number | null; subscription_id: string | null; interval: string | null };

const PAY_SELECT = `SELECT pt.id, pt.reference, pt.organisation_id, o.name AS org_name, pt.customer_email, p.name AS plan_name, pt.amount, pt.currency, pt.status, pt.channel, pt.paid_at, pt.created_at, pt.paystack_id, pt.subscription_id, pt.interval
  FROM payment_transactions pt LEFT JOIN organisations o ON o.id = pt.organisation_id LEFT JOIN plans p ON p.id = pt.plan_id`;

export async function listPayments(f: PaymentFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(100, Math.max(10, f.pageSize ?? 25));
  const where: string[] = []; const params: unknown[] = [];
  if (f.status && f.status !== "all") { params.push(f.status); where.push(`pt.status = $${params.length}`); }
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(pt.reference ILIKE $${params.length} OR pt.customer_email::text ILIKE $${params.length} OR o.name ILIKE $${params.length})`); }
  if (f.org) { params.push(f.org); where.push(`pt.organisation_id = $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`pt.created_at >= $${params.length}::timestamptz`); }
  if (f.to) { params.push(f.to); where.push(`pt.created_at < $${params.length}::timestamptz + interval '1 day'`); }
  const sql = `${PAY_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return withSystem(async (db) => {
    const rows = await db.query<PaymentRow>(`SELECT * FROM (${sql}) x ORDER BY created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, params);
    return { rows, total: total.n, page, pageSize: size };
  });
}

export async function paymentDetail(id: string) {
  return withSystem(async (db) => {
    const tx = await db.maybeOne<PaymentRow & { gateway_response: string | null; raw: unknown; refunded_at: string | null; org_slug: string | null }>(`${PAY_SELECT.replace("SELECT pt.id,", "SELECT pt.gateway_response, pt.raw, pt.refunded_at, o.slug AS org_slug, pt.id,")} WHERE pt.id = $1 OR pt.reference = $2`, [/^[0-9a-f-]{36}$/i.test(id) ? id : "00000000-0000-0000-0000-000000000000", id]);
    if (!tx) throw notFound("Transaction not found.");
    const events = await db.query<{ id: string; event: string; received_at: string; processed_at: string | null; error: string | null }>(`SELECT id, event, received_at, processed_at, error FROM paystack_events WHERE reference = $1 ORDER BY received_at DESC`, [tx.reference]);
    const audit = await db.query<{ action: string; reason: string | null; occurred_at: string; admin_email: string | null }>(`SELECT a.action, a.reason, a.occurred_at, u.email AS admin_email FROM platform_audit_events a LEFT JOIN auth_users u ON u.id = a.admin_user_id WHERE a.target_type = 'payment' AND a.target_id = $1 ORDER BY a.occurred_at DESC`, [tx.id]);
    return { tx, events, audit };
  });
}

/** Revenue and counts for the dashboards. Currency is the platform's (NGN unless configured); sums are in minor units. */
export async function paymentMetrics() {
  return withSystem((db) => db.one<{ currency: string; today: number; month: number; year: number; success: number; failed: number; pending: number; refunded: number; mrr: number; arr: number; by_plan: { plan: string; amount: number }[] | null; by_month: { month: string; amount: number }[] | null }>(
    `SELECT COALESCE((SELECT currency FROM payment_transactions WHERE status = 'success' ORDER BY paid_at DESC LIMIT 1), 'NGN') AS currency,
            COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE status = 'success' AND paid_at::date = CURRENT_DATE), 0)::bigint AS today,
            COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE status = 'success' AND date_trunc('month', paid_at) = date_trunc('month', now())), 0)::bigint AS month,
            COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE status = 'success' AND date_trunc('year', paid_at) = date_trunc('year', now())), 0)::bigint AS year,
            (SELECT count(*)::int FROM payment_transactions WHERE status = 'success') AS success,
            (SELECT count(*)::int FROM payment_transactions WHERE status = 'failed') AS failed,
            (SELECT count(*)::int FROM payment_transactions WHERE status = 'pending') AS pending,
            (SELECT count(*)::int FROM payment_transactions WHERE status = 'refunded') AS refunded,
            COALESCE((SELECT SUM(CASE WHEN s.billing_interval = 'annual' THEN p.annual_price / 12 ELSE p.monthly_price END) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active'), 0)::bigint AS mrr,
            COALESCE((SELECT SUM(CASE WHEN s.billing_interval = 'annual' THEN p.annual_price ELSE p.monthly_price * 12 END) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active'), 0)::bigint AS arr,
            (SELECT json_agg(x) FROM (SELECT COALESCE(p.name, 'Unknown') AS plan, SUM(pt.amount)::bigint AS amount FROM payment_transactions pt LEFT JOIN plans p ON p.id = pt.plan_id WHERE pt.status = 'success' GROUP BY p.name ORDER BY amount DESC) x) AS by_plan,
            (SELECT json_agg(x) FROM (SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, SUM(amount)::bigint AS amount FROM payment_transactions WHERE status = 'success' AND paid_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1) x) AS by_month`));
}

/**
 * A refund takes back the time that payment bought (security audit, 23 October 2026, issue 10 and verification V5): the
 * workspace's period end moves back by the payment's interval (1 or 12 months), never earlier than now, and its
 * payment status reads "refunded". When nothing is left of the period the subscription is expired at once (no grace
 * days: the money is back). Returns the before and after for the audit row and the PAYMENT_REFUNDED event, which an
 * admin sees in the Control Center; null when the workspace has no dated period (a free plan, or none).
 */
async function takeBackRefundedPeriod(db: Db, organisationId: string | null, interval: string | null) {
  if (!organisationId) return null;
  const r = await db.maybeOne<{ before_end: string; before_status: string; after_end: string; after_status: string }>(
    `WITH old AS (SELECT id, current_period_end, status FROM subscriptions WHERE organisation_id = $1 AND current_period_end IS NOT NULL FOR UPDATE),
          upd AS (
            UPDATE subscriptions s SET
              current_period_end = GREATEST(now(), old.current_period_end - ($2 || ' months')::interval),
              status = CASE WHEN old.current_period_end - ($2 || ' months')::interval <= now() AND s.status IN ('active', 'past_due', 'payment_failed') THEN 'expired' ELSE s.status END,
              payment_status = 'refunded', updated_at = now()
            FROM old WHERE s.id = old.id RETURNING s.current_period_end, s.status)
     SELECT old.current_period_end::text AS before_end, old.status AS before_status, upd.current_period_end::text AS after_end, upd.status AS after_status FROM old, upd`,
    [organisationId, interval === "annual" ? "12" : "1"]);
  return r ? { periodEndBefore: r.before_end, statusBefore: r.before_status, periodEndAfter: r.after_end, statusAfter: r.after_status } : null;
}

export async function markRefunded(admin: Admin, id: string, reason: string) {
  await withSystem(async (db) => {
    const tx = await db.maybeOne<{ id: string; reference: string; status: string; organisation_id: string | null; interval: string | null }>(`SELECT id, reference, status, organisation_id, interval FROM payment_transactions WHERE id = $1 FOR UPDATE`, [id]);
    if (!tx) throw notFound("Transaction not found.");
    if (tx.status !== "success") throw invalid("Only a successful payment can be marked refunded.");
    await db.query(`UPDATE payment_transactions SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE id = $1`, [id]);
    const period = await takeBackRefundedPeriod(db, tx.organisation_id, tx.interval);
    await adminAudit(db, admin, { action: "payment.refunded", targetType: "payment", targetId: id, targetLabel: tx.reference, organisationId: tx.organisation_id, before: { status: tx.status, ...(period ? { periodEnd: period.periodEndBefore, subscription: period.statusBefore } : {}) }, after: { status: "refunded", ...(period ? { periodEnd: period.periodEndAfter, subscription: period.statusAfter } : {}) }, reason });
    await emitEvent(db, "PAYMENT_REFUNDED", { organisationId: tx.organisation_id, reference: tx.reference, ...(period ?? {}) });
  });
}

// ---- Paystack -----------------------------------------------------------------------------------------------------

export async function paystackConfigured() { return !!(await paystackConfig()).secretKey; }
const PAYSTACK = "https://api.paystack.co";

async function paystack<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = (await paystackConfig()).secretKey;
  if (!key) throw new AppError(503, "PAYSTACK_NOT_CONFIGURED", "Payments are not set up on this server yet.");
  const res = await fetch(`${PAYSTACK}${path}`, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || body.status === false) throw new AppError(502, "PAYSTACK_ERROR", `Paystack: ${body.message ?? res.statusText}`);
  return body.data as T;
}

/**
 * Verifies a webhook body against Paystack's signature (HMAC SHA-512 of the raw body with the secret key). Cheapest
 * first (owner request, 23 October 2026: realtime plan, phase 0, item 5): the signature's shape and a JSON body with an
 * `event`, and only then the current mode's secret key, which may need the database (`onLookup` is told just before,
 * for the wake tag). Junk never reaches the database.
 *
 * Only the current mode's key verifies (security audit, 23 October 2026, issue 9): in live mode a signature made with
 * the test key, stored or in PAYSTACK_SECRET_KEY, is refused, and the other way round. The environment's key counts
 * only when paystackConfig() falls back to it (nothing stored for the mode in use).
 */
export async function verifyPaystackSignature(rawBody: string, signature: string | null, onLookup?: () => void): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature) || !rawBody) return false;
  try {
    const e = JSON.parse(rawBody) as { event?: unknown } | null;
    if (!e || typeof e.event !== "string") return false;
  } catch { return false; }
  const matches = (key: string) => {
    const expected = createHmac("sha512", key).update(rawBody).digest("hex");
    const a = Buffer.from(expected), b = Buffer.from(signature.toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  };
  onLookup?.();
  const key = (await paystackConfig()).secretKey;
  return !!key && matches(key);
}

/** An organisation owner starts a checkout: returns Paystack's hosted page URL. The reference carries our ids. */
export async function startCheckout(ctx: OrgContext, input: { planId: string; interval: "monthly" | "annual" }) {
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the organisation account can change the plan.");
  const plan = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ id: string; code: string; name: string; currency: string; monthly_price: number; annual_price: number }>(`SELECT id, code, name, currency, monthly_price, annual_price FROM plans WHERE id = $1 AND status = 'active'`, [input.planId]));
  if (!plan) throw notFound("That plan is not available.");
  const amount = input.interval === "annual" ? plan.annual_price : plan.monthly_price;
  if (amount <= 0) {
    // A free plan needs no payment: switch at once.
    await withSystem(async (db) => {
      await db.query(`INSERT INTO subscriptions(organisation_id, plan_id, status, billing_interval, current_period_end, updated_at) VALUES ($1, $2, 'active', $3, NULL, now()) ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', billing_interval = EXCLUDED.billing_interval, current_period_end = NULL, updated_at = now()`, [ctx.org.id, plan.id, input.interval]);
      await emitEvent(db, "SUBSCRIPTION_CREATED", { organisationId: ctx.org.id, planId: plan.id, plan: plan.name });
    });
    return { free: true as const };
  }
  const reference = `BR-${ctx.org.id.replace(/-/g, "").slice(0, 12)}-${Date.now().toString(36)}`.toUpperCase();
  await withSystem((db) => db.query(`INSERT INTO payment_transactions(reference, organisation_id, plan_id, customer_email, amount, currency, status, interval, subscription_id) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, (SELECT id FROM subscriptions WHERE organisation_id = $2))`, [reference, ctx.org.id, plan.id, ctx.user.email, amount, plan.currency, input.interval]));
  const data = await paystack<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", { method: "POST", body: {
    email: ctx.user.email, amount, currency: plan.currency, reference, callback_url: `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/api/billing/paystack/callback`,
    metadata: { organisation_id: ctx.org.id, organisation: ctx.org.name, plan_id: plan.id, plan: plan.code, interval: input.interval, custom_fields: [{ display_name: "Organisation", variable_name: "organisation", value: ctx.org.name }, { display_name: "Plan", variable_name: "plan", value: `${plan.name} (${input.interval})` }] },
  } });
  return { free: false as const, url: data.authorization_url, reference };
}

type PaystackTx = { id: number; reference: string; status: string; amount: number; currency: string; domain?: string; channel?: string; gateway_response?: string; paid_at?: string | null; customer?: { email?: string; customer_code?: string }; authorization?: Record<string, unknown>; metadata?: { organisation_id?: string; plan_id?: string; interval?: string } | null; plan?: unknown };

/**
 * Verifies a reference with Paystack and records the outcome. A reference Boredroom never created is answered at once,
 * without asking Paystack (security audit, 23 October 2026, issue 2): the public callback is no longer a way to have
 * any transaction on the account looked up and recorded.
 */
export async function verifyAndRecord(reference: string) {
  const ours = await withSystem((db) => db.maybeOne<{ id: string }>(`SELECT id FROM payment_transactions WHERE reference = $1`, [reference]));
  if (!ours) return { changed: false, status: "unmatched" as const, organisationId: null };
  const mode = (await paystackConfig()).mode;
  const tx = await paystack<PaystackTx>(`/transaction/verify/${encodeURIComponent(reference)}`);
  return withSystem((db) => recordPayment(db, tx, mode));
}

// Final states (security audit, 23 October 2026, issue 10): once a payment has succeeded, only a refund (markRefunded,
// refund.processed) moves it on, and a refunded payment never comes back. So the subscription period is extended by the
// first success alone, and replaying the public callback or a stale webhook after a refund changes nothing.
const FINAL_PAYMENT_STATES = new Set(["success", "refunded"]);

/** Flags a payment an admin should look at, once per reference (security audit, 23 October 2026, issue 2). */
async function flagPayment(db: Db, reason: "unmatched_reference" | "amount_currency_or_domain_mismatch", tx: PaystackTx, organisationId: string | null, expected?: { amount: number; currency: string; domain: PaymentMode }) {
  const seen = await db.maybeOne(`SELECT 1 FROM platform_events WHERE type = 'PAYMENT_NEEDS_REVIEW' AND payload->>'reference' = $1 LIMIT 1`, [tx.reference]);
  if (seen) return;
  await emitEvent(db, "PAYMENT_NEEDS_REVIEW", { organisationId, reason, reference: tx.reference, status: tx.status, amount: tx.amount, currency: tx.currency, domain: tx.domain ?? null, expected: expected ?? null, paystackId: tx.id ?? null });
}

/**
 * The single place a payment outcome lands, from the callback or a webhook. Idempotent on the reference: a second
 * delivery of the same outcome changes nothing. A success activates the subscription for the interval paid.
 *
 * Security audit, 23 October 2026 (issues 2 and 10): only a reference Boredroom created (startCheckout's pending row)
 * can change a subscription, and the workspace, plan and interval come from that row, never from Paystack's metadata,
 * which whoever pays sets. A reference we never created is not recorded and is flagged for review if it was paid.
 * Paystack's amount (at least the price asked; more covers fees passed to the customer), currency and domain (the
 * current mode) must match the row, or nothing changes and the payment is flagged. Success and refunded are final.
 */
export async function recordPayment(db: Db, tx: PaystackTx, mode?: PaymentMode) {
  const currentMode = mode ?? (await paystackConfig()).mode;
  const status = tx.status === "success" ? "success" : tx.status === "abandoned" ? "abandoned" : "failed";
  const existing = await db.maybeOne<{ id: string; status: string; organisation_id: string | null; plan_id: string | null; interval: string | null; amount: number; currency: string }>(`SELECT id, status, organisation_id, plan_id, interval, amount, currency FROM payment_transactions WHERE reference = $1 FOR UPDATE`, [tx.reference]);
  if (!existing) {
    if (status === "success") await flagPayment(db, "unmatched_reference", tx, null);
    return { changed: false, status: "unmatched" as const, organisationId: null };
  }
  const orgId = existing.organisation_id;
  const planId = existing.plan_id;
  const interval = existing.interval ?? "monthly";
  if (FINAL_PAYMENT_STATES.has(existing.status) || existing.status === status) return { changed: false, status: existing.status, organisationId: orgId };
  if (tx.domain !== currentMode || typeof tx.amount !== "number" || tx.amount < existing.amount || String(tx.currency ?? "").toUpperCase() !== existing.currency.toUpperCase()) {
    await flagPayment(db, "amount_currency_or_domain_mismatch", tx, orgId, { amount: existing.amount, currency: existing.currency, domain: currentMode });
    return { changed: false, status: "mismatch" as const, organisationId: orgId };
  }
  await db.query(`UPDATE payment_transactions SET status = $2, channel = $3, gateway_response = $4, paid_at = $5, paystack_id = $6, raw = $7, customer_email = COALESCE(customer_email, $8), updated_at = now() WHERE id = $1`,
    [existing.id, status, tx.channel ?? null, tx.gateway_response ?? null, tx.paid_at ?? null, tx.id, JSON.stringify(tx), tx.customer?.email ?? null]);
  if (status === "success" && orgId && planId) {
    await db.query(
      `INSERT INTO subscriptions(organisation_id, plan_id, status, billing_interval, started_at, current_period_end, auto_renew, paystack_customer_code, paystack_authorization, last_payment_at, payment_status, updated_at)
       VALUES ($1, $2, 'active', $3, now(), now() + ($4 || ' months')::interval, true, $5, $6, now(), 'success', now())
       ON CONFLICT (organisation_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active', billing_interval = EXCLUDED.billing_interval,
         current_period_end = GREATEST(COALESCE(subscriptions.current_period_end, now()), now()) + ($4 || ' months')::interval,
         paystack_customer_code = COALESCE(EXCLUDED.paystack_customer_code, subscriptions.paystack_customer_code), paystack_authorization = COALESCE(EXCLUDED.paystack_authorization, subscriptions.paystack_authorization),
         last_payment_at = now(), payment_status = 'success', cancelled_at = NULL, updated_at = now()`,
      [orgId, planId, interval, interval === "annual" ? "12" : "1", tx.customer?.customer_code ?? null, tx.authorization ? JSON.stringify(tx.authorization) : null]);
    await db.query(`UPDATE payment_transactions SET subscription_id = (SELECT id FROM subscriptions WHERE organisation_id = $2) WHERE reference = $1`, [tx.reference, orgId]);
    await emitEvent(db, "PAYMENT_SUCCESSFUL", { organisationId: orgId, reference: tx.reference, amount: tx.amount, currency: tx.currency, planId, email: tx.customer?.email ?? null });
    const renewed = await db.maybeOne<{ name: string; end: string | null }>(`SELECT p.name, s.current_period_end::text AS "end" FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.organisation_id = $1`, [orgId]);
    await notifyBilling(db, orgId, { type: "billing.renewed", key: `billing.renewed:${tx.reference}`, title: `${renewed?.name ?? "Plan"} is paid up`, body: `${money(tx.amount, tx.currency)} received (${tx.reference}).${renewed?.end ? ` The plan runs until ${dateOnly(renewed.end)}.` : ""}` });
  } else if (status === "failed" && orgId) {
    await db.query(`UPDATE subscriptions SET payment_status = 'failed', status = CASE WHEN status = 'active' THEN 'payment_failed' ELSE status END, updated_at = now() WHERE organisation_id = $1`, [orgId]);
    await emitEvent(db, "PAYMENT_FAILED", { organisationId: orgId, reference: tx.reference, amount: tx.amount, currency: tx.currency, planId, email: tx.customer?.email ?? null, response: tx.gateway_response ?? null });
    await notifyBilling(db, orgId, { type: "billing.payment_failed", key: `billing.failed:${tx.reference}`, title: "A payment did not go through", body: `${money(tx.amount, tx.currency)} could not be taken${tx.gateway_response ? ` (${tx.gateway_response})` : ""}. Try again from Settings to keep the plan's modules.` });
  }
  return { changed: true, status, organisationId: orgId };
}

/** A webhook event, recorded once by its key, then applied. Unknown events are stored and ignored. */
export async function processPaystackEvent(event: { event: string; data: Record<string, unknown> }, raw: unknown) {
  const data = event.data as Partial<PaystackTx> & { subscription_code?: string; email_token?: string; customer?: { email?: string; customer_code?: string }; status?: string; subscription?: { subscription_code?: string } };
  const reference = (data.reference as string | undefined) ?? (data.subscription_code as string | undefined) ?? String((data as { id?: number }).id ?? "");
  const key = `${event.event}:${reference || "none"}`;
  const mode = (await paystackConfig()).mode;
  return withSystem(async (db) => {
    const inserted = await db.query<{ id: string }>(`INSERT INTO paystack_events(event_key, event, reference, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (event_key) DO NOTHING RETURNING id`, [key, event.event, reference || null, JSON.stringify(raw)]);
    if (inserted.length === 0) return { duplicate: true };
    const id = inserted[0].id;
    // An event from the other mode's domain is kept for the record but never applied (security audit, 23 October
    // 2026, issue 9). Charges must name the current domain (recordPayment); other events are refused when they name another.
    const domain = (data as { domain?: unknown }).domain;
    if (typeof domain === "string" && domain !== mode) {
      await db.query(`UPDATE paystack_events SET processed_at = now(), error = $2 WHERE id = $1`, [id, `Ignored: domain ${domain.slice(0, 20)} is not the current ${mode} mode.`]);
      return { duplicate: false };
    }
    try {
      switch (event.event) {
        case "charge.success": await recordPayment(db, data as PaystackTx, mode); break;
        case "invoice.payment_failed": case "charge.failed": await recordPayment(db, { ...(data as PaystackTx), status: "failed" }, mode); break;
        case "subscription.create": {
          // The workspace in metadata is only believed when its subscription already carries this Paystack customer,
          // which only a matched successful payment records (security audit, 23 October 2026, issue 2).
          const orgId = (data.metadata as { organisation_id?: string } | null)?.organisation_id ?? null;
          const customer = data.customer?.customer_code ?? null;
          if (orgId && customer) await db.query(`UPDATE subscriptions SET paystack_subscription_code = $2, paystack_email_token = $3, auto_renew = true, updated_at = now() WHERE organisation_id = $1 AND paystack_customer_code = $4`, [orgId, data.subscription_code ?? null, data.email_token ?? null, customer]);
          break;
        }
        case "subscription.disable": case "subscription.not_renew": {
          const code = data.subscription_code ?? data.subscription?.subscription_code ?? null;
          if (code) {
            const r = await db.query<{ organisation_id: string }>(`UPDATE subscriptions SET auto_renew = false, updated_at = now() WHERE paystack_subscription_code = $1 RETURNING organisation_id`, [code]);
            for (const s of r) await emitEvent(db, "SUBSCRIPTION_CANCELLED", { organisationId: s.organisation_id, source: "paystack" });
          }
          break;
        }
        case "refund.processed": {
          const ref = (data as { transaction_reference?: string }).transaction_reference ?? data.reference;
          if (ref) {
            const r = await db.query<{ organisation_id: string | null; interval: string | null }>(`UPDATE payment_transactions SET status = 'refunded', refunded_at = now(), updated_at = now() WHERE reference = $1 AND status = 'success' RETURNING organisation_id, interval`, [ref]);
            // The time the payment bought goes with it (security audit, 23 October 2026, verification V5).
            for (const t of r) await emitEvent(db, "PAYMENT_REFUNDED", { organisationId: t.organisation_id, reference: ref, source: "paystack", ...((await takeBackRefundedPeriod(db, t.organisation_id, t.interval)) ?? {}) });
          }
          break;
        }
        default: break;
      }
      await db.query(`UPDATE paystack_events SET processed_at = now() WHERE id = $1`, [id]);
    } catch (err) {
      await db.query(`UPDATE paystack_events SET error = $2 WHERE id = $1`, [id, (err as Error).message.slice(0, 500)]);
      throw err;
    }
    return { duplicate: false };
  });
}

/** What an organisation owner sees under Settings: the current plan, the period, the other plans. */
export async function orgBilling(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const sub = await db.maybeOne<{ plan_id: string; plan_name: string; plan_code: string; status: string; billing_interval: string; current_period_end: string | null; trial_ends_at: string | null; auto_renew: boolean; last_payment_at: string | null; payment_status: string | null; max_users: number | null; max_storage_bytes: number | null }>(
      `SELECT s.plan_id, p.name AS plan_name, p.code AS plan_code, s.status, s.billing_interval, s.current_period_end, s.trial_ends_at, s.auto_renew, s.last_payment_at, s.payment_status, p.max_users, p.max_storage_bytes FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.organisation_id = $1`, [ctx.org.id]);
    const plans = await db.query<{ id: string; code: string; name: string; description: string | null; currency: string; monthly_price: number; annual_price: number; max_users: number | null; max_storage_bytes: number | null; features: Record<string, boolean> }>(`SELECT id, code, name, description, currency, monthly_price, annual_price, max_users, max_storage_bytes, features FROM plans WHERE status = 'active' ORDER BY sort_order`);
    const payments = ctx.membership.role === "owner" || ctx.membership.role === "hr" ? await db.query<{ reference: string; amount: number; currency: string; status: string; paid_at: string | null; created_at: string }>(`SELECT reference, amount, currency, status, paid_at, created_at FROM payment_transactions WHERE organisation_id = $1 ORDER BY created_at DESC LIMIT 12`, [ctx.org.id]) : [];
    const users = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE organisation_id = $1 AND status = 'active'`, [ctx.org.id]);
    const pay = await paystackConfig();
    return { sub, plans, payments, users: users.n, paystack: !!pay.secretKey, mode: pay.mode };
  });
}

export function money(amountMinor: number, currency = "NGN") {
  const symbol: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "GH₵", KES: "KSh", ZAR: "R" };
  return `${symbol[currency] ?? `${currency} `}${(amountMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
