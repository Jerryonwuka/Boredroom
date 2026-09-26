import type { Db } from "@/server/db";
import { featureFlags, featureEnabled, billingSettings } from "@/server/admin/settings";
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

type Row = { code: string; name: string; status: string; current_period_end: string | null; auto_renew: boolean; features: Record<string, boolean>; max_users: number | null; max_storage_bytes: number | null; feature_overrides: Record<string, boolean> | null; seats: number };

export async function resolveEntitlements(db: Db, orgId: string): Promise<Entitlements> {
  const [row, free, global, billing] = await Promise.all([
    db.maybeOne<Row>(
      `SELECT p.code, p.name, s.status, s.current_period_end, s.auto_renew, p.features, p.max_users, p.max_storage_bytes, o.feature_overrides,
              (SELECT count(*)::int FROM memberships m WHERE m.organisation_id = o.id AND m.status = 'active') AS seats
         FROM organisations o LEFT JOIN subscriptions s ON s.organisation_id = o.id LEFT JOIN plans p ON p.id = s.plan_id WHERE o.id = $1`, [orgId]),
    db.maybeOne<{ code: string; name: string; features: Record<string, boolean>; max_users: number | null; max_storage_bytes: number | null }>(`SELECT code, name, features, max_users, max_storage_bytes FROM plans WHERE code = 'free'`),
    featureFlags(), billingSettings(),
  ]);
  const end = row?.current_period_end ? new Date(row.current_period_end) : null;
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86_400_000) : null;
  const graceOver = daysLeft !== null && daysLeft < -(billing.grace_days ?? 0);
  const status = row?.status ?? "none";
  const lapsed = !!row?.code && (["expired", "cancelled", "suspended"].includes(status) || (["past_due", "payment_failed"].includes(status) && graceOver) || (status === "active" && graceOver && !!end));
  const plan = lapsed ? free : row?.code ? { code: row.code, name: row.name, features: row.features, max_users: row.max_users, max_storage_bytes: row.max_storage_bytes } : free;
  const org = row?.feature_overrides ?? {};
  const features: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_LABELS)) features[key] = featureEnabled(key, { global, plan: plan?.features ?? {}, org });
  const upgrade = await db.maybeOne<{ name: string }>(`SELECT name FROM plans WHERE status = 'active' AND monthly_price > (SELECT COALESCE(MAX(monthly_price), 0) FROM plans WHERE code = $1) ORDER BY monthly_price LIMIT 1`, [plan?.code ?? "free"]);
  return {
    plan: plan ? { code: plan.code, name: plan.name } : null, status, lapsed, currentPeriodEnd: row?.current_period_end ?? null, daysLeft, autoRenew: row?.auto_renew ?? false,
    features, maxUsers: plan?.max_users ?? null, maxStorageBytes: plan?.max_storage_bytes ?? null, seats: row?.seats ?? 0, upgradeTo: upgrade?.name ?? null,
  };
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
