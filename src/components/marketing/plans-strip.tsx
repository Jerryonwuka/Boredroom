import Link from "next/link";
import { Check } from "lucide-react";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import { arrive } from "@/components/landing/parts";
import { landingPlans } from "@/components/marketing/plans";
import type { MarketingPath } from "@/lib/marketing/registry";
import type { PublicPlan } from "@/lib/plans";
import { cn } from "@/lib/utils";

function money(minor: number, currency: string) {
  const major = minor / 100;
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: major % 1 ? 2 : 0 }).format(major); }
  catch { return `${currency} ${major.toLocaleString("en-GB")}`; }
}
const count = (n: number | null, one: string, many: string) => (n === null ? `Unlimited ${many}` : `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`);
const storage = (bytes: number | null) => (bytes === null ? "Unlimited storage" : `${Math.round(bytes / 1024 ** 3)} GB of storage`);
const trial = (p: PublicPlan) => (p.monthly_price === 0 ? "No card needed" : p.trial_days > 0 ? `${p.trial_days}-day free trial` : null);

/**
 * The plans on a product page (owner feedback, 17 October 2026: pages v2; replaces PlansSummary's table there): the
 * live plans from the plans table (as /pricing's cards, so a price changed in the Control Center changes here too) as
 * compact r20 cards: name, monthly price per workspace ("Free" for the free plan), the three limits that matter
 * (workspaces, people per workspace, storage) and the trial line. Neutral: no featured card (that is /pricing's). One
 * link under the strip, in the page's own words. With no database it keeps the link.
 *
 *   <PlansStrip link={{ href: "/pricing", label: "See every plan in full" }} />
 */
export async function PlansStrip({ link, className }: { link: { href: MarketingPath; label: string }; className?: string }) {
  const plans = await landingPlans();
  const more = (
    <p className="mt-5">
      <Link href={link.href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 h-auto min-h-8 gap-1 py-1 text-sm text-foreground")}>
        {link.label}<AnimatedChevronRight aria-hidden className="shrink-0 text-secondary" />
      </Link>
    </p>
  );
  if (!plans.length) return <div className={className}><p className="lp-text">The plans could not be loaded just now.</p>{more}</div>;
  return (
    <div className={className}>
      <ul data-lp-arrive className={cn("grid gap-3", plans.length >= 3 ? "md:grid-cols-3" : plans.length === 2 ? "sm:grid-cols-2" : "")}>
        {plans.map((p, i) => {
          const t = trial(p);
          return (
            <li key={p.code} className="lp-item flex min-w-0 flex-col rounded-[20px] border border-border bg-fill-0 p-6" style={arrive(i)}>
              <p className="lp-h3">{p.name}</p>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-[32px] font-normal leading-9 tracking-[-0.02em] tabular-nums text-foreground">{p.monthly_price === 0 ? "Free" : money(p.monthly_price, p.currency)}</span>
                {p.monthly_price === 0 ? null : <span className="text-meta font-normal text-secondary">a month per workspace</span>}
              </p>
              <ul className="mt-5 space-y-2 text-sm text-secondary">
                {[count(p.max_workspaces, "workspace", "workspaces"), `${count(p.max_users, "person", "people")} per workspace`, storage(p.max_storage_bytes)].map((l) => (
                  <li key={l} className="flex items-start gap-2.5"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />{l}</li>
                ))}
              </ul>
              {t ? <p className="mt-auto pt-5 text-meta font-normal text-subtle">{t}</p> : null}
            </li>
          );
        })}
      </ul>
      {more}
    </div>
  );
}
