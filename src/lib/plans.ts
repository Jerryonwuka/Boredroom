/** Plan facts shared by the server and the browser: no database code lives here. */

export type PublicPlan = {
  code: string; name: string; description: string | null; currency: string; monthly_price: number; annual_price: number;
  max_users: number | null; max_storage_bytes: number | null; max_workspaces: number | null; trial_days: number; features: Record<string, boolean>;
};

/** What a feature flag means to a buyer, in the order it is listed on the pricing cards and in the plan editor. */
export const FEATURE_LABELS: Record<string, string> = {
  HEARTBEAT_TRACKING: "Live presence and timers",
  VIDEO_RECORDING: "Screen recording, with consent",
  SCREEN_CAPTURE: "Screen capture",
  EXPORT_REPORTS: "Report exports",
  ADVANCED_ANALYTICS: "Advanced analytics",
  AI_ASSISTANT: "AI assistant",
  VOICE_NOTES: "Voice notes in messages",
  GOOGLE_SIGN_IN: "Sign in with Google",
  CUSTOM_ROLES: "Custom roles",
  AUDIT_LOGS: "Audit logs",
  API_ACCESS: "API access",
};
