"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { AdminAction, JsonForm, TriState } from "@/components/admin/actions";
import { Labelled, inputCls, subCls } from "@/components/admin/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { InputAdorned } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, isApiFailure } from "@/lib/api-client";
import type { paystackStatus } from "@/server/admin/paystack-config";
import { cn } from "@/lib/utils";
import type { LaunchSettings, GeneralSettings, LandingSettings, BillingSettings, FeatureFlags } from "@/server/admin/settings";
import type { AdminRow } from "@/server/admin/ops";
import { ADMIN_ROLES, ROLE_LABEL, type AdminRole } from "@/server/admin/permissions";

const MODES: { mode: LaunchSettings["mode"]; title: string; tone: "warning" | "success" | "danger"; lines: string[] }[] = [
  { mode: "waitlist", title: "Waitlist", tone: "warning", lines: ["Website online", "Waitlist form accepting signups", "New registration disabled", "Existing users enabled"] },
  { mode: "live", title: "Live", tone: "success", lines: ["Website online", "Waitlist optional", "New registration enabled", "Existing users enabled"] },
  { mode: "maintenance", title: "Maintenance", tone: "danger", lines: ["Website online", "New registration disabled", "App access optional", "Admin access enabled"] },
];
const MODE_LABEL: Record<LaunchSettings["mode"], string> = { waitlist: "Waitlist", live: "Live", maintenance: "Maintenance" };

/**
 * The launch switch: the current mode, what each mode means, and a confirmed, reasoned change. The modes are a radio
 * group drawn as cards (the chosen one: an orange ring and dot, fill-1); the mode in force carries its status badge.
 * "Switch to …" is the tab's one standout action, the orange button (accent rules).
 */
export function LaunchControl({ launch, canEdit }: { launch: LaunchSettings; canEdit: boolean }) {
  const [target, setTarget] = useState<LaunchSettings["mode"]>(launch.mode);
  const [waitlistOpen, setWaitlistOpen] = useState(launch.waitlist_open);
  const [appAccess, setAppAccess] = useState(launch.app_access);
  const [message, setMessage] = useState(launch.message ?? "");
  const name = useId();
  const changed = target !== launch.mode || waitlistOpen !== launch.waitlist_open || appAccess !== launch.app_access || message !== (launch.message ?? "");
  const label = MODE_LABEL[target];
  return (
    <div className="grid gap-4">
      <div role="radiogroup" aria-label="Platform mode" className="grid gap-3 md:grid-cols-3">{MODES.map((m) => (
        <label key={m.mode} className={cn("relative grid cursor-pointer content-start gap-3 rounded-xl border p-4 transition-colors duration-75",
          target === m.mode ? "border-border-input-hover bg-fill-1" : "border-border bg-background hover:border-border-input-hover", !canEdit && "cursor-default")}>
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <input type="radio" name={name} value={m.mode} checked={target === m.mode} disabled={!canEdit} onChange={() => setTarget(m.mode)} />
              {m.title}
            </span>
            {launch.mode === m.mode ? <Badge tone={m.tone} dot>Current</Badge> : null}
          </span>
          <ul className="grid gap-1 text-meta font-normal text-secondary">{m.lines.map((l) => <li key={l} className="flex items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", l.includes("disabled") ? "bg-faint" : "bg-success")} aria-hidden />{l}</li>)}</ul>
        </label>
      ))}</div>
      {canEdit ? (
        <div className="grid gap-3 rounded-xl bg-fill-0 p-4">
          {target === "live" ? <Switch checked={waitlistOpen} onChange={(e) => setWaitlistOpen(e.target.checked)}>Keep the waitlist form available</Switch> : null}
          {target === "maintenance" ? (
            <>
              <Switch checked={appAccess} onChange={(e) => setAppAccess(e.target.checked)}>Existing users may still use the app</Switch>
              <Labelled label="Notice shown to users"><input value={message} onChange={(e) => setMessage(e.target.value)} className={cn(inputCls, "max-w-md")} placeholder="We are doing maintenance; back at 18:00 WAT." /></Labelled>
            </>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta font-normal text-secondary">{changed ? `Ready to switch to ${label}.` : "Choose a mode or change a setting to switch."}</p>
            <AdminAction path="/api/admin/launch" body={{ mode: target, waitlistOpen, appAccess, message }} reason variant="accent" disabled={!changed} confirm={{ title: `Switch the platform to ${label}?`, description: target === "live" ? "Public registration opens for everyone the moment you confirm." : target === "waitlist" ? "New registration closes; the waitlist form takes its place. Everyone who already has an account keeps it." : appAccess ? "Registration closes and users see the notice; the app stays reachable." : "Registration closes and the app is unavailable to everyone but administrators.", label: `Switch to ${label}` }}>Switch to {label}</AdminAction>
          </div>
        </div>
      ) : <p className="text-sm font-normal text-secondary">Your role can see the launch state but not change it.</p>}
    </div>
  );
}

