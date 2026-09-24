"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { money, bytes, dateOnly } from "@/lib/format";
import type { orgBilling } from "@/server/admin/billing";

type Data = Awaited<ReturnType<typeof orgBilling>>;

/** The organisation's plan, the other plans, and Paystack checkout. Free plans switch at once; paid ones go to Paystack. */
export function BillingCard({ orgSlug, data, notice }: { orgSlug: string; data: Data; notice?: string }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<"monthly" | "annual">((data.sub?.billing_interval as "monthly" | "annual") ?? "monthly");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (planId: string) => {
    setPending(planId); setError(null);
    try {
      const r = await api<{ free: boolean; url?: string }>(`/api/orgs/${orgSlug}/billing/checkout`, { method: "POST", body: { planId, interval: cycle }, retries: 0 });
      if (r.free) { router.refresh(); return; }
      if (r.url) window.location.assign(r.url);
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(null); }
  };
  const s = data.sub;
  return (
    <div className="space-y-4">
      {notice === "success" ? <Alert tone="success">Payment received. Thank you; the plan is active.</Alert> : notice === "failed" || notice === "abandoned" ? <Alert tone="warning">The payment did not go through. Nothing was charged; try again when you are ready.</Alert> : notice === "error" ? <Alert tone="danger">The payment could not be verified. If money left your account, reply to the receipt email and we will sort it out.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="chip flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div><p className="eyebrow">Current plan</p><p className="font-display text-xl">{s?.plan_name ?? "Free"} <Badge tone={s?.status === "active" ? "success" : s?.status === "trial" ? "info" : s ? "warning" : "neutral"}>{s?.status ?? "active"}</Badge></p>
          <p className="text-xs text-fg-subtle">{s?.current_period_end ? `${s.status === "trial" ? "Trial ends" : s.auto_renew ? "Renews" : "Ends"} ${dateOnly(s.current_period_end)}` : "No end date"}{s?.max_users ? ` · ${data.users} of ${s.max_users} people` : ` · ${data.users} people`}{s?.max_storage_bytes ? ` · ${bytes(s.max_storage_bytes)} storage` : ""}</p></div>
        <span role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-full border border-border bg-wash-soft p-0.5">{(["monthly", "annual"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={cycle === v} onClick={() => setCycle(v)} className={`rounded-full px-3 py-1 text-xs ${cycle === v ? "bg-wash-active text-fg" : "text-fg-muted"}`}>{v}</button>)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">{data.plans.map((p) => { const price = cycle === "annual" ? p.annual_price : p.monthly_price; const current = s?.plan_code === p.code; return (
        <div key={p.id} className={`tile p-4 ${current ? "border-accent/60" : ""}`}>
          <p className="font-semibold">{p.name}{current ? <Badge tone="accent" className="ml-2">current</Badge> : null}</p>
          <p className="mt-1 font-display text-2xl">{price ? money(price, p.currency) : "Free"}<span className="text-xs text-fg-subtle">{price ? ` / ${cycle === "annual" ? "year" : "month"}` : ""}</span></p>
          <p className="mt-1 text-xs text-fg-muted">{p.description}</p>
          <p className="eyebrow mt-2">{p.max_users ? `${p.max_users} people` : "unlimited people"} · {p.max_storage_bytes ? bytes(p.max_storage_bytes) : "unlimited storage"}</p>
          <ul className="mt-2 flex flex-wrap gap-1">{Object.entries(p.features).filter(([, v]) => v).map(([k]) => <li key={k} className="chip px-2 py-0.5 text-[11px]">{k.replace(/_/g, " ").toLowerCase()}</li>)}</ul>
          {!current ? <Button size="sm" className="mt-3 w-full" disabled={pending !== null || (price > 0 && !data.paystack)} onClick={() => void choose(p.id)}>{pending === p.id ? "Opening…" : price ? "Pay with Paystack" : "Switch to Free"}</Button> : null}
          {price > 0 && !data.paystack ? <p className="mt-2 text-[11px] text-fg-subtle">Payments are not enabled on this server yet.</p> : null}
        </div>
      ); })}</div>
      {data.payments.length ? <div><p className="eyebrow mb-2">Payments</p><ul className="divide-y divide-border-soft text-sm">{data.payments.map((p) => <li key={p.reference} className="flex items-center justify-between gap-3 py-1.5"><span className="font-mono text-xs">{p.reference}</span><span className="text-xs text-fg-subtle">{money(p.amount, p.currency)} · {p.status} · {dateOnly(p.paid_at ?? p.created_at)}</span></li>)}</ul></div> : null}
    </div>
  );
}
