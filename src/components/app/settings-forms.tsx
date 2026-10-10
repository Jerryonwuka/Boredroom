"use client";

/**
 * Settings forms, v4 (owner brief, 6 October 2026): every setting is a form row, the label and a hint on the left and
 * the control on the right (stacked on a phone), in a card whose rows are split by hairlines; a form ends in a footer
 * (fill-0) with what happened on the left and the action on the right. Errors sit at the top of their card and on the
 * field they belong to. The row parts are exported for the Settings and Profile pages and the other settings cards.
 */
import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Input, InputAdorned, Textarea, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/card";
import { api, isApiFailure } from "@/lib/api-client";
import { dateOnly } from "@/lib/format";
import { TimePicker } from "@/components/ui/time-picker";
import { useAssistant } from "@/components/app/assistant-context";
import { cn } from "@/lib/utils";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

// ---- The row parts ------------------------------------------------------------------------------------------------

/** The card that holds a set of rows: r16, the canvas colour, a hairline, rows split by hairlines. */
export const SETTINGS_GROUP = "card-panel divide-y divide-border p-0";

/** A section of a settings page: the section title (18/26 semibold) with an optional description and action, then its cards. */
export function SettingsSection({ id, title, description, action, children, className }: { id?: string; title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const auto = useId();
  const titleId = `${id ?? auto}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className={cn("scroll-mt-24", className)}>
      <SectionTitle id={titleId} title={title} description={description} action={action} />
      {children}
    </section>
  );
}

/** A card of rows (SETTINGS_GROUP as a component). */
export function SettingsGroup({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(SETTINGS_GROUP, className)} {...rest}>{children}</div>;
}

/**
 * One setting: the label (14/20 medium) and `hint` (13px, secondary) on the left, the control on the right; on a phone
 * the control sits under the label. With `htmlFor` the label is tied to the control, and the hint and `error` are
 * linked to it through aria-describedby (the control gets aria-invalid while there is an error). `align="text"` is
 * for a value shown as text rather than a 36px control. `stacked` puts the control under the label at every width (a
 * long text box).
 */
export function SettingsRow({ label, hint, htmlFor, labelId, error, children, className, align = "field", stacked = false, sideBySideAt = "viewport" }: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; labelId?: string; error?: string | string[]; children?: ReactNode; className?: string; align?: "field" | "text"; stacked?: boolean;
  /** When the label moves beside the control: at md of the window (the default), or once the card itself is 2xl (42rem)
   *  wide, for a card in an `@container` whose controls need the room (the assistant editor's cards; review, 7 October 2026). */
  sideBySideAt?: "viewport" | "container";
}) {
  const msg = Array.isArray(error) ? error[0] : error;
  const key = htmlFor ?? labelId;
  const hintId = key ? `${key}-hint` : undefined;
  const errorId = key ? `${key}-error` : undefined;
  const describedBy = [hint && hintId, msg && errorId].filter(Boolean).join(" ") || undefined;
  const control = htmlFor && isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { ...(msg ? { "aria-invalid": true } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) })
    : children;
  const text = align === "text";
  return (
    <div className={cn("grid gap-x-8 gap-y-2 px-5 py-4", !stacked && (sideBySideAt === "container" ? "@2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start" : "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start"), className)}>
      <div className={cn("min-w-0", !stacked && !text && (sideBySideAt === "container" ? "@2xl:pt-2" : "md:pt-2"))}>
        {htmlFor ? <label id={labelId} htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label> : <p id={labelId} className="text-sm font-medium text-foreground">{label}</p>}
        {hint ? <p id={hintId} className="mt-0.5 text-meta font-normal text-secondary">{hint}</p> : null}
      </div>
      <div className={cn("min-w-0", text && "text-sm font-normal text-foreground")}>
        {control}
        {msg ? <p id={errorId} role="alert" className="mt-1.5 text-meta font-medium text-danger">{msg}</p> : null}
      </div>
    </div>
  );
}

/**
 * The footer of a card of rows: what happened (announced) on the left, the actions on the right. `status` is a done
 * line (with a green tick); `busy` is a line while something is on its way ("Saving…"), shown instead.
 */
export function SettingsFooter({ status, busy, children, className }: { status?: ReactNode; busy?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-b-[15px] bg-fill-0 px-5 py-3", className)}>
      <p role="status" aria-live="polite" className="mr-auto flex min-h-5 min-w-0 items-center gap-1.5 text-meta font-normal text-secondary">
        {busy ? busy : status ? <><Check className="size-4 shrink-0 text-success" aria-hidden /><span className="min-w-0">{status}</span></> : null}
      </p>
      {children}
    </div>
  );
}

/** An error at the top of a card of rows. */
export function SettingsAlert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warning" | "info" | "success" }) {
  return <div className="px-5 py-4"><Alert tone={tone}>{children}</Alert></div>;
}

/**
 * Each settings form's state: pending (the button says what it is doing), saved (a quiet line in the footer until the
 * next change), or failed (the server's reason at the top of the card, with field errors tied to their fields).
 */
function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, okMsg = "Saved.") {
    setPending(true); setError(null); setOk(null); setFieldErrors({});
    try { const r = await fn(); setOk(okMsg); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError(OFFLINE); return null; }
    finally { setPending(false); }
  }
  /** A problem found before anything is sent: shown on the field, nothing goes to the server. */
  const reject = (field: string, message: string) => { setOk(null); setError(null); setFieldErrors({ [field]: [message] }); };
  return { pending, error, ok, fieldErrors, submit, reject };
}

// ---- General ------------------------------------------------------------------------------------------------------

const ZONES = ["Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];

export function OrgSettingsForm({ orgSlug, name, timezone }: { orgSlug: string; name: string; timezone: string }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  // The daily report goes out signed by the workspace's own assistant (owner decision, 7 October 2026: personal assistants).
  const { workspace } = useAssistant();
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES];
  return (
    <form className={SETTINGS_GROUP} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/settings/organisation`, { method: "PATCH", body: { name: f.get("name"), timezone: f.get("timezone") } }), "Organisation saved."); }}>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsRow label="Name" hint="How the organisation appears to everyone in it, and on invitations." htmlFor="o-name" error={fieldErrors.name}><Input id="o-name" name="name" defaultValue={name} required maxLength={160} autoComplete="organization" /></SettingsRow>
      <SettingsRow label="Time zone" hint={`From today on. Timesheets, attendance and ${workspace.name}'s daily report count days in this zone.`} htmlFor="o-tz" error={fieldErrors.timezone}><Select id="o-tz" name="timezone" defaultValue={timezone}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></SettingsRow>
      <SettingsFooter status={ok}><Button type="submit" size="md" loading={pending}>{pending ? "Saving…" : "Save organisation"}</Button></SettingsFooter>
    </form>
  );
}

