"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Plus, Send, X } from "lucide-react";
import { AdminAction, JsonForm } from "@/components/admin/actions";
import { Labelled, inputCls } from "@/components/admin/fields";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { SegmentRule, TemplateRow, CampaignRow, AutomationRow } from "@/server/admin/marketing";

const FIELDS: { value: SegmentRule["field"]; label: string; kind: "text" | "number" | "bool" | "status" }[] = [
  { value: "status", label: "Contact status", kind: "status" }, { value: "is_waitlist", label: "On the waitlist", kind: "bool" }, { value: "source", label: "Source", kind: "text" }, { value: "company_size", label: "Company size", kind: "text" }, { value: "country", label: "Country", kind: "text" }, { value: "role", label: "Workspace role", kind: "text" }, { value: "plan", label: "Plan code", kind: "text" }, { value: "subscription_status", label: "Subscription status", kind: "text" }, { value: "account_age_days", label: "Account age, days", kind: "number" }, { value: "expires_within_days", label: "Subscription expires within days", kind: "number" }, { value: "inactive_days", label: "Inactive for days", kind: "number" },
];

/** A rule's select or value: the 32px field, as wide as its text. */
const ruleCls = cn(inputCls, "field-sm w-auto max-w-full");
/** Where an email preview renders: the mail as a client would show it, on black. */
const PREVIEW = "w-full rounded-xl border border-border bg-black";

export function SegmentForm({ segment }: { segment?: { id: string; name: string; description: string | null; rules: SegmentRule[] } }) {
  const [rules, setRules] = useState<SegmentRule[]>(segment?.rules ?? []);
  return (
    <JsonForm path="/api/admin/segments" transform={(d) => ({ id: segment?.id ?? null, name: String(d.name), description: String(d.description ?? "") || null, rules })} submitLabel={segment ? "Save segment" : "Create segment"} successMessage={segment ? "Segment saved." : "Segment created."}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Name"><input name="name" defaultValue={segment?.name ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Description"><input name="description" defaultValue={segment?.description ?? ""} className={inputCls} /></Labelled>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium text-foreground">Conditions <span className="font-normal text-secondary">all must hold</span></legend>
        {rules.length === 0 ? <p className="text-meta font-normal text-secondary">No conditions: every subscribed contact.</p> : null}
        {rules.map((r, i) => { const f = FIELDS.find((x) => x.value === r.field)!; return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label={`Condition ${i + 1}: field`} value={r.field} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { field: e.target.value as SegmentRule["field"], op: "eq", value: "" } : x)))} className={ruleCls}>{FIELDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
            <select aria-label={`Condition ${i + 1}: comparison`} value={r.op} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, op: e.target.value as SegmentRule["op"] } : x)))} className={ruleCls}>{(f.kind === "number" ? ["eq", "gte", "lte"] : f.kind === "bool" ? ["eq"] : ["eq", "neq", "contains"]).map((o) => <option key={o} value={o}>{{ eq: "is", neq: "is not", gte: "at least", lte: "at most", contains: "contains" }[o]}</option>)}</select>
            {f.kind === "bool" ? <select aria-label={`Condition ${i + 1}: value`} value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value === "true" } : x)))} className={ruleCls}><option value="true">yes</option><option value="false">no</option></select>
              : f.kind === "status" ? <select aria-label={`Condition ${i + 1}: value`} value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={ruleCls}>{["waiting", "invited", "registered", "activated", "trial", "paid", "unsubscribed"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
              : <input aria-label={`Condition ${i + 1}: value`} type={f.kind === "number" ? "number" : "text"} value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: f.kind === "number" ? Number(e.target.value) : e.target.value } : x)))} className={cn(ruleCls, "w-40")} />}
            <IconButton aria-label={`Remove condition ${i + 1}`} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}><X aria-hidden /></IconButton>
          </div>
        ); })}
        <div><Button type="button" size="sm" variant="secondary" onClick={() => setRules((rs) => [...rs, { field: "status", op: "eq", value: "waiting" }])}><Plus aria-hidden />Add condition</Button></div>
      </fieldset>
    </JsonForm>
  );
}

