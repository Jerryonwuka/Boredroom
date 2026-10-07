"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Badge, label } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { SectionTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { api, isApiFailure } from "@/lib/api-client";
import { money, bytes, dateOnly } from "@/lib/format";
import { FEATURE_LABELS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import type { orgBilling } from "@/server/admin/billing";

type Data = Awaited<ReturnType<typeof orgBilling>>;

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = { active: "success", trial: "neutral", payment_failed: "danger", past_due: "danger" };

/**
 * Plan and billing, v4 (owner brief, 6 October 2026). The current plan first (its name as a figure, its state, and
 * three numbers: renewal, people, storage); then the plans as cards (r16) side by side with the monthly/annual switch,
 * the current one marked by a neutral badge; and the payments as a table. Orange is used once: on the upgrade, which
 * is the plan picked on the pricing page if there is one, else the next plan up. Free plans switch at once; paid ones
 * go to Paystack; moving from a paid plan to a free one asks first, because its modules switch off at once.
 */
export function BillingCard({ orgSlug, data, notice, preselect }: { orgSlug: string; data: Data; notice?: string; preselect?: string }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<"monthly" | "annual">((data.sub?.billing_interval as "monthly" | "annual") ?? "monthly");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switched, setSwitched] = useState<string | null>(null);
  const choose = async (planId: string, planName: string) => {
    setPending(planId); setError(null); setSwitched(null);
    try {
      const r = await api<{ free: boolean; url?: string }>(`/api/orgs/${orgSlug}/billing/checkout`, { method: "POST", body: { planId, interval: cycle }, retries: 0 });
      if (r.free) { setSwitched(`The workspace is now on ${planName}.`); router.refresh(); return; }
      if (r.url) { window.location.assign(r.url); return; }
      setError("Paystack did not return a checkout page. Nothing was charged; try again in a minute.");
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server. Nothing was charged; check your connection and try again."); }
    finally { setPending(null); }
  };
  const s = data.sub;
  const priceOf = (p: Data["plans"][number]) => (cycle === "annual" ? p.annual_price : p.monthly_price);
  const currentPlan = s ? data.plans.find((p) => p.code === s.plan_code) : undefined;
  const currentPrice = currentPlan ? priceOf(currentPlan) : 0;
  // Moving from a paid plan to a free one switches modules off at once, so it asks first.
  const onPaidPlan = !!currentPlan && (currentPlan.monthly_price > 0 || currentPlan.annual_price > 0);
  // The one orange button: the plan picked on the pricing page, else the first plan above the current one.
  const picked = data.plans.find((p) => p.code === preselect && p.code !== s?.plan_code);
  const standout = picked ?? data.plans.find((p) => p.code !== s?.plan_code && priceOf(p) > currentPrice);
  const renewal = s?.current_period_end ? (s.status === "trial" ? "Trial ends" : s.auto_renew ? "Renews" : "Ends") : null;
  const per = cycle === "annual" ? "year" : "month";
  return (
    <div className="space-y-10">
      {notice === "success" || notice === "failed" || notice === "abandoned" || notice === "error" || error || switched ? (
        <div className="space-y-3">
          {notice === "success" ? <Alert tone="success" title="Payment received">Thank you; the plan is active.</Alert> : notice === "failed" || notice === "abandoned" ? <Alert tone="warning" title="The payment did not go through">Nothing was charged; try again when you are ready.</Alert> : notice === "error" ? <Alert tone="danger" title="The payment could not be verified">If money left your account, reply to the receipt email and we will sort it out.</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {switched ? <Alert tone="success">{switched}</Alert> : null}
        </div>
      ) : null}

      {/* The current plan. */}
      <div className="card-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-secondary">Current plan{data.paystack && data.mode === "test" ? <Badge tone="warning">Test mode</Badge> : null}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2.5"><span className="type-stat">{s?.plan_name ?? "Free"}</span><Badge tone={s ? STATUS_TONE[s.status] ?? "warning" : "success"} dot>{label(s?.status ?? "active")}</Badge></p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <div className="min-w-0"><dt className="text-meta font-medium text-subtle">{renewal ?? "Renewal"}</dt><dd className="mt-0.5 text-sm font-medium text-foreground">{renewal && s?.current_period_end ? <time dateTime={s.current_period_end} suppressHydrationWarning>{dateOnly(s.current_period_end)}</time> : "No end date"}</dd></div>
          <div className="min-w-0"><dt className="text-meta font-medium text-subtle">People</dt><dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{s?.max_users ? <>{data.users} of {s.max_users}</> : data.users}</dd></div>
          <div className="min-w-0"><dt className="text-meta font-medium text-subtle">Storage</dt><dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{s?.max_storage_bytes ? bytes(s.max_storage_bytes) : "Unlimited"}</dd></div>
        </dl>
      </div>

      {/* The plans. */}
      <div>
        {/* "Paid plans are billed through Paystack" is a page note on Settings, Billing. */}
        <SectionTitle as="h3" title="Plans"
          action={<Segmented name="billing-interval" aria-label="Billing interval" value={cycle} onChange={(v) => setCycle(v as "monthly" | "annual")} options={[{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Annual" }]} />} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.plans.map((p) => {
          const price = priceOf(p);
          const current = s?.plan_code === p.code;
          const chosen = !current && preselect === p.code;
          const features = Object.entries(p.features).filter(([, v]) => v).map(([k]) => FEATURE_LABELS[k] ?? label(k.toLowerCase()));
          const cantPay = price > 0 && !data.paystack;
          const action = pending === p.id ? (price ? "Opening Paystack…" : "Switching…") : price ? (chosen ? `Continue with ${p.name}` : price > currentPrice ? `Upgrade to ${p.name}` : `Pay with Paystack`) : `Switch to ${p.name}`;
          return (
            <div key={p.id} className={cn("flex flex-col rounded-2xl border bg-background p-5", current ? "border-border-input-hover" : "border-border")}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{p.name}</h4>
                {current ? <Badge>Current plan</Badge> : chosen ? <Badge tone="accent">Your pick</Badge> : null}
              </div>
              <p className="mt-3 flex items-baseline gap-1">{price ? <><span className="type-stat">{money(price, p.currency)}</span><span className="text-meta font-normal text-secondary">/ {per}</span></> : <span className="type-stat">Free</span>}</p>
              {p.description ? <p className="mt-1 text-meta font-normal text-secondary">{p.description}</p> : null}
              <p className="mt-3 text-meta font-medium text-foreground"><span className="tabular-nums">{p.max_users ? `${p.max_users} people` : "Unlimited people"}</span>, <span className="tabular-nums">{p.max_storage_bytes ? `${bytes(p.max_storage_bytes)} storage` : "unlimited storage"}</span></p>
              {features.length ? (
                <ul aria-label={`Included in ${p.name}`} className="mt-3 space-y-1.5">
                  {features.map((f) => <li key={f} className="flex items-start gap-2 text-meta font-normal text-secondary"><Check className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden />{f}</li>)}
                </ul>
              ) : null}
              <div className="mt-auto pt-5">
                {current ? <p className="flex h-8 items-center text-meta font-normal text-secondary">You are on this plan.</p>
                  : price === 0 && onPaidPlan
                    ? <ConfirmButton size="md" variant="secondary" className="w-full" disabled={pending !== null} title={`Move to ${p.name} now?`} description="The paid plan ends at once and its modules pause. Everything they recorded is kept and comes back when you upgrade again." confirmLabel={`Move to ${p.name}`} pendingLabel="Switching…" onConfirm={() => choose(p.id, p.name)}>{action}</ConfirmButton>
                    : <Button size="md" variant={standout?.id === p.id ? "accent" : "secondary"} className="w-full" loading={pending === p.id} disabled={pending !== null || cantPay} onClick={() => void choose(p.id, p.name)}>{action}</Button>}
                {cantPay && !current ? <p className="mt-2 text-xs font-medium text-subtle">Payments are not switched on for this workspace yet. Ask the platform team.</p> : null}
              </div>
            </div>
          );
        })}</div>
      </div>

      {/* The payments. */}
      {data.payments.length ? (
        <div>
          <SectionTitle as="h3" title="Payments" />
          <DataTable caption="Payments">
            <thead><tr><th>Reference</th><th className="text-right">Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>{data.payments.map((p) => (
              <tr key={p.reference}>
                <td><span className="font-mono text-xs text-secondary">{p.reference}</span></td>
                <td className="text-right tabular-nums">{money(p.amount, p.currency)}</td>
                <td><Badge tone={p.status === "success" ? "success" : p.status === "failed" ? "danger" : "neutral"} dot>{label(p.status)}</Badge></td>
                <td><time dateTime={p.paid_at ?? p.created_at} suppressHydrationWarning>{dateOnly(p.paid_at ?? p.created_at)}</time></td>
              </tr>
            ))}</tbody>
          </DataTable>
        </div>
      ) : null}
    </div>
  );
}