// ---- Working hours ------------------------------------------------------------------------------------------------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as people read a working week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function ScheduleForm({ orgSlug, schedule }: { orgSlug: string; schedule: { working_days: number[]; start_local: string; end_local: string; clock_grace_minutes?: number } | null }) {
  const { pending, error, ok, fieldErrors, submit, reject } = useForm();
  const days = schedule?.working_days ?? [1, 2, 3, 4, 5];
  const daysError = fieldErrors.workingDays?.[0];
  const daysLabel = useId();
  return (
    <form className={SETTINGS_GROUP} onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const workingDays = f.getAll("days").map(Number);
      if (!workingDays.length) { reject("workingDays", "Choose at least one working day."); return; }
      submit(() => api(`/api/orgs/${orgSlug}/settings/schedule`, { method: "PUT", body: { workingDays, startLocal: f.get("start"), endLocal: f.get("end"), graceMinutes: Number(f.get("grace") || 0) } }), "Schedule saved. It applies from today.");
    }}>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsRow label="Working days" hint="The days people are expected to clock in." labelId={daysLabel} error={daysError}>
        {/* A segmented strip of checkboxes: any number of days can be on. */}
        <div role="group" aria-labelledby={daysLabel} aria-describedby={daysError ? `${daysLabel}-error` : `${daysLabel}-hint`} className="segmented">
          {WEEK.map((i) => (
            <label key={i} className="segmented-item"><input type="checkbox" name="days" value={i} defaultChecked={days.includes(i)} aria-label={DAY_NAMES[i]} /><span aria-hidden>{DAYS[i]}</span></label>
          ))}
        </div>
      </SettingsRow>
      <SettingsRow label="Clock in by" hint="The start of the working day." htmlFor="s-start" error={fieldErrors.startLocal}><TimePicker id="s-start" name="start" defaultValue={(schedule?.start_local ?? "09:00").slice(0, 5)} required className="sm:max-w-64" /></SettingsRow>
      <SettingsRow label="Clock out at" hint="The end of the working day." htmlFor="s-end" error={fieldErrors.endLocal}><TimePicker id="s-end" name="end" defaultValue={(schedule?.end_local ?? "17:00").slice(0, 5)} required className="sm:max-w-64" /></SettingsRow>
      <SettingsRow label="Late after" hint="A grace period. A clock-in after the start plus this many minutes is flagged late on the Attendance page; never an automatic pay rule." htmlFor="s-grace" error={fieldErrors.graceMinutes}>
        <InputAdorned id="s-grace" name="grace" type="number" inputMode="numeric" min={0} max={180} defaultValue={schedule?.clock_grace_minutes ?? 0} suffix="minutes" className="sm:max-w-64" />
      </SettingsRow>
      <SettingsFooter status={ok}><Button type="submit" size="md" loading={pending}>{pending ? "Saving…" : "Save schedule"}</Button></SettingsFooter>
    </form>
  );
}