export function GeneralSettingsForm({ value }: { value: GeneralSettings }) {
  return (
    <JsonForm path="/api/admin/settings/general" method="PUT" transform={(d) => ({ value: { platform_name: String(d.platform_name), support_email: String(d.support_email ?? ""), currency: String(d.currency) } })}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Labelled label="Platform name"><input name="platform_name" defaultValue={value.platform_name} className={inputCls} required /></Labelled>
        <Labelled label="Support email"><input name="support_email" type="email" defaultValue={value.support_email} className={inputCls} /></Labelled>
        <Labelled label="Reporting currency"><input name="currency" defaultValue={value.currency} maxLength={3} className={`${inputCls} font-mono uppercase`} required /></Labelled>
      </div>
    </JsonForm>
  );
}

export function LandingSettingsForm({ value }: { value: LandingSettings }) {
  return (
    <JsonForm path="/api/admin/settings/landing" method="PUT" transform={(d) => ({ value: { headline: String(d.headline ?? ""), subheadline: String(d.subheadline ?? ""), cta: String(d.cta ?? "") } })}>
      <div className="grid max-w-2xl gap-3">
        <Labelled label="Waitlist headline" hint="blank keeps the default"><input name="headline" defaultValue={value.headline} className={inputCls} /></Labelled>
        <Labelled label="Subheadline"><input name="subheadline" defaultValue={value.subheadline} className={inputCls} /></Labelled>
        <Labelled label="Button text"><input name="cta" defaultValue={value.cta} className={`${inputCls} sm:w-64`} /></Labelled>
      </div>
    </JsonForm>
  );
}

export function BillingSettingsForm({ value }: { value: BillingSettings }) {
  return (
    <JsonForm path="/api/admin/settings/billing" method="PUT" transform={(d) => ({ value: { trial_days: Number(d.trial_days), grace_days: Number(d.grace_days) } })}>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Labelled label="Default trial" hint="days"><input name="trial_days" type="number" min={0} max={365} defaultValue={value.trial_days} className={inputCls} /></Labelled>
        <Labelled label="Grace after period end" hint="days"><input name="grace_days" type="number" min={0} max={60} defaultValue={value.grace_days} className={inputCls} /></Labelled>
      </div>
    </JsonForm>
  );
}

export function FeatureFlagsForm({ value, keys }: { value: FeatureFlags; keys: readonly string[] }) {
  const [flags, setFlags] = useState<Record<string, "unset" | "on" | "off">>(Object.fromEntries(keys.map((k) => [k, k in value ? (value[k] ? "on" : "off") : "unset"])));
  return (
    <JsonForm path="/api/admin/settings/feature_flags" method="PUT" transform={(d) => ({ value: Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== "unset").map(([k, v]) => [k, v === "on"])), reason: String(d.reason ?? "") })} submitLabel="Save flags">
      <ul className="grid">{keys.map((k) => (
        <li key={k} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1.5">
          <span className="min-w-0 font-mono text-xs text-foreground">{k}</span>
          <TriState name={`flag_${k}`} label={k} value={flags[k]} onChange={(v) => setFlags((s) => ({ ...s, [k]: v as "unset" | "on" | "off" }))}
            options={[{ value: "unset", label: "Default on" }, { value: "on", label: "On", tone: "success" }, { value: "off", label: "Off", tone: "danger" }]} />
        </li>
      ))}</ul>
      <Labelled label="Reason" hint="optional"><input name="reason" className={cn(inputCls, "max-w-md")} /></Labelled>
    </JsonForm>
  );
}

/** Add an administrator: the account must exist already. The submit is the page's standout action, orange. */
export function AdminCreateForm() {
  return (
    <JsonForm path="/api/admin/admins" transform={(d) => ({ email: String(d.email), role: String(d.role) })} submitLabel="Add administrator" successMessage="Administrator added." submitVariant="accent">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Labelled label="Account email" hint="an existing Boredroom account"><input name="email" type="email" className={inputCls} required /></Labelled>
        <Labelled label="Role"><select name="role" defaultValue="support" className={inputCls}>{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Labelled>
      </div>
    </JsonForm>
  );
}

export function AdminRowActions({ row, self }: { row: AdminRow; self: boolean }) {
  const [role, setRole] = useState<AdminRole>(row.role);
  const base = `/api/admin/admins/${row.id}`;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} disabled={self} className={cn(inputCls, "field-sm w-auto")} aria-label={`Role for ${row.email}`}>{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      {role !== row.role ? <AdminAction path={base} method="PATCH" body={{ role }} reason size="xs" variant="primary" confirm={{ title: `Change ${row.email} to ${ROLE_LABEL[role]}?`, label: "Change role" }}>Apply</AdminAction> : null}
      <AdminAction path={base} method="PATCH" body={{ revokeSessions: true }} size="xs" confirm={{ title: `Sign ${row.email} out everywhere?`, label: "Sign out" }}>Revoke sessions</AdminAction>
      {row.status === "active"
        ? <AdminAction path={base} method="PATCH" body={{ status: "disabled" }} reason danger size="xs" disabled={self} confirm={{ title: `Disable ${row.email}'s admin access?`, description: "Their sessions are revoked and the Control Center refuses them. Their Boredroom account is untouched.", label: "Disable" }}>Disable</AdminAction>
        : <AdminAction path={base} method="PATCH" body={{ status: "active" }} reason size="xs" confirm={{ title: `Re-enable ${row.email}?`, label: "Enable" }}>Enable</AdminAction>}
    </div>
  );
}


