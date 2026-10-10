import { describe, expect, it } from "vitest";
import { FEATURE_LABELS, planFeatureKeys } from "@/lib/plans";
import { FEATURE_KEYS } from "@/server/admin/settings";

// What a plan is shown with in Settings, Billing and on the Control Center's plans (fix review, 10 October 2026): only
// the flags this app still has, in FEATURE_LABELS' order. The stored Pro and Enterprise plans keep VIDEO_RECORDING until
// migration 0055 strips it (owner decisions, 8 October 2026: phase 8), and both lists showed it as "video recording".
// Pure.

describe("planFeatureKeys", () => {
  it("leaves out the screen-recording flags a stored plan still has", () => {
    // The Pro and Enterprise plans as migration 0021 seeded them.
    const pro = { HEARTBEAT_TRACKING: true, EXPORT_REPORTS: true, VIDEO_RECORDING: true, ADVANCED_ANALYTICS: false };
    const enterprise = { HEARTBEAT_TRACKING: true, EXPORT_REPORTS: true, VIDEO_RECORDING: true, ADVANCED_ANALYTICS: true, AUDIT_LOGS: true, API_ACCESS: true };
    expect(planFeatureKeys(pro)).toEqual(["HEARTBEAT_TRACKING", "EXPORT_REPORTS"]);
    expect(planFeatureKeys(enterprise)).toEqual(["HEARTBEAT_TRACKING", "EXPORT_REPORTS", "ADVANCED_ANALYTICS", "AUDIT_LOGS", "API_ACCESS"]);
    expect(planFeatureKeys({ SCREEN_CAPTURE: true, VIDEO_RECORDING: true })).toEqual([]);
    for (const k of planFeatureKeys(enterprise)) expect(FEATURE_LABELS[k]).toBeTruthy();
  });

  it("lists what is on, in the pricing cards' order, and nothing else", () => {
    expect(planFeatureKeys({ API_ACCESS: true, AI_ASSISTANT: true, VOICE_NOTES: false, HEARTBEAT_TRACKING: true })).toEqual(["HEARTBEAT_TRACKING", "AI_ASSISTANT", "API_ACCESS"]);
    expect(planFeatureKeys(JSON.parse('{"__proto__": true, "constructor": true, "toString": true}'))).toEqual([]);
    expect(planFeatureKeys(null)).toEqual([]);
    expect(planFeatureKeys(undefined)).toEqual([]);
  });

  it("knows every flag the Control Center's plan editor can switch on", () => {
    expect(planFeatureKeys(Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]))).sort()).toEqual([...FEATURE_KEYS].sort());
  });
});