// ---- Monitoring notice -------------------------------------------------------------------------------------------

/**
 * The monitoring notice (owner decisions, 8 October 2026: phase 8, A.3.4): the notice text and how long before the end
 * of the working day people are reminded, published as a new version. The recording mode, retention and audio rows went
 * with screen recording; nobody is asked to agree any more, everyone is told the notice changed.
 */
export function PolicyForm({ orgSlug, policy }: { orgSlug: string; policy: { notice_text: string; reminder_minutes_before_end: number } | null }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const [draft, setDraft] = useState<FormData | null>(null);
  const publish = (f: FormData) => submit(() => api(`/api/orgs/${orgSlug}/settings/policy`, { method: "POST", body: { noticeText: f.get("noticeText"), reminderMinutesBeforeEnd: Number(f.get("reminderMinutesBeforeEnd")) } }), "New notice version published.");
  return (
    <>
      {/* The dialog sits outside the form: a <form> inside a <form> is invalid HTML and breaks hydration. */}
      <ConfirmDialog open={!!draft} onClose={() => setDraft(null)} tone="primary" title="Publish a new notice version?" description="Everyone in the workspace is told the notice changed and can read it in their profile. Nothing else changes for them." confirmLabel="Publish version" pendingLabel="Publishing…" onConfirm={async () => { if (draft) await publish(draft); }} />
      <form className={SETTINGS_GROUP} onSubmit={(e) => { e.preventDefault(); setDraft(new FormData(e.currentTarget)); }}>
        {error ? <SettingsAlert>{error}</SettingsAlert> : null}
        <SettingsRow stacked label="Monitoring notice shown to employees" hint="At least 20 characters. Get it reviewed for your jurisdiction before a real employee pilot." htmlFor="p-notice" error={fieldErrors.noticeText}>
          <Textarea id="p-notice" name="noticeText" className="min-h-48" defaultValue={policy?.notice_text ?? ""} required minLength={20} maxLength={20000} />
        </SettingsRow>
        <SettingsRow label="Remind people before the end of their day" hint="0 to 240 minutes; 0 sends no reminder." htmlFor="p-remind" error={fieldErrors.reminderMinutesBeforeEnd}>
          <InputAdorned id="p-remind" name="reminderMinutesBeforeEnd" type="number" inputMode="numeric" min={0} max={240} defaultValue={policy?.reminder_minutes_before_end ?? 30} required suffix="minutes" className="sm:max-w-64" />
        </SettingsRow>
        <SettingsFooter status={ok}><Button type="submit" size="md" loading={pending}>{pending ? "Publishing…" : "Publish new version"}</Button></SettingsFooter>
      </form>
    </>
  );
}

/**
 * "Use the new standard notice" (owner decision, 8 October 2026: D12): shown while the current notice still describes
 * screen recording. Publishes the standard text as a new version through the same route (owners only), keeping the
 * reminder as it is.
 */