type PaystackStatus = Awaited<ReturnType<typeof paystackStatus>>;

/** One pair of keys: public in the open, secret write-only, a Test button; the pair in use says so (an orange badge). */
function KeyPair({ which, status, mode, testing, onTest }: { which: "test" | "live"; status: PaystackStatus; mode: "test" | "live"; testing: "test" | "live" | null; onTest: (m: "test" | "live") => void }) {
  const st = status[which];
  const active = mode === which;
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className={cn("grid content-start gap-3 rounded-xl border p-4 transition-colors duration-75", active ? "border-border-input-hover bg-fill-0" : "border-border")}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-semibold text-foreground">{which === "test" ? "Test keys" : "Live keys"}</h3>
        {active ? <Badge tone="accent" dot>In use</Badge> : st.complete ? <Badge>Stored</Badge> : <Badge tone="info">Empty</Badge>}
      </div>
      <Labelled label="Public key" htmlFor={`${id}-public`}><InputAdorned id={`${id}-public`} prefix={`pk_${which}`} name={`${which}_public_key`} defaultValue={st.public_key} placeholder="…" className="font-mono text-[13px]" autoComplete="off" /></Labelled>
      <Labelled label="Secret key" hint={st.secret_tail ? `stored, ends ${st.secret_tail}; blank keeps it` : "not stored yet"} htmlFor={`${id}-secret`}><InputAdorned id={`${id}-secret`} prefix={`sk_${which}`} name={`${which}_secret_key`} type="password" placeholder={st.secret_tail ? "••••••••" : "paste the secret key"} className="font-mono text-[13px]" autoComplete="new-password" /></Labelled>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta font-normal text-secondary">{which === "test" ? "Charges nothing. Use Paystack's test cards." : "Real money. Only after the test pair works."}</p>
        <Button type="button" size="xs" variant="secondary" loading={testing === which} disabled={testing !== null || !st.secret_tail} onClick={() => onTest(which)}>{testing === which ? "Testing…" : `Test ${which} key`}</Button>
      </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-fill-0 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Mode</p>
            <p className={subCls}>{mode === "live" ? "Customers are charged for real." : "Checkout runs against Paystack's sandbox; nothing is charged."}</p>
          </div>
          <Segmented name="mode" aria-label="Paystack mode" value={mode} onChange={(v) => setMode(v as "test" | "live")} options={[{ value: "test", label: "Test", tone: "warning" }, { value: "live", label: "Live", tone: "success" }]} />
        </div>
        <div className="grid gap-4 md:grid-cols-2"><KeyPair which="test" status={status} mode={mode} testing={testing} onTest={test} /><KeyPair which="live" status={status} mode={mode} testing={testing} onTest={test} /></div>
        {status.source === "env" ? <p className="text-meta font-normal text-secondary">Right now the keys come from the server environment (PAYSTACK_SECRET_KEY). Saving a pair here takes over.</p> : null}
      </JsonForm>
      <section aria-labelledby="paystack-urls" className="grid gap-3 rounded-xl border border-border p-4">
        <h3 id="paystack-urls" className="text-sm font-semibold text-foreground">Paste into Paystack</h3>
        <ul className="grid gap-2">
          {[["Webhook URL", status.webhook_url], ["Callback URL", status.callback_url]].map(([label, url]) => (
            <li key={label} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-secondary">{label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 truncate rounded-md bg-fill-1 px-2 py-1 font-mono text-xs text-foreground">{url}</code>
                <Button type="button" size="xs" variant="ghost" onClick={() => void copy(url)} aria-label={copied === url ? `${label} copied` : `Copy the ${label.toLowerCase()}`}>{copied === url ? <Check aria-hidden /> : <Copy aria-hidden />}{copied === url ? "Copied" : "Copy"}</Button>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-meta font-normal text-secondary">Paystack dashboard, Settings, API Keys and Webhooks: add the webhook URL for both test and live. Events handled: charge.success, charge.failed, invoice.payment_failed, subscription.create, subscription.disable, subscription.not_renew, refund.processed. Every delivery is checked against the stored secrets and stored once.</p>
      </section>
    </div>
  );
}
