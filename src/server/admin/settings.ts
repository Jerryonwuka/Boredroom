/**
 * Platform settings: the launch mode, feature flags, general and billing settings, landing copy. Stored as JSON rows
 * in platform_settings and cached briefly in memory, so public pages can read the launch mode without a query per hit.
 */
import { withSystem, type Db } from "@/server/db";
import { adminAudit, type Admin } from "@/server/admin/auth";

export type LaunchMode = "waitlist" | "live" | "maintenance";
export type LaunchSettings = { mode: LaunchMode; waitlist_open: boolean; app_access: boolean; message?: string };
export type GeneralSettings = { platform_name: string; support_email: string; currency: string };
export type LandingSettings = { headline: string; subheadline: string; cta: string };
export type BillingSettings = { trial_days: number; grace_days: number };
export type FeatureFlags = Record<string, boolean>;

export const FEATURE_KEYS = ["VIDEO_RECORDING", "HEARTBEAT_TRACKING", "ADVANCED_ANALYTICS", "SCREEN_CAPTURE", "API_ACCESS", "CUSTOM_ROLES", "AUDIT_LOGS", "EXPORT_REPORTS", "AI_ASSISTANT", "VOICE_NOTES", "GOOGLE_SIGN_IN"] as const;

type Cache = { at: number; values: Record<string, unknown> };
let cache: Cache | null = null;
const TTL = 15_000;

async function loadAll(db: Db) {
  const rows = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings`);
  const values: Record<string, unknown> = {};
  for (const r of rows) values[r.key] = r.value;
  return values;
}

export async function allSettings(fresh = false): Promise<Record<string, unknown>> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.values;
  const values = await withSystem(loadAll);
  cache = { at: Date.now(), values };
  return values;
}

export async function getSetting<T>(key: string, fallback: T, fresh = false): Promise<T> {
  const all = await allSettings(fresh);
  return (all[key] as T | undefined) ?? fallback;
}

export const launchSettings = (fresh = false) => getSetting<LaunchSettings>("launch", { mode: "live", waitlist_open: true, app_access: true }, fresh);
export const generalSettings = () => getSetting<GeneralSettings>("general", { platform_name: "Boredroom", support_email: "", currency: "NGN" });
export const landingSettings = () => getSetting<LandingSettings>("landing", { headline: "", subheadline: "", cta: "" });
export const billingSettings = () => getSetting<BillingSettings>("billing", { trial_days: 14, grace_days: 3 });
export const featureFlags = () => getSetting<FeatureFlags>("feature_flags", {});

/** Whether new organisations and accounts may be created right now. */
export async function registrationOpen(): Promise<boolean> {
  const l = await launchSettings();
  return l.mode === "live";
}

export async function setSetting(admin: Admin, key: string, value: unknown, reason?: string | null) {
  await withSystem(async (db) => {
    const before = await db.maybeOne<{ value: unknown }>(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
    await db.query(`INSERT INTO platform_settings(key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [key, JSON.stringify(value), admin.user.authUserId]);
    await adminAudit(db, admin, { action: `settings.${key}.updated`, targetType: "settings", targetId: key, before: before?.value ?? null, after: value, reason });
  });
  cache = null;
}

/** A feature for an organisation: organisation override, else the plan's entitlement, else the global flag. */
export function featureEnabled(key: string, opts: { global: FeatureFlags; plan: Record<string, boolean>; org: Record<string, boolean> }): boolean {
  if (key in opts.org) return !!opts.org[key];
  if (key in opts.plan) return !!opts.plan[key];
  if (key in opts.global) return !!opts.global[key];
  return true;
}
