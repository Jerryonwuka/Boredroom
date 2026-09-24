"use client";

import { JsonForm, inputCls } from "@/components/admin/actions";
import type { PlanRow } from "@/server/admin/billing";

/** Create or edit a plan. Prices are typed in major units and stored in minor units. */
export function PlanForm({ plan, featureKeys }: { plan?: PlanRow; featureKeys: readonly string[] }) {
  return (
    <JsonForm path="/api/admin/plans" transform={(d) => ({
      id: plan?.id ?? null, code: String(d.code), name: String(d.name), description: String(d.description ?? "") || null, currency: String(d.currency),
      monthlyPrice: Math.round(Number(d.monthly) * 100), annualPrice: Math.round(Number(d.annual) * 100),
      maxUsers: d.maxUsers ? Number(d.maxUsers) : null, maxStorageGb: d.maxStorageGb ? Number(d.maxStorageGb) : null, trialDays: Number(d.trialDays ?? 0),
      features: Object.fromEntries(featureKeys.map((k) => [k, d[`f_${k}`] === "on"])), status: String(d.status), sortOrder: Number(d.sortOrder ?? 0),
    })} submitLabel={plan ? "Save plan" : "Create plan"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>Code</span><input name="code" defaultValue={plan?.code ?? ""} pattern="[a-z0-9-]{2,40}" className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Name</span><input name="name" defaultValue={plan?.name ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Description</span><input name="description" defaultValue={plan?.description ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Currency</span><input name="currency" defaultValue={plan?.currency ?? "NGN"} maxLength={3} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Status</span><select name="status" defaultValue={plan?.status ?? "active"} className={inputCls}><option value="active">Active</option><option value="hidden">Hidden</option><option value="archived">Archived</option></select></label>
        <label className="grid gap-1 text-sm"><span>Monthly price</span><input name="monthly" type="number" min={0} step="0.01" defaultValue={(plan?.monthly_price ?? 0) / 100} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Annual price</span><input name="annual" type="number" min={0} step="0.01" defaultValue={(plan?.annual_price ?? 0) / 100} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Max people <span className="text-fg-subtle">(blank = unlimited)</span></span><input name="maxUsers" type="number" min={1} defaultValue={plan?.max_users ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Max storage, GB <span className="text-fg-subtle">(blank = unlimited)</span></span><input name="maxStorageGb" type="number" min={0.1} step="0.1" defaultValue={plan?.max_storage_bytes ? Math.round(plan.max_storage_bytes / 1024 / 1024 / 1024) : ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Trial days</span><input name="trialDays" type="number" min={0} max={365} defaultValue={plan?.trial_days ?? 0} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Sort order</span><input name="sortOrder" type="number" defaultValue={plan?.sort_order ?? 0} className={inputCls} /></label>
      </div>
      <fieldset><legend className="eyebrow mb-2">Features</legend><div className="grid gap-1.5 sm:grid-cols-2">{featureKeys.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`f_${k}`} defaultChecked={!!plan?.features?.[k]} className="size-4 accent-[var(--accent)]" /><span className="font-mono text-xs">{k}</span></label>)}</div></fieldset>
    </JsonForm>
  );
}

export function SubscriptionEditForm({ id, current }: { id: string; current: { status: string; periodEnd: string | null; autoRenew: boolean; notes: string | null } }) {
  return (
    <JsonForm path={`/api/admin/subscriptions/${id}`} method="PATCH" transform={(d) => ({ status: d.status ? String(d.status) : undefined, periodEnd: d.periodEnd === "" ? undefined : new Date(String(d.periodEnd)).toISOString(), autoRenew: d.autoRenew === "on", notes: String(d.notes ?? "") || null, reason: String(d.reason) })} submitLabel="Update subscription">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>Status</span><select name="status" defaultValue={current.status} className={inputCls}>{["trial", "active", "payment_failed", "past_due", "cancelled", "expired", "suspended"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>Period end</span><input name="periodEnd" type="date" defaultValue={current.periodEnd ? current.periodEnd.slice(0, 10) : ""} className={inputCls} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="autoRenew" defaultChecked={current.autoRenew} className="size-4 accent-[var(--accent)]" />Auto-renew</label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Notes</span><input name="notes" defaultValue={current.notes ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Reason</span><input name="reason" className={inputCls} required minLength={3} placeholder="Written to the audit trail" /></label>
      </div>
    </JsonForm>
  );
}
