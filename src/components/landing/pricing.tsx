"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURE_LABELS, type PublicPlan } from "@/lib/plans";
import { WaitlistLink } from "@/components/landing/waitlist-link";
import { Segmented } from "@/components/ui/segmented";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CONTACT_EMAIL, arrive } from "@/components/landing/parts";

function money(minor: number, currency: string) {
  const major = minor / 100;
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: major % 1 ? 2 : 0 }).format(major); }
  catch { return `${currency} ${major.toLocaleString()}`; }
}
const gb = (bytes: number) => `${Math.round(bytes / 1024 / 1024 / 1024)} GB`;

/**
 * Flags a plan may carry that the product does not offer yet (owner request, 10 October 2026): hidden on the landing
 * page only, so it promises nothing unbuilt. The app and lib/plans.ts still list them; app-wide is the owner's call.
 */
const NOT_BUILT = new Set(["ADVANCED_ANALYTICS", "CUSTOM_ROLES", "API_ACCESS"]);

/**
 * A stored description that promises something unbuilt (the seeded Enterprise one says "advanced analytics, priority
 * support") is replaced on the landing page by one made from the plan's limits (review fix, 10 October 2026). The owner
 * can rewrite the stored one in the Control Center; nothing here writes to the database.
 */
const UNBUILT_WORDS = /advanced analytics|priority support|custom roles|api access/i;
function honestDescription(p: PublicPlan): string {
  if (p.description && !UNBUILT_WORDS.test(p.description)) return p.description;
  const unlimited = [p.max_workspaces === null && "workspaces", p.max_users === null && "people", p.max_storage_bytes === null && "storage"].filter(Boolean) as string[];
  if (unlimited.length === 0) return "";
  const list = unlimited.length === 1 ? unlimited[0] : `${unlimited.slice(0, -1).join(", ")} and ${unlimited[unlimited.length - 1]}`;
  return `For larger organisations: unlimited ${list}.`;
}

/**
 * The pricing cards (owner decision, 25 September 2026), v4: every active plan as a plan card (r20, a hairline, 24px
 * in), the middle one featured (a stronger hairline on fill-0 and the white primary button; the others outline; its
 * "Most teams choose this" tag is gone, an implied statistic in a pilot, owner request 10 October 2026), a Monthly/Yearly segmented control (the chosen option's
 * orange dot), and the limits that matter first: workspaces, people, storage. The flags a plan turns on carry a tick;
 * the ones it does not are struck through in grey so the difference is visible at a glance.
 */
