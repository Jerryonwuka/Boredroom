"use client";

import { useId, useState } from "react";
import { JsonForm } from "@/components/admin/actions";
import { InputAdorned } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { DatePicker } from "@/components/ui/date-picker";
import { FEATURE_LABELS } from "@/lib/plans";
import { Labelled, inputCls } from "@/components/admin/fields";
import type { PlanRow } from "@/server/admin/billing";

const STATUS = [{ value: "active", label: "Active", tone: "success" as const }, { value: "hidden", label: "Hidden", tone: "warning" as const }, { value: "archived", label: "Archived", tone: "danger" as const }];

/** A titled part of a long form in a sheet: a 14/20 semibold title, a 13px hint, a hairline above all but the first. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-5 first-of-type:border-t-0 first-of-type:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-meta font-normal text-secondary">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Create or edit a plan. Prices are typed in major units and stored in minor units; blank limits mean unlimited. */
export function PlanForm({ plan, featureKeys }: { plan?: PlanRow; featureKeys: readonly string[] }) {
  const [currency, setCurrency] = useState(plan?.currency ?? "NGN");
  const id = useId();
  const gb = plan?.max_storage_bytes ? Math.round(plan.max_storage_bytes / 1024 / 1024 / 1024) : "";
  return (
    <JsonForm path="/api/admin/plans" transform={(d) => ({
      id: plan?.id ?? null, code: String(d.code), name: String(d.name), description: String(d.description ?? "") || null, currency: String(d.currency).toUpperCase(),
      monthlyPrice: Math.round(Number(d.monthly) * 100), annualPrice: Math.round(Number(d.annual) * 100),
      maxUsers: d.maxUsers ? Number(d.maxUsers) : null, maxStorageGb: d.maxStorageGb ? Number(d.maxStorageGb) : null, maxWorkspaces: d.maxWorkspaces ? Number(d.maxWorkspaces) : null, trialDays: Number(d.trialDays ?? 0),
      features: Object.fromEntries(featureKeys.map((k) => [k, d[`f_${k}`] === "on"])), status: String(d.status), sortOrder: Number(d.sortOrder ?? 0),
    })} submitLabel={plan ? "Save plan" : "Create plan"} successMessage={plan ? "Plan saved." : "Plan created."}>
      <Section title="Identity" hint="The name is what buyers see; the code is what the system and Paystack use.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled label="Name"><input name="name" defaultValue={plan?.name ?? ""} className={inputCls} required placeholder="Pro" /></Labelled>
          <Labelled label="Code" htmlFor={`${id}-code`}><InputAdorned id={`${id}-code`} prefix="plan /" name="code" defaultValue={plan?.code ?? ""} pattern="[a-z0-9\-]{2,40}" required placeholder="pro" className="font-mono" /></Labelled>
          <Labelled label="One line for the pricing page" className="sm:col-span-2"><textarea name="description" defaultValue={plan?.description ?? ""} rows={2} className={inputCls} placeholder="Everything a remote team needs." /></Labelled>
        </div>
      </Section>
      <Section title="Price" hint="Typed in major units. Yearly is charged once; the pricing page shows it per month.">
        <div className="grid gap-3 sm:grid-cols-[96px_1fr_1fr]">
          <Labelled label="Currency"><input name="currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} className={`${inputCls} font-mono uppercase`} required /></Labelled>
          <Labelled label="Monthly" htmlFor={`${id}-monthly`}><InputAdorned id={`${id}-monthly`} prefix={currency || "NGN"} suffix="/ mo" name="monthly" type="number" min={0} step="0.01" defaultValue={(plan?.monthly_price ?? 0) / 100} required /></Labelled>
          <Labelled label="Yearly" htmlFor={`${id}-annual`}><InputAdorned id={`${id}-annual`} prefix={currency || "NGN"} suffix="/ yr" name="annual" type="number" min={0} step="0.01" defaultValue={(plan?.annual_price ?? 0) / 100} required /></Labelled>
          <Labelled label="Free trial" htmlFor={`${id}-trial`} className="sm:col-span-3"><InputAdorned id={`${id}-trial`} suffix="days" name="trialDays" type="number" min={0} max={365} defaultValue={plan?.trial_days ?? 0} className="sm:w-40" /></Labelled>
        </div>
      </Section>
      <Section title="Limits" hint="Leave a limit blank for unlimited.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Labelled label="Workspaces" htmlFor={`${id}-workspaces`}><InputAdorned id={`${id}-workspaces`} suffix="owned" name="maxWorkspaces" type="number" min={1} defaultValue={plan?.max_workspaces ?? ""} placeholder="∞" /></Labelled>
          <Labelled label="People" htmlFor={`${id}-people`}><InputAdorned id={`${id}-people`} suffix="each" name="maxUsers" type="number" min={1} defaultValue={plan?.max_users ?? ""} placeholder="∞" /></Labelled>
          <Labelled label="Storage" htmlFor={`${id}-storage`}><InputAdorned id={`${id}-storage`} suffix="GB" name="maxStorageGb" type="number" min={0.1} step="0.1" defaultValue={gb} placeholder="∞" /></Labelled>
        </div>
      </Section>
      <Section title="Features" hint="What this plan switches on.">
        <div className="grid gap-x-6 sm:grid-cols-2">
          {featureKeys.map((k) => <Switch key={k} name={`f_${k}`} defaultChecked={!!plan?.features?.[k]} hint={<span className="font-mono text-xs">{k}</span>}>{FEATURE_LABELS[k] ?? k.replace(/_/g, " ").toLowerCase()}</Switch>)}
        </div>
      </Section>
      <Section title="Visibility">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Segmented name="status" aria-label="Plan status" options={STATUS} defaultValue={plan?.status ?? "active"} />
          <Labelled label="Order on the page"><input name="sortOrder" type="number" defaultValue={plan?.sort_order ?? 0} className={`${inputCls} w-28`} /></Labelled>
        </div>
      </Section>
    </JsonForm>
  );
}

export function SubscriptionEditForm({ id, current }: { id: string; current: { status: string; periodEnd: string | null; autoRenew: boolean; notes: string | null } }) {
  return (
    <JsonForm path={`/api/admin/subscriptions/${id}`} method="PATCH" transform={(d) => ({ status: d.status ? String(d.status) : undefined, periodEnd: d.periodEnd === "" ? undefined : new Date(String(d.periodEnd)).toISOString(), autoRenew: d.autoRenew === "on", notes: String(d.notes ?? "") || null, reason: String(d.reason) })} submitLabel="Update subscription" successMessage="Subscription updated.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Status"><select name="status" defaultValue={current.status} className={inputCls}>{["trial", "active", "payment_failed", "past_due", "cancelled", "expired", "suspended"].map((s) => <option key={s} value={s}>{(s.charAt(0).toUpperCase() + s.slice(1)).replace("_", " ")}</option>)}</select></Labelled>
        <Labelled label="Period end"><DatePicker name="periodEnd" defaultValue={current.periodEnd ? current.periodEnd.slice(0, 10) : ""} /></Labelled>
        <Switch name="autoRenew" defaultChecked={current.autoRenew} className="sm:col-span-2">Auto-renew</Switch>
        <Labelled label="Notes" className="sm:col-span-2"><input name="notes" defaultValue={current.notes ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Reason" className="sm:col-span-2"><input name="reason" required minLength={3} placeholder="Written to the audit trail" className={inputCls} /></Labelled>
      </div>
    </JsonForm>
  );
}
