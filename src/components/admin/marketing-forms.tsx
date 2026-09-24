"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminAction, JsonForm, inputCls } from "@/components/admin/actions";
import { Button } from "@/components/ui/button";
import { api, isApiFailure } from "@/lib/api-client";
import type { SegmentRule, TemplateRow, CampaignRow, AutomationRow } from "@/server/admin/marketing";

const FIELDS: { value: SegmentRule["field"]; label: string; kind: "text" | "number" | "bool" | "status" }[] = [
  { value: "status", label: "Contact status", kind: "status" }, { value: "is_waitlist", label: "On the waitlist", kind: "bool" }, { value: "source", label: "Source", kind: "text" }, { value: "company_size", label: "Company size", kind: "text" }, { value: "country", label: "Country", kind: "text" }, { value: "role", label: "Workspace role", kind: "text" }, { value: "plan", label: "Plan code", kind: "text" }, { value: "subscription_status", label: "Subscription status", kind: "text" }, { value: "account_age_days", label: "Account age, days", kind: "number" }, { value: "expires_within_days", label: "Subscription expires within days", kind: "number" }, { value: "inactive_days", label: "Inactive for days", kind: "number" },
];

export function SegmentForm({ segment }: { segment?: { id: string; name: string; description: string | null; rules: SegmentRule[] } }) {
  const [rules, setRules] = useState<SegmentRule[]>(segment?.rules ?? []);
  return (
    <JsonForm path="/api/admin/segments" transform={(d) => ({ id: segment?.id ?? null, name: String(d.name), description: String(d.description ?? "") || null, rules })} submitLabel={segment ? "Save segment" : "Create segment"}>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><span>Name</span><input name="name" defaultValue={segment?.name ?? ""} className={inputCls} required /></label><label className="grid gap-1 text-sm"><span>Description</span><input name="description" defaultValue={segment?.description ?? ""} className={inputCls} /></label></div>
      <div className="space-y-2">
        <p className="eyebrow">Conditions (all must hold)</p>
        {rules.map((r, i) => { const f = FIELDS.find((x) => x.value === r.field)!; return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={r.field} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { field: e.target.value as SegmentRule["field"], op: "eq", value: "" } : x)))} className={inputCls}>{FIELDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
            <select value={r.op} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, op: e.target.value as SegmentRule["op"] } : x)))} className={inputCls}>{(f.kind === "number" ? ["eq", "gte", "lte"] : f.kind === "bool" ? ["eq"] : ["eq", "neq", "contains"]).map((o) => <option key={o} value={o}>{{ eq: "is", neq: "is not", gte: "at least", lte: "at most", contains: "contains" }[o]}</option>)}</select>
            {f.kind === "bool" ? <select value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value === "true" } : x)))} className={inputCls}><option value="true">yes</option><option value="false">no</option></select>
              : f.kind === "status" ? <select value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={inputCls}>{["waiting", "invited", "registered", "activated", "trial", "paid", "unsubscribed"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
              : <input type={f.kind === "number" ? "number" : "text"} value={String(r.value)} onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: f.kind === "number" ? Number(e.target.value) : e.target.value } : x)))} className={inputCls} />}
            <Button type="button" size="sm" variant="ghost" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ); })}
        <Button type="button" size="sm" variant="subtle" onClick={() => setRules((rs) => [...rs, { field: "status", op: "eq", value: "waiting" }])}>Add condition</Button>
      </div>
    </JsonForm>
  );
}