export function Pricing({ plans, waitlist, maintenance = false, signedIn }: { plans: PublicPlan[]; waitlist: boolean; maintenance?: boolean; signedIn: boolean }) {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const yearly = period === "yearly";
  const featured = plans.length >= 2 ? plans[Math.min(1, plans.length - 1)].code : plans[0]?.code;
  const keys = Object.keys(FEATURE_LABELS).filter((k) => !NOT_BUILT.has(k) && plans.some((p) => k in p.features));
  if (plans.length === 0) return null;
  return (
    <div>
      <div className="flex justify-center">
        <Segmented name="billing-period" aria-label="Billing period" value={period} onChange={(v) => setPeriod(v === "yearly" ? "yearly" : "monthly")}
          options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: <>Yearly <Badge tone="accent" size="sm">2 months free</Badge></> }]} />
      </div>
      {/* The plans arrive side by side, once (owner request, 10 October 2026: arrival.tsx). */}
      <div data-lp-arrive className="mt-10 grid gap-3 md:grid-cols-3">
        {plans.map((p, i) => {
          const hot = p.code === featured;
          const price = yearly ? p.annual_price / 12 : p.monthly_price;
          const free = p.monthly_price === 0 && p.annual_price === 0;
          // "Talk to us" is a conversation, so it opens an email (review fix, 10 October 2026); in maintenance sign-ups are off.
          const cta = signedIn ? { href: `/app/billing?plan=${p.code}`, label: free ? "Use Free" : `Choose ${p.name}` }
            : !waitlist && p.max_workspaces === null && !free ? { href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Boredroom ${p.name}`)}`, label: "Talk to us" }
            : waitlist || maintenance ? null
            : { href: `/signup?intent=org&plan=${p.code}`, label: free ? "Start for free" : `Start with ${p.name}` };
          const button = cn(buttonVariants({ variant: hot ? "primary" : "secondary", size: "lg" }), "w-full");
          return (
            <div key={p.code} style={arrive(i * 1.5)} className={cn("lp-item flex min-w-0 flex-col rounded-[20px] border p-6", hot ? "border-border-input-hover bg-fill-0 shadow-chart" : "border-border bg-background")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="lp-h3">{p.name}</p>
              </div>
              {/* Two lines kept from md up, so the prices and lists line up across the cards (review fix, 10 October 2026). */}
              <p className="mt-1 text-sm font-normal text-secondary md:min-h-10">{honestDescription(p)}</p>
              <p className="mt-6 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span className="font-display text-[40px] leading-none tracking-[-0.02em] tabular-nums text-foreground">{free ? "Free" : money(price, p.currency)}</span>
                {!free ? <span className="text-sm font-normal text-secondary">/ month{yearly ? ", billed yearly" : ""}</span> : null}
              </p>
              <p className="mt-2 min-h-4 text-xs font-normal text-secondary">
                {!free && yearly ? `${money(p.annual_price, p.currency)} a year` : !free && p.trial_days ? `${p.trial_days}-day free trial` : free ? "No card needed" : ""}
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 border-t border-border pt-5 text-sm font-normal text-foreground">
                <li className="flex items-center gap-2.5"><Check className="size-4 shrink-0" aria-hidden /><span><strong className="font-semibold">{p.max_workspaces === null ? "Unlimited" : p.max_workspaces}</strong> workspace{p.max_workspaces === 1 ? "" : "s"}</span></li>
                <li className="flex items-center gap-2.5"><Check className="size-4 shrink-0" aria-hidden /><span><strong className="font-semibold">{p.max_users === null ? "Unlimited" : p.max_users}</strong> people per workspace</span></li>
                <li className="flex items-center gap-2.5"><Check className="size-4 shrink-0" aria-hidden /><span><strong className="font-semibold">{p.max_storage_bytes === null ? "Unlimited" : gb(p.max_storage_bytes)}</strong> file storage</span></li>
                {keys.map((k) => { const on = !!p.features[k]; return (
                  <li key={k} className={cn("flex items-center gap-2.5", !on && "text-subtle")}>
                    {on ? <Check className="size-4 shrink-0" aria-hidden /> : <Minus className="size-4 shrink-0" aria-hidden />}
                    <span className={cn(!on && "line-through decoration-subtle")}>{FEATURE_LABELS[k]}{on ? null : <span className="sr-only"> (not included)</span>}</span>
                  </li>
                ); })}
              </ul>
              <div className="mt-8">
                {cta ? (cta.href.startsWith("mailto:") ? <a href={cta.href} className={button}>{cta.label}</a> : <Link href={cta.href} className={button}>{cta.label}</Link>)
                  : maintenance ? <p className="flex h-10 items-center justify-center text-sm font-normal text-secondary">New sign-ups are paused</p>
                  : <WaitlistLink className={button}>Join the waitlist</WaitlistLink>}
              </div>
            </div>
          );
        })}
      </div>
      {/* Calls are on every plan (owner decisions, 8 October 2026: phase 8); they have no flag, so they are said here. */}
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm font-normal text-secondary">Calls, with screen sharing, are on every plan. Brenda&apos;s notes on calls come with the AI assistant.</p>
      <p className="mx-auto mt-2 max-w-2xl text-center text-sm font-normal text-secondary">Prices are per workspace. A person may own one workspace on Free, five on Pro and as many as they need on Enterprise; joining someone else&apos;s workspace is always free.</p>
    </div>
  );
}
