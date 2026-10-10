/** Plan facts shared by the server and the browser: no database code lives here. */

export type PublicPlan = {
  code: string; name: string; description: string | null; currency: string; monthly_price: number; annual_price: number;
  max_users: number | null; max_storage_bytes: number | null; max_workspaces: number | null; trial_days: number; features: Record<string, boolean>;
};

/**
 * What a feature flag means to a buyer, in the order it is listed on the pricing cards and in the plan editor. Calls
 * have no flag: they are on every plan (owner decisions, 8 October 2026: phase 8, which also took out the two
 * screen-recording flags; migration 0055 strips them from the stored plans).
 */
export const FEATURE_LABELS: Record<string, string> = {
  HEARTBEAT_TRACKING: "Live presence and timers",
  EXPORT_REPORTS: "Report exports",
  ADVANCED_ANALYTICS: "Advanced analytics",
  AI_ASSISTANT: "AI assistant",
  VOICE_NOTES: "Voice notes in messages",
  GOOGLE_SIGN_IN: "Sign in with Google",
  CUSTOM_ROLES: "Custom roles",
  AUDIT_LOGS: "Audit logs",
  API_ACCESS: "API access",
};

/**
 * The features a plan is shown with, in FEATURE_LABELS' order: only flags this app still has (fix review, 10 October
 * 2026). A stored plan keeps VIDEO_RECORDING (and maybe SCREEN_CAPTURE) until migration 0055 strips them, and the in-app
 * billing card and the Control Center's plans listed it as "video recording".
 */
export function planFeatureKeys(features: Record<string, boolean> | null | undefined): string[] {
  const on = features ?? {};
  return Object.keys(FEATURE_LABELS).filter((k) => Object.hasOwn(on, k) && !!on[k]);
}