export function TemplateForm({ template }: { template?: TemplateRow }) {
  return (
    <JsonForm path="/api/admin/templates" transform={(d) => ({ id: template?.id ?? null, code: String(d.code), name: String(d.name), category: String(d.category), subject: String(d.subject), eyebrow: String(d.eyebrow ?? "") || null, title: String(d.title), body: String(d.body), ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null })} submitLabel={template ? "Save template" : "Create template"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>Code</span><input name="code" defaultValue={template?.code ?? ""} pattern="[a-z0-9_]{2,40}" className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Name</span><input name="name" defaultValue={template?.name ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Category</span><select name="category" defaultValue={template?.category ?? "marketing"} className={inputCls}><option value="marketing">Marketing</option><option value="lifecycle">Lifecycle</option><option value="billing">Billing</option><option value="transactional">Transactional</option></select></label>
        <label className="grid gap-1 text-sm"><span>Eyebrow</span><input name="eyebrow" defaultValue={template?.eyebrow ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Subject</span><input name="subject" defaultValue={template?.subject ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Title</span><input name="title" defaultValue={template?.title ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Body <span className="text-fg-subtle">(blank line between paragraphs; variables like {"{{first_name}}"}, {"{{organization_name}}"}, {"{{plan_name}}"}, {"{{subscription_expiry}}"}, {"{{renewal_amount}}"}, {"{{app_url}}"})</span></span><textarea name="body" defaultValue={template?.body ?? ""} rows={8} className="rounded-[var(--radius-sm)] border border-border-strong bg-inset px-3 py-2 text-sm text-fg" required /></label>
        <label className="grid gap-1 text-sm"><span>Button label</span><input name="ctaLabel" defaultValue={template?.cta_label ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Button link</span><input name="ctaUrl" defaultValue={template?.cta_url ?? ""} className={inputCls} placeholder="{{app_url}}/app" /></label>
      </div>
    </JsonForm>
  );
}

export function TemplatePreview({ id }: { id: string }) {
  const [html, setHtml] = useState<string | null>(null);
  return html ? <iframe title="Preview" srcDoc={html} sandbox="" className="mt-3 h-[560px] w-full rounded-[var(--radius-sm)] border border-border bg-black" /> : <Button type="button" size="sm" variant="ghost" onClick={async () => { const r = await api<{ html: string }>(`/api/admin/templates/${id}`); setHtml(r.html); }}>Preview</Button>;
}

const AUDIENCES = [["all", "Every contact"], ["waitlist", "Waitlist (waiting and invited)"], ["users", "Product users"], ["free", "Free plan"], ["paid", "Paid plans"], ["trial", "On trial"], ["expiring", "Subscription expiring within 14 days"], ["segment", "A segment"]];

export function CampaignForm({ campaign, templates, segments }: { campaign?: CampaignRow; templates: TemplateRow[]; segments: { id: string; name: string; size: number }[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState(campaign?.audience.kind ?? "waitlist");
  return (
    <JsonForm path="/api/admin/campaigns" transform={(d) => ({ id: campaign?.id ?? null, name: String(d.name), subject: String(d.subject), templateId: String(d.templateId ?? "") || null, eyebrow: String(d.eyebrow ?? "") || null, title: String(d.title ?? "") || null, body: String(d.body ?? "") || null, ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null, audience: { kind: String(d.audience), segmentId: String(d.segmentId ?? "") || null } })} submitLabel={campaign ? "Save campaign" : "Create campaign"} onDone={(r) => { const id = (r as { id: string }).id; router.push(`/admin/marketing/campaigns/${id}`); router.refresh(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>Name <span className="text-fg-subtle">(internal)</span></span><input name="name" defaultValue={campaign?.name ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Subject</span><input name="subject" defaultValue={campaign?.subject ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Audience</span><select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} className={inputCls}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {audience === "segment" ? <label className="grid gap-1 text-sm"><span>Segment</span><select name="segmentId" defaultValue={campaign?.audience.segmentId ?? ""} className={inputCls} required>{segments.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.size})</option>)}</select></label> : <div />}
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Start from a template <span className="text-fg-subtle">(optional; anything set below overrides it)</span></span><select name="templateId" defaultValue={campaign?.template_id ?? ""} className={inputCls}><option value="">None, write it below</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}</select></label>
        <label className="grid gap-1 text-sm"><span>Eyebrow</span><input name="eyebrow" defaultValue={campaign?.eyebrow ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Title</span><input name="title" defaultValue={campaign?.title ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Body</span><textarea name="body" defaultValue={campaign?.body ?? ""} rows={8} className="rounded-[var(--radius-sm)] border border-border-strong bg-inset px-3 py-2 text-sm text-fg" /></label>
        <label className="grid gap-1 text-sm"><span>Button label</span><input name="ctaLabel" defaultValue={campaign?.cta_label ?? ""} className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Button link</span><input name="ctaUrl" defaultValue={campaign?.cta_url ?? ""} className={inputCls} /></label>
      </div>
    </JsonForm>
  );
}

/** Preview, test send, schedule or send now, cancel. The send asks for confirmation and shows the audience size first. */
export function CampaignControls({ campaign, audienceSize, unsubscribed, canSend }: { campaign: CampaignRow; audienceSize: number; unsubscribed: number; canSend: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [test, setTest] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const base = `/api/admin/campaigns/${campaign.id}/actions`;
  const draft = campaign.status === "draft" || campaign.status === "scheduled";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={async () => { const r = await api<{ html: string }>(base, { method: "POST", body: { action: "preview" } }); setHtml(r.html); }}>Preview</Button>
        {canSend ? <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); setMsg(null); try { await api(base, { method: "POST", body: { action: "test", to: test }, retries: 0 }); setMsg(`Test sent to ${test}.`); } catch (err) { setMsg(isApiFailure(err) ? err.error.message : "Could not send."); } }}><input type="email" value={test} onChange={(e) => setTest(e.target.value)} placeholder="you@example.com" className={inputCls} required /><Button type="submit" size="sm" variant="outline">Send test</Button></form> : null}
        {campaign.status === "scheduled" && canSend ? <AdminAction path={base} body={{ action: "cancel" }} confirm={{ title: "Cancel the scheduled send?", label: "Cancel send" }} danger>Cancel schedule</AdminAction> : null}
      </div>
      {msg ? <p className="text-sm text-fg-muted">{msg}</p> : null}
      {draft && canSend ? (
        <div className="chip flex flex-wrap items-end gap-3 p-3">
          <div className="text-sm"><p className="font-semibold">{audienceSize.toLocaleString()} recipient{audienceSize === 1 ? "" : "s"}</p><p className="text-xs text-fg-subtle">{unsubscribed.toLocaleString()} unsubscribed contacts are excluded automatically; invalid addresses are skipped at send time.</p></div>
          <label className="grid gap-1 text-xs text-fg-subtle"><span>Schedule (optional)</span><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} /></label>
          <AdminAction path={base} body={{ action: "send", confirm: true, scheduledAt: when ? new Date(when).toISOString() : null }} variant="primary" confirm={{ title: when ? `Schedule for ${new Date(when).toLocaleString()}?` : `Send to ${audienceSize.toLocaleString()} people now?`, description: audienceSize > 500 ? "This is a large send. The worker delivers it in batches of 40; you can watch progress on this page." : "The worker delivers it in batches; you can watch progress on this page.", label: when ? "Schedule" : "Send now" }}>{when ? "Schedule" : "Send now"}</AdminAction>
        </div>
      ) : null}
      {html ? <iframe title="Campaign preview" srcDoc={html} sandbox="" className="h-[640px] w-full rounded-[var(--radius-sm)] border border-border bg-black" /> : null}
    </div>
  );
}

export function AutomationForm({ automation, templates }: { automation?: AutomationRow; templates: TemplateRow[] }) {
  const [trigger, setTrigger] = useState(automation?.trigger ?? "account_age_days");
  const needsValue = ["account_age_days", "user_inactive_days", "subscription_expiring_days"].includes(trigger);
  return (
    <JsonForm path="/api/admin/automations" transform={(d) => ({ id: automation?.id ?? null, name: String(d.name), trigger: String(d.trigger), triggerValue: d.triggerValue ? Number(d.triggerValue) : null, templateId: String(d.templateId), enabled: d.enabled === "on" })} submitLabel={automation ? "Save" : "Create automation"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Name</span><input name="name" defaultValue={automation?.name ?? ""} className={inputCls} required /></label>
        <label className="grid gap-1 text-sm"><span>Trigger</span><select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} className={inputCls}>
          <option value="user_created">User created (at once)</option><option value="account_age_days">Account reaches N days</option><option value="user_inactive_days">User inactive for N days</option><option value="subscription_expiring_days">Subscription expires in N days</option><option value="subscription_expired">Subscription expired</option><option value="payment_failed">Payment failed</option><option value="payment_successful">Payment successful</option><option value="waitlist_joined">Joined the waitlist</option>
        </select></label>
        <label className="grid gap-1 text-sm"><span>N (days)</span><input name="triggerValue" type="number" min={0} defaultValue={automation?.trigger_value ?? (needsValue ? 1 : "")} className={inputCls} disabled={!needsValue} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Template</span><select name="templateId" defaultValue={automation?.template_id ?? ""} className={inputCls} required>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={automation?.enabled ?? true} className="size-4 accent-[var(--accent)]" />Enabled</label>
      </div>
    </JsonForm>
  );
}

export function ContactImportForm() {
  return (
    <JsonForm path="/api/admin/contacts" transform={(d) => ({ import: String(d.lines), source: String(d.source), isWaitlist: d.isWaitlist === "on" })} submitLabel="Import" successMessage="Imported.">
      <label className="grid gap-1 text-sm"><span>One contact per line: email, first name, last name, company</span><textarea name="lines" rows={6} className="rounded-[var(--radius-sm)] border border-border-strong bg-inset px-3 py-2 font-mono text-xs text-fg" placeholder="ada@example.com, Ada, Okafor, Acme Ltd" required /></label>
      <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm"><span>Source</span><input name="source" defaultValue="import" className={inputCls} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isWaitlist" className="size-4 accent-[var(--accent)]" />Add to the waitlist</label></div>
    </JsonForm>
  );
}

export function ComposeForm({ templates }: { templates: TemplateRow[] }) {
  return (
    <JsonForm path="/api/admin/compose" transform={(d) => ({ to: String(d.to ?? "") || undefined, organisationId: String(d.organisationId ?? "") || undefined, templateId: String(d.templateId ?? "") || null, subject: String(d.subject), title: String(d.title ?? "") || undefined, body: String(d.body), ctaLabel: String(d.ctaLabel ?? "") || null, ctaUrl: String(d.ctaUrl ?? "") || null })} submitLabel="Send" successMessage="Sent.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>To (email)</span><input name="to" type="email" className={inputCls} placeholder="one person" /></label>
        <label className="grid gap-1 text-sm"><span>Or an organisation id <span className="text-fg-subtle">(its owners and HR)</span></span><input name="organisationId" className={inputCls} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Subject</span><input name="subject" className={inputCls} required /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Title</span><input name="title" className={inputCls} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Message</span><textarea name="body" rows={8} className="rounded-[var(--radius-sm)] border border-border-strong bg-inset px-3 py-2 text-sm text-fg" required /></label>
        <label className="grid gap-1 text-sm"><span>Button label</span><input name="ctaLabel" className={inputCls} /></label>
        <label className="grid gap-1 text-sm"><span>Button link</span><input name="ctaUrl" className={inputCls} /></label>
        <input type="hidden" name="templateId" value="" />
      </div>
      <p className="text-xs text-fg-subtle">{templates.length} templates exist for campaigns and automations; a composed email uses the design-system layout with what you write here.</p>
    </JsonForm>
  );
}
