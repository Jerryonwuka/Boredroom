"use client";

import { useState } from "react";
import { AdminAction, JsonForm } from "@/components/admin/actions";
import { inputCls } from "@/components/admin/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { InputAdorned } from "@/components/ui/input";
import { api, isApiFailure } from "@/lib/api-client";
import type { paystackStatus } from "@/server/admin/paystack-config";
import { cn } from "@/lib/utils";
import type { LaunchSettings, GeneralSettings, LandingSettings, BillingSettings, FeatureFlags } from "@/server/admin/settings";
import type { AdminRow } from "@/server/admin/ops";
import { ADMIN_ROLES, ROLE_LABEL, type AdminRole } from "@/server/admin/permissions";

const MODES: { mode: LaunchSettings["mode"]; title: string; lines: string[] }[] = [
  { mode: "waitlist", title: "Waitlist", lines: ["Website online", "Waitlist form accepting signups", "New registration disabled", "Existing users enabled"] },
  { mode: "live", title: "Live", lines: ["Website online", "Waitlist optional", "New registration enabled", "Existing users enabled"] },
  { mode: "maintenance", title: "Maintenance", lines: ["Website online", "New registration disabled", "App access optional", "Admin access enabled"] },
];

/** The launch switch: the current mode, what each mode means, and a confirmed, reasoned change. */
export function LaunchControl({ launch, canEdit }: { launch: LaunchSettings; canEdit: boolean }) {
  const [target, setTarget] = useState<LaunchSettings["mode"]>(launch.mode);
  const [waitlistOpen, setWaitlistOpen] = useState(launch.waitlist_open);
  const [appAccess, setAppAccess] = useState(launch.app_access);
  const [message, setMessage] = useState(launch.message ?? "");
  const changed = target !== launch.mode || waitlistOpen !== launch.waitlist_open || appAccess !== launch.app_access || message !== (launch.message ?? "");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">{MODES.map((m) => (
        <button key={m.mode} type="button" disabled={!canEdit} onClick={() => setTarget(m.mode)} aria-pressed={target === m.mode} className={cn("tile p-4 text-left transition-[border-color]", target === m.mode ? "border-accent" : "hover:border-border-strong", !canEdit && "cursor-default")}>
          <p className="flex items-center gap-2 font-display text-lg">{m.title}{launch.mode === m.mode ? <Badge tone="accent">current</Badge> : null}</p>
          <ul className="mt-2 space-y-1 text-sm text-fg-muted">{m.lines.map((l) => <li key={l} className="flex items-center gap-2"><span className={cn("size-1.5 rounded-full", l.includes("disabled") ? "bg-fg-faint" : "bg-success")} aria-hidden />{l}</li>)}</ul>
        </button>
      ))}</div>
      {canEdit ? (
        <div className="chip flex flex-wrap items-end gap-4 p-4">
          {target === "live" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={waitlistOpen} onChange={(e) => setWaitlistOpen(e.target.checked)} />Keep the waitlist form available</label> : null}
          {target === "maintenance" ? <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={appAccess} onChange={(e) => setAppAccess(e.target.checked)} />Existing users may still use the app</label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Notice shown to users</span><input value={message} onChange={(e) => setMessage(e.target.value)} className={`${inputCls} w-80`} placeholder="We are doing maintenance; back at 18:00 WAT." /></label></> : null}
          <AdminAction path="/api/admin/launch" body={{ mode: target, waitlistOpen, appAccess, message }} reason variant="primary" disabled={!changed} confirm={{ title: `Switch the platform to ${target.toUpperCase()}?`, description: target === "live" ? "Public registration opens for everyone the moment you confirm." : target === "waitlist" ? "New registration closes; the waitlist form takes its place. Everyone who already has an account keeps it." : appAccess ? "Registration closes and users see the notice; the app stays reachable." : "Registration closes and the app is unavailable to everyone but administrators.", label: `Switch to ${target.toUpperCase()}` }}>Switch to {target.toUpperCase()}</AdminAction>
        </div>
      ) : <p className="text-sm text-fg-subtle">Your role can see the launch state but not change it.</p>}
    </div>
  );
}

export function GeneralSettingsForm({ value }: { value: GeneralSettings }) {
  return (
    <JsonForm path="/api/admin/settings/general" method="PUT" transform={(d) => ({ value: { platform_name: String(d.platform_name), support_email: String(d.support_email ?? ""), currency: String(d.currency) } })}>
      <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Platform name</span><input name="platform_name" defaultValue={value.platform_name} className={inputCls} required /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Support email</span><input name="support_email" type="email" defaultValue={value.support_email} className={inputCls} /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Reporting currency</span><input name="currency" defaultValue={value.currency} maxLength={3} className={inputCls} required /></label></div>
    </JsonForm>
  );
}