export function TemplateForm({ template }: { template?: TemplateRow }) {
  return (
    <JsonForm path="/api/admin/templates" transform={(d) => ({ id: template?.id ?? null, code: String(d.code), name: String(d.name), category: String(d.category), subject: String(d.subject), eyebrow: String(d.eyebrow ?? "") || null, title: String(d.title), body: String(d.body), ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null })} submitLabel={template ? "Save template" : "Create template"} successMessage={template ? "Template saved." : "Template created."}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Code"><input name="code" defaultValue={template?.code ?? ""} pattern="[a-z0-9_]{2,40}" className={`${inputCls} font-mono`} required /></Labelled>
        <Labelled label="Name"><input name="name" defaultValue={template?.name ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Category"><select name="category" defaultValue={template?.category ?? "marketing"} className={inputCls}><option value="marketing">Marketing</option><option value="lifecycle">Lifecycle</option><option value="billing">Billing</option><option value="transactional">Transactional</option></select></Labelled>
        <Labelled label="Eyebrow" hint="the small line above the title"><input name="eyebrow" defaultValue={template?.eyebrow ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Subject" className="sm:col-span-2"><input name="subject" defaultValue={template?.subject ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Title" className="sm:col-span-2"><input name="title" defaultValue={template?.title ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Body" className="sm:col-span-2"><textarea name="body" defaultValue={template?.body ?? ""} rows={8} className={inputCls} required /></Labelled>
        <p className="-mt-1.5 text-meta font-normal text-secondary sm:col-span-2">A blank line between paragraphs. Variables: <code className="font-mono text-xs">{"{{first_name}}"}</code>, <code className="font-mono text-xs">{"{{organization_name}}"}</code>, <code className="font-mono text-xs">{"{{plan_name}}"}</code>, <code className="font-mono text-xs">{"{{subscription_expiry}}"}</code>, <code className="font-mono text-xs">{"{{renewal_amount}}"}</code>, <code className="font-mono text-xs">{"{{app_url}}"}</code>.</p>
        <Labelled label="Button label"><input name="ctaLabel" defaultValue={template?.cta_label ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Button link"><input name="ctaUrl" defaultValue={template?.cta_url ?? ""} className={inputCls} placeholder="{{app_url}}/app" /></Labelled>
      </div>
    </JsonForm>
  );
}

/** Renders a template with sample values, on demand. */
export function TemplatePreview({ id, name }: { id: string; name?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  if (html) return <iframe title={name ? `Preview of ${name}` : "Preview"} srcDoc={html} sandbox="" className={cn(PREVIEW, "mt-3 h-[560px]")} />;
  return (
    <>
      <Button type="button" size="xs" variant="secondary" loading={state === "pending"} onClick={async () => { setState("pending"); try { const r = await api<{ html: string }>(`/api/admin/templates/${id}`); setHtml(r.html); setState("idle"); } catch { setState("failed"); } }}><Eye aria-hidden />Preview</Button>
      {state === "failed" ? <p role="alert" className="text-xs text-danger">The preview did not load. Try again.</p> : null}
    </>
  );
}

const AUDIENCES = [["all", "Every contact"], ["waitlist", "Waitlist (waiting and invited)"], ["users", "Product users"], ["free", "Free plan"], ["paid", "Paid plans"], ["trial", "On trial"], ["expiring", "Subscription expiring within 14 days"], ["segment", "A segment"]];

export function CampaignForm({ campaign, templates, segments }: { campaign?: CampaignRow; templates: TemplateRow[]; segments: { id: string; name: string; size: number }[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState(campaign?.audience.kind ?? "waitlist");
  return (
    <JsonForm path="/api/admin/campaigns" transform={(d) => ({ id: campaign?.id ?? null, name: String(d.name), subject: String(d.subject), templateId: String(d.templateId ?? "") || null, eyebrow: String(d.eyebrow ?? "") || null, title: String(d.title ?? "") || null, body: String(d.body ?? "") || null, ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null, audience: { kind: String(d.audience), segmentId: String(d.segmentId ?? "") || null } })} submitLabel={campaign ? "Save campaign" : "Create campaign"} successMessage={campaign ? "Campaign saved." : "Campaign created."} onDone={(r) => { const id = (r as { id: string }).id; router.push(`/admin/marketing/campaigns/${id}`); router.refresh(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Name" hint="internal"><input name="name" defaultValue={campaign?.name ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Subject"><input name="subject" defaultValue={campaign?.subject ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Audience"><select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} className={inputCls}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Labelled>
        {audience === "segment" ? <Labelled label="Segment"><select name="segmentId" defaultValue={campaign?.audience.segmentId ?? ""} className={inputCls} required>{segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.size})</option>)}</select></Labelled> : <div aria-hidden className="hidden sm:block" />}
        <Labelled label="Start from a template" hint="optional; anything set below overrides it" className="sm:col-span-2"><select name="templateId" defaultValue={campaign?.template_id ?? ""} className={inputCls}><option value="">None, write it below</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}</select></Labelled>
        <Labelled label="Eyebrow"><input name="eyebrow" defaultValue={campaign?.eyebrow ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Title"><input name="title" defaultValue={campaign?.title ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Body" className="sm:col-span-2"><textarea name="body" defaultValue={campaign?.body ?? ""} rows={8} className={inputCls} /></Labelled>
        <Labelled label="Button label"><input name="ctaLabel" defaultValue={campaign?.cta_label ?? ""} className={inputCls} /></Labelled>
        <Labelled label="Button link"><input name="ctaUrl" defaultValue={campaign?.cta_url ?? ""} className={inputCls} /></Labelled>
      </div>
    </JsonForm>
  );
}

/**
 * Preview, test send, schedule or send now, cancel. The send asks for confirmation and shows the audience size first.
 * "Send now" (or "Schedule") is the campaign page's one standout action: the orange button (accent rules).
 */
export function CampaignControls({ campaign, audienceSize, canSend }: { campaign: CampaignRow; audienceSize: number; canSend: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [test, setTest] = useState("");
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [when, setWhen] = useState("");
  const base = `/api/admin/campaigns/${campaign.id}/actions`;
  const draft = campaign.status === "draft" || campaign.status === "scheduled";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={previewing} onClick={async () => { setPreviewing(true); setMsg(null); try { const r = await api<{ html: string }>(base, { method: "POST", body: { action: "preview" } }); setHtml(r.html); } catch (err) { setMsg({ tone: "danger", text: isApiFailure(err) ? err.error.message : "The preview did not load." }); } finally { setPreviewing(false); } }}><Eye aria-hidden />Preview</Button>
        {canSend ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); setMsg(null); setTesting(true); try { await api(base, { method: "POST", body: { action: "test", to: test }, retries: 0 }); setMsg({ tone: "success", text: `Test sent to ${test}.` }); } catch (err) { setMsg({ tone: "danger", text: isApiFailure(err) ? err.error.message : "Could not send." }); } finally { setTesting(false); } }}>
            <input type="email" value={test} onChange={(e) => setTest(e.target.value)} placeholder="you@example.com" aria-label="Send a test to" className={cn(inputCls, "field-sm w-56")} required />
            <Button type="submit" size="sm" variant="secondary" loading={testing}><Send aria-hidden />Send test</Button>
          </form>
        ) : null}
        {campaign.status === "scheduled" && canSend ? <AdminAction path={base} body={{ action: "cancel" }} confirm={{ title: "Cancel the scheduled send?", label: "Cancel send" }} danger>Cancel schedule</AdminAction> : null}
      </div>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {draft && canSend ? (
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-fill-0 p-4">
          {/* How the count is worked out (unsubscribed left out, invalid addresses skipped) is a page note on the campaign page. */}
          <div className="min-w-0 max-w-md">
            <p className="text-sm font-medium text-foreground"><span className="tabular-nums">{audienceSize.toLocaleString()}</span> recipient{audienceSize === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Labelled label="Schedule" hint="optional"><DatePicker mode="datetime" value={when} onChange={(v) => setWhen(v)} size="sm" aria-label="Schedule" /></Labelled>
            <AdminAction path={base} body={{ action: "send", confirm: true, scheduledAt: when ? new Date(when).toISOString() : null }} variant="accent" confirm={{ title: when ? `Schedule for ${new Date(when).toLocaleString()}?` : `Send to ${audienceSize.toLocaleString()} people now?`, description: audienceSize > 500 ? "This is a large send. The worker delivers it in batches of 40; you can watch progress on this page." : "The worker delivers it in batches; you can watch progress on this page.", label: when ? "Schedule" : "Send now" }}>{when ? "Schedule" : "Send now"}</AdminAction>
          </div>
        </div>
      ) : null}
      {html ? <iframe title="Campaign preview" srcDoc={html} sandbox="" className={cn(PREVIEW, "h-[640px]")} /> : null}
    </div>
  );
}

export function AutomationForm({ automation, templates }: { automation?: AutomationRow; templates: TemplateRow[] }) {
  const [trigger, setTrigger] = useState(automation?.trigger ?? "account_age_days");
  const needsValue = ["account_age_days", "user_inactive_days", "subscription_expiring_days"].includes(trigger);
  return (
    <JsonForm path="/api/admin/automations" transform={(d) => ({ id: automation?.id ?? null, name: String(d.name), trigger: String(d.trigger), triggerValue: d.triggerValue ? Number(d.triggerValue) : null, templateId: String(d.templateId), enabled: d.enabled === "on" })} submitLabel={automation ? "Save" : "Create automation"} successMessage={automation ? "Automation saved." : "Automation created."}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Name" className="sm:col-span-2"><input name="name" defaultValue={automation?.name ?? ""} className={inputCls} required /></Labelled>
        <Labelled label="Trigger"><select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} className={inputCls}>
          <option value="user_created">User created (at once)</option><option value="account_age_days">Account reaches N days</option><option value="user_inactive_days">User inactive for N days</option><option value="subscription_expiring_days">Subscription expires in N days</option><option value="subscription_expired">Subscription expired</option><option value="payment_failed">Payment failed</option><option value="payment_successful">Payment successful</option><option value="waitlist_joined">Joined the waitlist</option><option value="waitlist_invited">Invited from waitlist</option>
        </select></Labelled>
        <Labelled label="N" hint="days"><input name="triggerValue" type="number" min={0} defaultValue={automation?.trigger_value ?? (needsValue ? 1 : "")} className={inputCls} disabled={!needsValue} /></Labelled>
        <Labelled label="Template" className="sm:col-span-2"><select name="templateId" defaultValue={automation?.template_id ?? ""} className={inputCls} required>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}</select></Labelled>
        <Switch name="enabled" defaultChecked={automation?.enabled ?? true} className="sm:col-span-2" hint="Off keeps it, without running it.">Enabled</Switch>
      </div>
    </JsonForm>
  );
}

export function ContactImportForm() {
  return (
    <JsonForm path="/api/admin/contacts" transform={(d) => ({ import: String(d.lines), source: String(d.source), isWaitlist: d.isWaitlist === "on" })} submitLabel="Import" successMessage="Imported.">
      <Labelled label="Contacts" hint="one per line: email, first name, last name, company"><textarea name="lines" rows={8} className={`${inputCls} font-mono text-xs`} placeholder="ada@example.com, Ada, Okafor, Acme Ltd" required /></Labelled>
      <Labelled label="Source"><input name="source" defaultValue="import" className={inputCls} /></Labelled>
      <Checkbox name="isWaitlist">Add to the waitlist</Checkbox>
    </JsonForm>
  );
}

/** Write one email. What a composed email looks like and how many templates exist are page notes on Communications. */
export function ComposeForm() {
  return (
    <JsonForm path="/api/admin/compose" transform={(d) => ({ to: String(d.to ?? "") || undefined, organisationId: String(d.organisationId ?? "") || undefined, templateId: String(d.templateId ?? "") || null, subject: String(d.subject), title: String(d.title ?? "") || undefined, body: String(d.body), ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null })} submitLabel="Send" successMessage="Sent.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="To" hint="one email address"><input name="to" type="email" className={inputCls} placeholder="name@example.com" /></Labelled>
        <Labelled label="Or an organisation id" hint="its owners and HR"><input name="organisationId" className={`${inputCls} font-mono`} /></Labelled>
        <Labelled label="Subject" className="sm:col-span-2"><input name="subject" className={inputCls} required /></Labelled>
        <Labelled label="Title" className="sm:col-span-2"><input name="title" className={inputCls} /></Labelled>
        <Labelled label="Message" className="sm:col-span-2"><textarea name="body" rows={8} className={inputCls} required /></Labelled>
        <Labelled label="Button label"><input name="ctaLabel" className={inputCls} /></Labelled>
        <Labelled label="Button link"><input name="ctaUrl" className={inputCls} /></Labelled>
        <input type="hidden" name="templateId" value="" />
      </div>
    </JsonForm>
  );
}
