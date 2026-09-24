"use client";

import { useState } from "react";
import { JsonForm, inputCls } from "@/components/admin/actions";
import { cn } from "@/lib/utils";

export function OrgPlanForm({ orgId, plans, current }: { orgId: string; plans: { id: string; code: string; name: string }[]; current: { planId: string; interval: string } }) {
  return (
    <JsonForm path={`/api/admin/organisations/${orgId}/actions`} transform={(d) => ({ action: "change_plan", planId: String(d.planId), interval: String(d.interval), status: d.status ? String(d.status) : undefined, periodEnd: d.periodEnd ? new Date(String(d.periodEnd)).toISOString() : undefined, reason: String(d.reason) })} submitLabel="Change plan">
      <label className="grid gap-1 text-sm"><span>Plan</span><select name="planId" defaultValue={current.planId} className={inputCls} required>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm"><span>Interval</span><select name="interval" defaultValue={current.interval} className={inputCls}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
        <label className="grid gap-1 text-sm"><span>Status</span><select name="status" defaultValue="" className={inputCls}><option value="">Keep</option><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="suspended">Suspended</option></select></label>
      </div>
      <label className="grid gap-1 text-sm"><span>Period end <span className="text-fg-subtle">(optional)</span></span><input name="periodEnd" type="date" className={inputCls} /></label>
      <label className="grid gap-1 text-sm"><span>Reason</span><input name="reason" className={inputCls} required minLength={3} placeholder="Written to the audit trail" /></label>
    </JsonForm>
  );
}

/** Three-way switches per feature: inherit, on, off. Only explicit choices are stored. */
export function FeatureOverridesForm({ orgId, keys, overrides, plan }: { orgId: string; keys: readonly string[]; overrides: Record<string, boolean>; plan: Record<string, boolean> }) {
  const [state, setState] = useState<Record<string, "inherit" | "on" | "off">>(Object.fromEntries(keys.map((k) => [k, k in overrides ? (overrides[k] ? "on" : "off") : "inherit"])));
  return (
    <JsonForm path={`/api/admin/organisations/${orgId}/actions`} transform={(d) => ({ action: "features", overrides: Object.fromEntries(Object.entries(state).filter(([, v]) => v !== "inherit").map(([k, v]) => [k, v === "on"])), reason: d.reason ? String(d.reason) : undefined })} submitLabel="Save overrides">
      <ul className="divide-y divide-border-soft text-sm">
        {keys.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 py-2">
            <span><span className="font-mono text-xs">{k}</span><span className="ml-2 text-xs text-fg-subtle">plan: {k in plan ? (plan[k] ? "on" : "off") : "not set"}</span></span>
            <span role="radiogroup" aria-label={k} className="inline-flex rounded-full border border-border bg-wash-soft p-0.5">
              {(["inherit", "on", "off"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={state[k] === v} onClick={() => setState((s) => ({ ...s, [k]: v }))} className={cn("rounded-full px-2.5 py-1 text-xs", state[k] === v ? (v === "on" ? "bg-success/20 text-success" : v === "off" ? "bg-danger/20 text-danger" : "bg-wash-active text-fg") : "text-fg-muted")}>{v}</button>)}
            </span>
          </li>
        ))}
      </ul>
      <label className="grid gap-1 text-sm"><span>Reason <span className="text-fg-subtle">(optional)</span></span><input name="reason" className={inputCls} /></label>
    </JsonForm>
  );
}