export function LandingSettingsForm({ value }: { value: LandingSettings }) {
  return (
    <JsonForm path="/api/admin/settings/landing" method="PUT" transform={(d) => ({ value: { headline: String(d.headline ?? ""), subheadline: String(d.subheadline ?? ""), cta: String(d.cta ?? "") } })}>
      <div className="grid gap-3"><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Waitlist headline <span className="text-fg-subtle">(blank keeps the default)</span></span><input name="headline" defaultValue={value.headline} className={inputCls} /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Subheadline</span><input name="subheadline" defaultValue={value.subheadline} className={inputCls} /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Button text</span><input name="cta" defaultValue={value.cta} className={`${inputCls} w-64`} /></label></div>
    </JsonForm>
  );
}

export function BillingSettingsForm({ value }: { value: BillingSettings }) {
  return (
    <JsonForm path="/api/admin/settings/billing" method="PUT" transform={(d) => ({ value: { trial_days: Number(d.trial_days), grace_days: Number(d.grace_days) } })}>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Default trial, days</span><input name="trial_days" type="number" min={0} max={365} defaultValue={value.trial_days} className={inputCls} /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Grace after period end, days</span><input name="grace_days" type="number" min={0} max={60} defaultValue={value.grace_days} className={inputCls} /></label></div>
    </JsonForm>
  );
}

export function FeatureFlagsForm({ value, keys }: { value: FeatureFlags; keys: readonly string[] }) {
  const [flags, setFlags] = useState<Record<string, "unset" | "on" | "off">>(Object.fromEntries(keys.map((k) => [k, k in value ? (value[k] ? "on" : "off") : "unset"])));
  return (
    <JsonForm path="/api/admin/settings/feature_flags" method="PUT" transform={(d) => ({ value: Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== "unset").map(([k, v]) => [k, v === "on"])), reason: String(d.reason ?? "") })} submitLabel="Save flags">
      <ul className="divide-y divide-border-soft text-sm">{keys.map((k) => (
        <li key={k} className="flex items-center justify-between gap-3 py-2"><span className="font-mono text-xs">{k}</span>
          <span role="radiogroup" aria-label={k} className="inline-flex rounded-full border border-border bg-wash-soft p-0.5">{(["unset", "on", "off"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={flags[k] === v} onClick={() => setFlags((s) => ({ ...s, [k]: v }))} className={cn("rounded-full px-2.5 py-1 text-xs", flags[k] === v ? (v === "on" ? "bg-success/20 text-success" : v === "off" ? "bg-danger/20 text-danger" : "border border-accent/50 bg-accent-soft text-accent") : "text-fg-muted")}>{v === "unset" ? "default on" : v}</button>)}</span>
        </li>
      ))}</ul>
      <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Reason <span className="text-fg-subtle">(optional)</span></span><input name="reason" className={inputCls} /></label>
    </JsonForm>
  );
}

export function AdminCreateForm() {
  return (
    <JsonForm path="/api/admin/admins" transform={(d) => ({ email: String(d.email), role: String(d.role) })} submitLabel="Add administrator" successMessage="Added.">
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]"><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Account email <span className="text-fg-subtle">(an existing Boredroom account)</span></span><input name="email" type="email" className={inputCls} required /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Role</span><select name="role" defaultValue="support" className={inputCls}>{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label></div>
    </JsonForm>
  );
}

export function AdminRowActions({ row, self }: { row: AdminRow; self: boolean }) {
  const [role, setRole] = useState<AdminRole>(row.role);
  const base = `/api/admin/admins/${row.id}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} disabled={self} className={inputCls} aria-label={`Role for ${row.email}`}>{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      {role !== row.role ? <AdminAction path={base} method="PATCH" body={{ role }} reason confirm={{ title: `Change ${row.email} to ${ROLE_LABEL[role]}?`, label: "Change role" }}>Apply</AdminAction> : null}
      <AdminAction path={base} method="PATCH" body={{ revokeSessions: true }} confirm={{ title: `Sign ${row.email} out everywhere?`, label: "Sign out" }}>Revoke sessions</AdminAction>
      {row.status === "active" ? <AdminAction path={base} method="PATCH" body={{ status: "disabled" }} reason danger disabled={self} confirm={{ title: `Disable ${row.email}'s admin access?`, description: "Their sessions are revoked and the Control Center refuses them. Their Boredroom account is untouched.", label: "Disable" }}>Disable</AdminAction> : <AdminAction path={base} method="PATCH" body={{ status: "active" }} reason variant="primary" confirm={{ title: `Re-enable ${row.email}?`, label: "Enable" }}>Enable</AdminAction>}
    </div>
  );
}


type PaystackStatus = Awaited<ReturnType<typeof paystackStatus>>;

