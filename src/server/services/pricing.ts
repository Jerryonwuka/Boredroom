import { withSystem } from "@/server/db";
import type { PublicPlan } from "@/lib/plans";

export type { PublicPlan } from "@/lib/plans";
export { FEATURE_LABELS } from "@/lib/plans";

/** The plans anyone may see: active ones, cheapest first. Read as the system because visitors have no session. */
export async function publicPlans() {
  return withSystem((db) => db.query<PublicPlan>(
    `SELECT code, name, description, currency, monthly_price, annual_price, max_users, max_storage_bytes, max_workspaces, trial_days, features
       FROM plans WHERE status = 'active' ORDER BY sort_order, monthly_price`));
}