export function StandardNoticeButton({ orgSlug, text, reminderMinutesBeforeEnd }: { orgSlug: string; text: string; reminderMinutesBeforeEnd: number }) {
  const { pending, error, ok, submit } = useForm();
  return (
    <div className="mt-3 grid justify-items-start gap-2">
      <ConfirmButton size="sm" variant="secondary" tone="primary" disabled={pending} title="Use the new standard notice?" description="Everyone in the workspace is told the notice changed." confirmLabel="Publish it" pendingLabel="Publishing…"
        onConfirm={() => submit(() => api(`/api/orgs/${orgSlug}/settings/policy`, { method: "POST", body: { noticeText: text, reminderMinutesBeforeEnd } }), "The new standard notice is published.")}>Use the new standard notice</ConfirmButton>
      {error ? <p role="alert" className="text-meta font-medium text-danger">{error}</p> : null}
      {ok ? <p role="status" className="text-meta font-normal text-secondary">{ok}</p> : null}
    </div>
  );
}

// ---- Brenda's AI connection ---------------------------------------------------------------------------------------

type AiStatus = { source: "organisation" | "environment" | "none"; hint: string | null; model: string | null; connectedAt: string | null };

/** Connect / replace / remove the organisation's Anthropic API key. */
export function AssistantConnectionForm({ orgSlug, status }: { orgSlug: string; status: AiStatus }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(status.source !== "organisation");
  const [reply, setReply] = useState<string | null>(null);
  const state = status.source === "organisation"
    ? <>Key ending <span className="font-mono tabular-nums">{status.hint}</span>, {status.model}{status.connectedAt ? <>, connected <time dateTime={status.connectedAt} suppressHydrationWarning>{dateOnly(status.connectedAt)}</time></> : ""}</>
    : status.source === "environment" ? "Using the server's ANTHROPIC_API_KEY. Add an organisation key to override it." : "Not connected. A simple built-in helper answers and only suggests.";
  return (
    <div className={SETTINGS_GROUP}>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      {ok && reply ? <SettingsAlert tone="success">Claude says: “{reply}”</SettingsAlert> : null}
      {/* How the key is kept, what each request sends and who pays for it are page notes on Settings, Brenda. */}
      <SettingsRow label="Connection" align="text">
        <span className="flex flex-wrap items-center gap-2"><Badge tone={status.source === "none" ? "warning" : "success"} dot>{status.source === "none" ? "Not connected" : "Connected"}</Badge><span className="text-secondary">{state}</span></span>
      </SettingsRow>
      {open ? (
        <form className="divide-y divide-border" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; setReply(null); submit(async () => { const r = await api<{ model: string; reply: string }>(`/api/orgs/${orgSlug}/settings/assistant`, { method: "POST", body: { apiKey: f.get("apiKey"), model: f.get("model") || undefined } }); setReply(r.reply); form.reset(); setOpen(false); return r; }, "Connected. Brenda now runs on Claude."); }}>
          <SettingsRow label="Anthropic API key" hint="From console.anthropic.com under API keys; starts with sk-ant-." htmlFor="ai-key" error={fieldErrors.apiKey}><Input id="ai-key" name="apiKey" type="password" autoComplete="off" required minLength={20} placeholder="sk-ant-…" className="font-mono" /></SettingsRow>
          <SettingsRow label="Model" hint="Optional." htmlFor="ai-model" error={fieldErrors.model}><Select id="ai-model" name="model" defaultValue=""><option value="">Claude Opus 5.5 (default)</option><option value="claude-sonnet-5">Claude Sonnet 5 (faster, cheaper)</option><option value="claude-opus-5-5">Claude Opus 5.5</option><option value="claude-opus-5">Claude Opus 5</option></Select></SettingsRow>
          <SettingsFooter status={ok}>
            {status.source === "organisation" ? <Button type="button" size="md" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button> : null}
            <Button type="submit" size="md" loading={pending}>{pending ? "Testing…" : "Connect and test"}</Button>
          </SettingsFooter>
        </form>
      ) : (
        <SettingsFooter status={ok}>
          <ConfirmButton size="md" variant="danger" disabled={pending} title="Disconnect Brenda from Claude?" description="The stored key is deleted. Until a key is added again, a simple built-in helper answers and only suggests." confirmLabel="Disconnect" pendingLabel="Disconnecting…" onConfirm={() => submit(() => api(`/api/orgs/${orgSlug}/settings/assistant`, { method: "DELETE" }), "Disconnected. The built-in helper answers until a key is added.")}>Disconnect</ConfirmButton>
          <Button size="md" variant="secondary" onClick={() => setOpen(true)}>Replace key</Button>
        </SettingsFooter>
      )}
    </div>
  );
}