/** One pair of keys: public in the open, secret write-only, a Test button, and a glow when it is the pair in use. */
function KeyPair({ which, status, mode, testing, onTest }: { which: "test" | "live"; status: PaystackStatus; mode: "test" | "live"; testing: "test" | "live" | null; onTest: (m: "test" | "live") => void }) {
  const st = status[which];
  const active = mode === which;
  return (
    <section className={cn("rounded-[var(--radius)] border p-4 transition-colors duration-[var(--duration-fast)]", active ? "border-accent/50 bg-wash-soft shadow-[inset_0_1px_0_var(--highlight),0_0_40px_-20px_var(--accent)]" : "border-border-soft bg-wash-soft")}>
      <div className="mb-3 flex items-center justify-between gap-3"><p className="eyebrow">{which} keys</p>{active ? <Badge tone="accent" dot>in use</Badge> : st.complete ? <Badge tone="neutral">stored</Badge> : <Badge tone="neutral">empty</Badge>}</div>
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Public key</span><InputAdorned prefix={`pk_${which}`} name={`${which}_public_key`} defaultValue={st.public_key} placeholder="…" className="font-mono text-[13px]" autoComplete="off" /></label>
        <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Secret key <span className="text-fg-subtle">{st.secret_tail ? `(stored, ends ${st.secret_tail}; blank keeps it)` : "(not stored yet)"}</span></span><InputAdorned prefix={`sk_${which}`} name={`${which}_secret_key`} type="password" placeholder={st.secret_tail ? "••••••••" : "paste the secret key"} className="font-mono text-[13px]" autoComplete="new-password" /></label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-fg-subtle">{which === "test" ? "Charges nothing. Use Paystack's test cards." : "Real money. Only after the test pair works."}</p><Button type="button" size="sm" variant="subtle" disabled={testing !== null || !st.secret_tail} onClick={() => onTest(which)}>{testing === which ? "Testing…" : `Test ${which} key`}</Button></div>
    </section>
  );
}

/**
 * Paystack keys (owner decision, 25 September 2026): a test pair and a live pair, a switch that says which is in
 * use, a Test button that calls Paystack with the stored key, and the two URLs to paste into the Paystack dashboard.
 * Secrets are write-only: the form shows their last four characters and a blank field keeps what is stored.
 */
export function PaystackSettingsForm({ status }: { status: PaystackStatus }) {
  const [mode, setMode] = useState<"test" | "live">(status.mode);
  const [testing, setTesting] = useState<"test" | "live" | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const test = async (m: "test" | "live") => {
    setTesting(m); setResult(null);
    try { const r = await api<{ transactions: number }>("/api/admin/paystack", { method: "POST", body: { action: "test", mode: m }, retries: 0 }); setResult({ tone: "success", text: `Paystack accepted the ${m} secret key. ${r.transactions.toLocaleString()} transaction${r.transactions === 1 ? "" : "s"} on that account.` }); }
    catch (err) { setResult({ tone: "danger", text: isApiFailure(err) ? err.error.message : "Cannot reach the server." }); }
    finally { setTesting(null); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked: the text is visible to select */ } };
  return (
    <div className="grid gap-5">
      {result ? <Alert tone={result.tone}>{result.text}</Alert> : null}
      <JsonForm path="/api/admin/paystack" method="PUT" transform={(d) => ({ value: { mode: String(d.mode), test_public_key: String(d.test_public_key ?? ""), test_secret_key: String(d.test_secret_key ?? ""), live_public_key: String(d.live_public_key ?? ""), live_secret_key: String(d.live_secret_key ?? "") }, reason: "Paystack keys updated" })} submitLabel="Save keys" successMessage="Saved. Checkout now uses the pair marked in use.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border-soft bg-wash-soft p-4">
          <div><p className="eyebrow">Mode</p><p className="mt-0.5 text-sm text-fg-muted">{mode === "live" ? "Customers are charged for real." : "Checkout runs against Paystack's sandbox; nothing is charged."}</p></div>
          <Segmented name="mode" aria-label="Paystack mode" value={mode} onChange={(v) => setMode(v as "test" | "live")} options={[{ value: "test", label: "Test", tone: "warning" }, { value: "live", label: "Live", tone: "success" }]} />
        </div>
        <div className="grid gap-4 md:grid-cols-2"><KeyPair which="test" status={status} mode={mode} testing={testing} onTest={test} /><KeyPair which="live" status={status} mode={mode} testing={testing} onTest={test} /></div>
        {status.source === "env" ? <p className="text-xs text-fg-subtle">Right now the keys come from the server environment (PAYSTACK_SECRET_KEY). Saving a pair here takes over.</p> : null}
      </JsonForm>
      <section className="rounded-[var(--radius)] border border-border-soft bg-wash-soft p-4">
        <p className="eyebrow mb-2">Paste into Paystack</p>
        <ul className="grid gap-2 text-sm">
          {[["Webhook URL", status.webhook_url], ["Callback URL", status.callback_url]].map(([label, url]) => (
            <li key={label} className="flex flex-wrap items-center justify-between gap-2"><span className="text-fg-muted">{label}</span><span className="flex items-center gap-2"><code className="rounded-full bg-inset px-3 py-1 text-xs">{url}</code><Button type="button" size="sm" variant="ghost" onClick={() => void copy(url)}>{copied === url ? "Copied" : "Copy"}</Button></span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">Paystack dashboard, Settings, API Keys and Webhooks: add the webhook URL for both test and live. Events handled: charge.success, charge.failed, invoice.payment_failed, subscription.create, subscription.disable, subscription.not_renew, refund.processed. Every delivery is checked against the stored secrets and stored once.</p>
      </section>
    </div>
  );
}
