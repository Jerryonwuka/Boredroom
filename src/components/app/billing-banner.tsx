import Link from "next/link";
import type { Entitlements } from "@/server/lib/entitlements";
import { dateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";

type StripTone = "warning" | "danger";
const BOX: Record<StripTone, string> = {
  warning: "border-warning/20 bg-[color-mix(in_srgb,var(--warning)_6%,var(--background))]",
  danger: "border-danger/25 bg-[color-mix(in_srgb,var(--danger)_7%,var(--background))]",
};
const DOT: Record<StripTone, string> = {
  warning: "bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_15%,transparent)]",
  danger: "bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_15%,transparent)]",
};

/**
 * A calm full-width strip above the app (v4): one line of 13px text on a solid fill with the faintest wash of its
 * tone, a hairline under it, a status dot with a soft halo, and at most one action at the end. Solid, because the
 * strips stay pinned while the page scrolls under them. Shared by the billing, impersonation and maintenance notices.
 */
export function ShellStrip({ tone = "warning", children, action, role }: { tone?: StripTone; children: React.ReactNode; action?: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className={cn("flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b px-5 py-2 text-meta font-normal text-foreground", BOX[tone])}>
      <p className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[tone])} />
        <span className="min-w-0">{children}</span>
      </p>
      {action}
    </div>
  );
}

/** The link at the end of a strip's sentence. */
export const STRIP_LINK = "font-medium text-foreground underline decoration-border-input-hover underline-offset-4 transition-colors duration-75 hover:decoration-foreground";

/**
 * One line at the top of the page for the people who run the workspace: the plan is ending soon, a payment failed,
 * or the plan has lapsed. Quiet when everything is fine. Staff never see it.
 */
export function BillingBanner({ orgSlug, plan }: { orgSlug: string; plan: Entitlements }) {
  const href = `/app/${orgSlug}/settings?billing=1#billing`;
  let text: string | null = null; let tone: StripTone = "warning";
  if (plan.lapsed) { text = `The paid plan has ended and this workspace is on Free. Renew to bring its modules back.`; tone = "danger"; }
  else if (plan.status === "payment_failed" || plan.status === "past_due") { text = `The last payment did not go through. Update the card or pay again before ${plan.currentPeriodEnd ? dateOnly(plan.currentPeriodEnd) : "the plan ends"}.`; tone = "danger"; }
  else if (plan.daysLeft !== null && plan.daysLeft <= 7 && plan.plan && plan.plan.code !== "free") { text = plan.autoRenew ? `${plan.plan.name} renews ${plan.daysLeft <= 0 ? "today" : plan.daysLeft === 1 ? "tomorrow" : `in ${plan.daysLeft} days`}.` : `${plan.plan.name} ends ${plan.daysLeft <= 0 ? "today" : plan.daysLeft === 1 ? "tomorrow" : `in ${plan.daysLeft} days`}. Renew to keep its modules.`; if (!plan.autoRenew) tone = "warning"; else return null; }
  if (!text) return null;
  return (
    <ShellStrip tone={tone}>
      {text} <Link href={href} className={STRIP_LINK}>Plan and billing</Link>
    </ShellStrip>
  );
}
