"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURE_LABELS, type PublicPlan } from "@/lib/plans";
import { WaitlistLink } from "@/components/landing/waitlist-link";

function money(minor: number, currency: string) {
  const major = minor / 100;
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: major % 1 ? 2 : 0 }).format(major); }
  catch { return `${currency} ${major.toLocaleString()}`; }
}
const gb = (bytes: number) => `${Math.round(bytes / 1024 / 1024 / 1024)} GB`;

/**
 * The pricing cards (owner decision, 25 September 2026): every active plan, the middle one lit as the usual choice,
 * a monthly/yearly switch, and the limits that matter first: workspaces, people, storage. The flags a plan turns
 * on are listed with a tick; the ones it does not are shown struck through so the difference is visible at a glance.
 */
export function Pricing({ plans, waitlist, signedIn }: { plans: PublicPlan[]; waitlist: boolean; signedIn: boolean }) {
  const [yearly, setYearly] = useState(false);
  const featured = plans.length >= 2 ? plans[Math.min(1, plans.length - 1)].code : plans[0]?.code;
  const keys = Object.keys(FEATURE_LABELS).filter((k) => plans.some((p) => k in p.features));
  if (plans.length === 0) return null;
  return (
    <div>
      <div className="mx-auto mb-10 flex w-fit items-center gap-1 lp-glass rounded-full p-1 text-sm" role="radiogroup" aria-label="Billing period">
        {(["monthly", "yearly"] as const).map((v) => { const on = yearly === (v === "yearly"); return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => setYearly(v === "yearly")} className={cn("rounded-full px-4 py-1.5 font-medium transition-colors duration-150", on ? "bg-fg text-bg" : "lp-muted hover:text-fg")}>
            {v === "monthly" ? "Monthly" : <>Yearly <span className={cn("ml-1 text-xs", on ? "opacity-70" : "text-accent")}>2 months free</span></>}
          </button>
        ); })}
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((p) => {
          const hot = p.code === featured;
          const price = yearly ? p.annual_price / 12 : p.monthly_price;
          const free = p.monthly_price === 0 && p.annual_price === 0;
          const cta = signedIn ? { href: `/app/billing?plan=${p.code}`, label: free ? "Use Free" : `Choose ${p.name}` } : waitlist ? null : { href: `/signup?intent=org&plan=${p.code}`, label: free ? "Start for free" : p.max_workspaces === null ? "Talk to us" : `Start with ${p.name}` };
          return (
            <div key={p.code} className={cn("relative flex flex-col rounded-[24px] border p-7", hot ? "lp-card border-accent/60 shadow-[0_0_80px_-30px_var(--accent)]" : "lp-glass lp-line")}>
              {hot ? <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg">Most teams choose this</span> : null}
              <p className="font-display text-2xl">{p.name}</p>
              {p.description ? <p className="lp-muted mt-1 text-sm">{p.description}</p> : null}
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-display text-[44px] leading-none tracking-[-0.02em] tabular-nums">{free ? "Free" : money(price, p.currency)}</span>
                {!free ? <span className="lp-faint text-sm">/ month{yearly ? ", billed yearly" : ""}</span> : null}
              </p>
              {!free && yearly ? <p className="lp-faint mt-1 text-xs">{money(p.annual_price, p.currency)} a year</p> : !free && p.trial_days ? <p className="mt-1 text-xs text-accent">{p.trial_days}-day free trial</p> : <p className="lp-faint mt-1 text-xs">{free ? "No card needed" : " "}</p>}
              <ul className="mt-6 flex-1 space-y-2 border-t lp-line-soft pt-5 text-sm">
                <li className="flex items-center gap-2"><Check className="size-4 shrink-0 text-accent" aria-hidden /><span><strong className="font-semibold">{p.max_workspaces === null ? "Unlimited" : p.max_workspaces}</strong> workspace{p.max_workspaces === 1 ? "" : "s"}</span></li>
                <li className="flex items-center gap-2"><Check className="size-4 shrink-0 text-accent" aria-hidden /><span><strong className="font-semibold">{p.max_users === null ? "Unlimited" : p.max_users}</strong> people per workspace</span></li>
                <li className="flex items-center gap-2"><Check className="size-4 shrink-0 text-accent" aria-hidden /><span><strong className="font-semibold">{p.max_storage_bytes === null ? "Unlimited" : gb(p.max_storage_bytes)}</strong> recording storage</span></li>
                {keys.map((k) => { const on = !!p.features[k]; return (
                  <li key={k} className={cn("flex items-center gap-2", !on && "lp-faint")}>{on ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : <Minus className="size-4 shrink-0" aria-hidden />}<span className={cn(!on && "line-through decoration-[var(--lp-faint)]")}>{FEATURE_LABELS[k]}</span></li>
                ); })}
              </ul>
              <div className="mt-8 pt-2">
                {cta ? <Link href={cta.href} className={cn("lp-btn w-full", hot ? "lp-btn-primary" : "lp-btn-secondary")}>{cta.label}</Link>
                  : <WaitlistLink className={cn("lp-btn w-full", hot ? "lp-btn-primary" : "lp-btn-secondary")}>Join the waitlist</WaitlistLink>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="lp-faint mx-auto mt-8 max-w-2xl text-center text-sm">Prices are per workspace. A person may own one workspace on Free, five on Pro and as many as they need on Enterprise; joining someone else&apos;s workspace is always free.</p>
    </div>
  );
}
