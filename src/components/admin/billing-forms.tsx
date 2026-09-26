"use client";

import { useState } from "react";
import { JsonForm } from "@/components/admin/actions";
import { InputAdorned } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { FEATURE_LABELS } from "@/lib/plans";
import { inputCls } from "@/components/admin/fields";
import type { PlanRow } from "@/server/admin/billing";
import { DatePicker } from "@/components/ui/date-picker";

const STATUS = [{ value: "active", label: "Active", tone: "success" as const }, { value: "hidden", label: "Hidden", tone: "warning" as const }, { value: "archived", label: "Archived", tone: "danger" as const }];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border border-border-soft bg-wash-soft p-4">
      <div className="mb-3"><p className="eyebrow">{title}</p>{hint ? <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p> : null}</div>
      {children}
    </section>
  );
}

/** Create or edit a plan. Prices are typed in major units and stored in minor units; blank limits mean unlimited. */
export function PlanForm({ plan, featureKeys }: { plan?: PlanRow; featureKeys: readonly string[] }) {
  const [currency, setCurrency] = useState(plan?.currency ?? "NGN");
  const gb = plan?.max_storage_bytes ? Math.round(plan.max_storage_bytes / 1024 / 1024 / 1024) : "";
  return (
    <JsonForm path="/api/admin/plans" transform={(d) => ({
      id: plan?.id ?? null, code: String(d.code), name: String(d.name), description: String(d.description ?? "") || null, currency: String(d.currency).toUpperCase(),
      monthlyPrice: Math.round(Number(d.monthly) * 100), annualPrice: Math.round(Number(d.annual) * 100),
      maxUsers: d.maxUsers ? Number(d.maxUsers) : null, maxStorageGb: d.maxStorageGb ? Number(d.maxStorageGb) : null, maxWorkspaces: d.maxWorkspaces ? Number(d.maxWorkspaces) : null, trialDays: Number(d.trialDays ?? 0),
      features: Object.fromEntries(featureKeys.map((k) => [k, d[`f_${k}`] === "on"])), status: String(d.status), sortOrder: Number(d.sortOrder ?? 0),
    })} submitLabel={plan ? "Save plan" : "Create plan"}>
      <Section title="Identity" hint="The name is what buyers see; the code is what the system and Paystack use.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Name</span><input name="name" defaultValue={plan?.name ?? ""} className="field" required placeholder="Pro" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Code</span><InputAdorned prefix="plan /" name="code" defaultValue={plan?.code ?? ""} pattern="[a-z0-9\-]{2,40}" required placeholder="pro" className="font-mono" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted sm:col-span-2"><span>One line for the pricing page</span><textarea name="description" defaultValue={plan?.description ?? ""} rows={2} className="field" placeholder="Everything a remote team needs, recordings included." /></label>
        </div>
      </Section>
      <Section title="Price" hint="Typed in major units. Yearly is charged once; the pricing page shows it per month.">
        <div className="grid gap-3 sm:grid-cols-[96px_1fr_1fr]">
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Currency</span><input name="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} className="field font-mono uppercase" required /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Monthly</span><InputAdorned prefix={currency || "NGN"} suffix="/ mo" name="monthly" type="number" min={0} step="0.01" defaultValue={(plan?.monthly_price ?? 0) / 100} required /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Yearly</span><InputAdorned prefix={currency || "NGN"} suffix="/ yr" name="annual" type="number" min={0} step="0.01" defaultValue={(plan?.annual_price ?? 0) / 100} required /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted sm:col-span-3"><span>Free trial</span><InputAdorned suffix="days" name="trialDays" type="number" min={0} max={365} defaultValue={plan?.trial_days ?? 0} className="sm:w-40" /></label>
        </div>
      </Section>
      <Section title="Limits" hint="Leave a limit blank for unlimited.">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Workspaces</span><InputAdorned suffix="owned" name="maxWorkspaces" type="number" min={1} defaultValue={plan?.max_workspaces ?? ""} placeholder="∞" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>People</span><InputAdorned suffix="each" name="maxUsers" type="number" min={1} defaultValue={plan?.max_users ?? ""} placeholder="∞" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Storage</span><InputAdorned suffix="GB" name="maxStorageGb" type="number" min={0.1} step="0.1" defaultValue={gb} placeholder="∞" /></label>
        </div>
      </Section>
      <Section title="Features" hint="What this plan switches on.">
        <div className="-mx-1 grid gap-0.5 sm:grid-cols-2">
          {featureKeys.map((k) => <Switch key={k} name={`f_${k}`} defaultChecked={!!plan?.features?.[k]} hint={<span className="font-mono">{k}</span>}>{FEATURE_LABELS[k] ?? k.replace(/_/g, " ").toLowerCase()}</Switch>)}
        </div>
      </Section>
      <Section title="Visibility">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Segmented name="status" aria-label="Plan status" options={STATUS} defaultValue={plan?.status ?? "active"} />
          <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Order on the page</span><input name="sortOrder" type="number" defaultValue={plan?.sort_order ?? 0} className="field w-28" /></label>
        </div>
      </Section>
    </JsonForm>
  );
}

export function SubscriptionEditForm({ id, current }: { id: string; current: { status: string; periodEnd: string | null; autoRenew: boolean; notes: string | null } }) {
  return (
    <JsonForm path={`/api/admin/subscriptions/${id}`} method="PATCH" transform={(d) => ({ status: d.status ? String(d.status) : undefined, periodEnd: d.periodEnd === "" ? undefined : new Date(String(d.periodEnd)).toISOString(), autoRenew: d.autoRenew === "on", notes: String(d.notes ?? "") || null, reason: String(d.reason) })} submitLabel="Update subscription">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Status</span><select name="status" defaultValue={current.status} className={inputCls}>{["trial", "active", "payment_failed", "past_due", "cancelled", "expired", "suspended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Period end</span><DatePicker name="periodEnd" defaultValue={current.periodEnd ? current.periodEnd.slice(0, 10) : ""} size="sm" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="autoRenew" defaultChecked={current.autoRenew} />Auto-renew</label>
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted sm:col-span-2"><span>Notes</span><input name="notes" defaultValue={current.notes ?? ""} /></label>
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted sm:col-span-2"><span>Reason</span><input name="reason" required minLength={3} placeholder="Written to the audit trail" /></label>
      </div>
    </JsonForm>
  );
}
