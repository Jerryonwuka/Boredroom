import { publicPlans } from "@/server/services/pricing";
import { FEATURE_LABELS, type PublicPlan } from "@/lib/plans";

/**
 * The live plans for a public page (owner request, 17 October 2026: SEO analysis: /pricing is a real page): the active
 * plans from the plans table, with only the flags the page can label (as on the home page: a stored plan may still carry
 * retired flags, and the pricing cards are a client component, so nothing else is sent to the browser). Never fails the
 * page: no database means no cards.
 */
export async function landingPlans(): Promise<PublicPlan[]> {
  const plans = await publicPlans().catch((): PublicPlan[] => []);
  return plans.map((p) => ({ ...p, features: Object.fromEntries(Object.entries(p.features ?? {}).filter(([k]) => Object.hasOwn(FEATURE_LABELS, k))) }));
}
