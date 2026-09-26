import Link from "next/link";
import type { Entitlements } from "@/server/lib/entitlements";
import { dateOnly } from "@/lib/format";

/**
 * One line under the top of the page for the people who run the workspace: the plan is ending soon, a payment
 * failed, or the plan has lapsed. Quiet when everything is fine. Staff never see it.
 */
export function BillingBanner({ orgSlug, plan }: { orgSlug: string; plan: Entitlements }) {
  const href = `/app/${orgSlug}/settings?billing=1#billing`;
  let text: string | null = null; let tone: "warning" | "danger" = "warning";
  if (plan.lapsed) { text = `The paid plan has ended and this workspace is on Free. Renew to bring its modules back.`; tone = "danger"; }
  else if (plan.status === "payment_failed" || plan.status === "past_due") { text = `The last payment did not go through. Update the card or pay again before ${plan.currentPeriodEnd ? dateOnly(plan.currentPeriodEnd) : "the plan ends"}.`; tone = "danger"; }
  else if (plan.daysLeft !== null && plan.daysLeft <= 7 && plan.plan && plan.plan.code !== "free") { text = plan.autoRenew ? `${plan.plan.name} renews ${plan.daysLeft <= 0 ? "today" : plan.daysLeft === 1 ? "tomorrow" : `in ${plan.daysLeft} days`}.` : `${plan.plan.name} ends ${plan.daysLeft <= 0 ? "today" : plan.daysLeft === 1 ? "tomorrow" : `in ${plan.daysLeft} days`}. Renew to keep its modules.`; if (!plan.autoRenew) tone = "warning"; else return null; }
  if (!text) return null;
  return (
    <p className={tone === "danger" ? "border-b border-danger/40 bg-danger/10 px-4 py-2 text-center text-sm" : "border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-sm"}>
      {text} <Link href={href} className="font-semibold underline underline-offset-2">Plan and billing</Link>
    </p>
  );
}
