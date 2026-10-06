"use client";

import { useState } from "react";
import { JsonForm, TriState } from "@/components/admin/actions";
import { Labelled, inputCls } from "@/components/admin/fields";
import { DatePicker } from "@/components/ui/date-picker";

export function OrgPlanForm({ orgId, plans, current }: { orgId: string; plans: { id: string; code: string; name: string }[]; current: { planId: string; interval: string } }) {
  return (
    <JsonForm path={`/api/admin/organisations/${orgId}/actions`} transform={(d) => ({ action: "change_plan", planId: String(d.planId), interval: String(d.interval), status: d.status ? String(d.status) : undefined, periodEnd: d.periodEnd ? new Date(String(d.periodEnd)).toISOString() : undefined, reason: String(d.reason) })} submitLabel="Change plan">
      <Labelled label="Plan"><select name="planId" defaultValue={current.planId} required className={inputCls}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Labelled>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Interval"><select name="interval" defaultValue={current.interval} className={inputCls}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></Labelled>
        <Labelled label="Status"><select name="status" defaultValue="" className={inputCls}><option value="">Keep</option><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="suspended">Suspended</option></select></Labelled>
      </div>
      <Labelled label="Period end" hint="optional"><DatePicker name="periodEnd" /></Labelled>
      <Labelled label="Reason"><input name="reason" required minLength={3} placeholder="Written to the audit trail" className={inputCls} /></Labelled>
    </JsonForm>
  );
}

/** Three-way switches per feature: inherit, on, off. Only explicit choices are stored. */
export function FeatureOverridesForm({ orgId, keys, overrides, plan }: { orgId: string; keys: readonly string[]; overrides: Record<string, boolean>; plan: Record<string, boolean> }) {
  const [state, setState] = useState<Record<string, "inherit" | "on" | "off">>(Object.fromEntries(keys.map((k) => [k, k in overrides ? (overrides[k] ? "on" : "off") : "inherit"])));
  return (
    <JsonForm path={`/api/admin/organisations/${orgId}/actions`} transform={(d) => ({ action: "features", overrides: Object.fromEntries(Object.entries(state).filter(([, v]) => v !== "inherit").map(([k, v]) => [k, v === "on"])), reason: d.reason ? String(d.reason) : undefined })} submitLabel="Save overrides">
      <ul className="grid">
        {keys.map((k) => (
          <li key={k} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1.5">
            <span className="min-w-0">
              <span className="block font-mono text-xs text-foreground">{k}</span>
              <span className="block text-meta font-normal text-secondary">Plan: {k in plan ? (plan[k] ? "on" : "off") : "not set"}</span>
            </span>
            <TriState name={`override_${k}`} label={k} value={state[k]} onChange={(v) => setState((s) => ({ ...s, [k]: v as "inherit" | "on" | "off" }))}
              options={[{ value: "inherit", label: "Inherit" }, { value: "on", label: "On", tone: "success" }, { value: "off", label: "Off", tone: "danger" }]} />
          </li>
        ))}
      </ul>
      <Labelled label="Reason" hint="optional"><input name="reason" className={inputCls} /></Labelled>
    </JsonForm>
  );
}

/** Adds days to the current period; an expired subscription goes back on trial. */
export function ExtendTrialForm({ orgId }: { orgId: string }) {
  return (
    <JsonForm path={`/api/admin/organisations/${orgId}/actions`} transform={(d) => ({ action: "extend_trial", days: Number(d.days), reason: String(d.reason) })} submitLabel="Extend" successMessage="Trial extended.">
      <Labelled label="Days"><input name="days" type="number" min={1} max={365} defaultValue={14} className={inputCls} required /></Labelled>
      <Labelled label="Reason" hint="written to the audit trail"><input name="reason" className={inputCls} required minLength={3} /></Labelled>
    </JsonForm>
  );
}
