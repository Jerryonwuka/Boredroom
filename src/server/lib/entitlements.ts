import type { Db } from "@/server/db";
import { featureEnabled, type BillingSettings, type FeatureFlags } from "@/server/admin/settings";
import { AppError } from "@/server/lib/errors";
import { FEATURE_LABELS } from "@/lib/plans";

/**
 * What a workspace is entitled to right now (owner decision, 25 September 2026: modules follow the plan).
 * A lapsed paid plan falls back to the Free plan's entitlements once its grace period is over, so a workspace never
 * loses its data, only the paid modules, until it renews.
 */
export type Entitlements = {
  plan: { code: string; name: string } | null;
  status: string;                       // active, trial, past_due, payment_failed, expired, cancelled, suspended, none
  lapsed: boolean;                      // paid modules withdrawn
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  autoRenew: boolean;
  features: Record<string, boolean>;
  maxUsers: number | null;
  maxStorageBytes: number | null;
  seats: number;
  upgradeTo: string | null;             // the cheapest plan that adds something
};

type PlanRow = { code: string; name: string; features: Record<string, boolean>; max_users: number | null; max_storage_bytes: number | null };

/**
 * Everything the entitlements are made of, read by ONE statement (review, 9 October 2026: the natural voice's latency on
 * a slow link): the workspace's plan and subscription, the Free plan, the plan to upgrade to from either (which one
 * applies is only known once the grace days are weighed), and the two platform settings they depend on. Before, that
 * was three queries one after another and two more transactions on their own connections for the settings (opened at
 * once, inside the caller's open transaction): five round trips and, on a cold pool, two new connections. The settings
 * are now read fresh with the rest instead of from the 15-second cache. `e_*` columns, so the statement can be joined
 * into a bigger one (orgContext's).
 */
export type EntitlementColumns = {
  e_code: string | null; e_name: string | null; e_status: string | null; e_period_end: string | null; e_auto_renew: boolean | null;
  e_features: Record<string, boolean> | null; e_max_users: number | null; e_max_storage: number | null; e_overrides: Record<string, boolean> | null; e_seats: number | null;
  e_free_code: string | null; e_free_name: string | null; e_free_features: Record<string, boolean> | null; e_free_max_users: number | null; e_free_max_storage: number | null;
  e_up_plan: string | null; e_up_free: string | null; e_settings: Record<string, unknown> | null;
};

/** The columns above for the organisation `orgId` (an SQL expression: a parameter, or a column of an earlier CTE); always one row. */
export function entitlementsSql(orgId: string): string {
  return `SELECT p.code AS e_code, p.name AS e_name, s.status AS e_status, s.current_period_end AS e_period_end, s.auto_renew AS e_auto_renew,
            p.features AS e_features, p.max_users AS e_max_users, p.max_storage_bytes AS e_max_storage, o.feature_overrides AS e_overrides,
            (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS e_seats,
            f.code AS e_free_code, f.name AS e_free_name, f.features AS e_free_features, f.max_users AS e_free_max_users, f.max_storage_bytes AS e_free_max_storage,
            (SELECT u.name FROM plans u WHERE u.status = 'active' AND u.monthly_price > (SELECT COALESCE(MAX(x.monthly_price), 0) FROM plans x WHERE x.code = p.code) ORDER BY u.monthly_price LIMIT 1) AS e_up_plan,
            (SELECT u.name FROM plans u WHERE u.status = 'active' AND u.monthly_price > (SELECT COALESCE(MAX(x.monthly_price), 0) FROM plans x WHERE x.code = 'free') ORDER BY u.monthly_price LIMIT 1) AS e_up_free,
            (SELECT jsonb_object_agg(ps.key, ps.value) FROM platform_settings ps WHERE ps.key IN ('feature_flags', 'billing')) AS e_settings
       FROM (SELECT 1) one
       LEFT JOIN organisations o ON o.id = ${orgId} LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id
       LEFT JOIN LATERAL (SELECT code, name, features, max_users, max_storage_bytes FROM plans WHERE code = 'free' LIMIT 1) f ON true
      LIMIT 1`;
}

/** The entitlements from those columns (as resolveEntitlements always worked them out). */
export function entitlementsOf(r: EntitlementColumns | null): Entitlements {
  const settings = r?.e_settings ?? {};
  const global = (settings.feature_flags as FeatureFlags | undefined) ?? {};
  const billing = (settings.billing as BillingSettings | undefined) ?? DEFAULT_BILLING;
  const row = r?.e_code ? r : null;
  const free: PlanRow | null = r?.e_free_code
    ? { code: r.e_free_code, name: r.e_free_name ?? "", features: r.e_free_features ?? {}, max_users: r.e_free_max_users, max_storage_bytes: r.e_free_max_storage }
    : null;
  const end = r?.e_period_end ? new Date(r.e_period_end) : null;
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86_400_000) : null;
  const graceOver = daysLeft !== null && daysLeft < -(billing.grace_days ?? 0);
  const status = r?.e_status ?? "none";
  const lapsed = !!row && (["expired", "cancelled", "suspended"].includes(status) || (["past_due", "payment_failed"].includes(status) && graceOver) || (status === "active" && graceOver && !!end));
  const plan: PlanRow | null = lapsed ? free : row ? { code: row.e_code!, name: row.e_name ?? "", features: row.e_features ?? {}, max_users: row.e_max_users, max_storage_bytes: row.e_max_storage } : free;
  const org = r?.e_overrides ?? {};
  const features: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_LABELS)) features[key] = featureEnabled(key, { global, plan: plan?.features ?? {}, org });
  // The plan to upgrade to from the plan in force: from the workspace's own plan, else from Free (lapsed, or none).
  const upgradeTo = plan && row && plan.code === row.e_code ? r?.e_up_plan ?? null : r?.e_up_free ?? null;
  return {
    plan: plan ? { code: plan.code, name: plan.name } : null, status, lapsed, currentPeriodEnd: r?.e_period_end ?? null, daysLeft, autoRenew: r?.e_auto_renew ?? false,
    features, maxUsers: plan?.max_users ?? null, maxStorageBytes: plan?.max_storage_bytes ?? null, seats: r?.e_seats ?? 0, upgradeTo,
  };
}

const DEFAULT_BILLING: BillingSettings = { trial_days: 14, grace_days: 3 };

export async function resolveEntitlements(db: Db, orgId: string): Promise<Entitlements> {
  return entitlementsOf(await db.one<EntitlementColumns>(entitlementsSql("$1::uuid"), [orgId]));
}

/** Refuses with a 402 that names the module and the plan that has it. */
export function requireFeature(e: Entitlements, key: string) {
  if (e.features[key]) return;
  const what = FEATURE_LABELS[key] ?? key.replace(/_/g, " ").toLowerCase();
  throw new AppError(402, "PLAN_REQUIRED", `${what} is not part of the ${e.plan?.name ?? "current"} plan.${e.upgradeTo ? ` Move this workspace to ${e.upgradeTo} to use it.` : ""}`, { details: { feature: key, plan: e.plan?.code ?? null, upgradeTo: e.upgradeTo } });
}

/** Refuses a new member when the plan's seats are full. */
export function requireSeat(e: Entitlements) {
  if (e.maxUsers !== null && e.seats >= e.maxUsers) {
    throw new AppError(402, "SEATS_FULL", `This workspace has all ${e.maxUsers} people its ${e.plan?.name ?? "current"} plan allows.${e.upgradeTo ? ` Move it to ${e.upgradeTo} to add more.` : ""}`, { details: { maxUsers: e.maxUsers, plan: e.plan?.code ?? null, upgradeTo: e.upgradeTo } });
  }
}
