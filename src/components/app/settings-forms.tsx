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
import { Segmented } from "@/components/ui/segmented";
import { SectionTitle } from "@/components/ui/card";
import { api, isApiFailure } from "@/lib/api-client";
import { dateOnly } from "@/lib/format";
import { TimePicker } from "@/components/ui/time-picker";
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
export function SettingsRow({ label, hint, htmlFor, labelId, error, children, className, align = "field", stacked = false }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; labelId?: string; error?: string | string[]; children?: ReactNode; className?: string; align?: "field" | "text"; stacked?: boolean }) {
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
    <div className={cn("grid gap-x-8 gap-y-2 px-5 py-4", !stacked && "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start", className)}>
      <div className={cn("min-w-0", !stacked && !text && "md:pt-2")}>
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
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES];
  return (
    <form className={SETTINGS_GROUP} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/settings/organisation`, { method: "PATCH", body: { name: f.get("name"), timezone: f.get("timezone") } }), "Organisation saved."); }}>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsRow label="Name" hint="How the organisation appears to everyone in it, and on invitations." htmlFor="o-name" error={fieldErrors.name}><Input id="o-name" name="name" defaultValue={name} required maxLength={160} autoComplete="organization" /></SettingsRow>
      <SettingsRow label="Time zone" hint="From today on. Timesheets, attendance and Brenda's daily report count days in this zone." htmlFor="o-tz" error={fieldErrors.timezone}><Select id="o-tz" name="timezone" defaultValue={timezone}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></SettingsRow>
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

// ---- Recording ----------------------------------------------------------------------------------------------------

const MODES = [
  { value: "disabled", label: "Off" },
  { value: "optional", label: "Each person's choice" },
  { value: "required_on_designated_tasks", label: "Required on marked tasks" },
];

/**
 * The recording switch: a segmented control with the three modes. Turning recording on, or between the two "on"
 * modes, happens at once; turning it off asks first. While the change is on its way the control shows the new
 * choice; if it fails it goes back and says why.
 */
export function RecordingSwitch({ orgSlug, mode }: { orgSlug: string; mode: string }) {
  const { pending, error, ok, submit } = useForm();
  const [target, setTarget] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  // When the page brings the saved mode back, it takes over from the optimistic choice.
  const [seen, setSeen] = useState(mode);
  if (seen !== mode) { setSeen(mode); setTarget(null); }
  const set = async (m: string) => {
    setTarget(m);
    const r = await submit(() => api(`/api/orgs/${orgSlug}/settings/recording`, { method: "POST", body: { mode: m } }), m === "disabled" ? "Screen recording is off." : "Screen recording is on. Each person can press Record screen while a timer runs; the first time, they read the notice and agree to it.");
    if (r === null) setTarget(null);
    return r;
  };
  return (
    <div className="grid gap-2">
      {/* No `name`: a named radio group moves its choice with the arrow keys, and here every choice is an organisation-wide
          change (a new notice version). Each mode is its own Tab stop, chosen with Space or a press. */}
      <Segmented aria-label="Screen recording" value={target ?? mode} disabled={pending}
        onChange={(v) => { if (v === (target ?? mode)) return; if (v === "disabled") setConfirmOff(true); else void set(v); }} options={MODES} />
      {error ? <p role="alert" className="text-meta font-medium text-danger">{error}</p> : null}
      <p role="status" aria-live="polite" className="text-meta font-normal text-secondary">{pending ? "Switching…" : ok}</p>
      <ConfirmDialog open={confirmOff} onClose={() => setConfirmOff(false)} title="Turn screen recording off for everyone?" description="Nobody can start a recording until it is turned on again. Existing recordings are kept until they expire." confirmLabel="Turn recording off" pendingLabel="Turning off…"
        onConfirm={() => set("disabled")} />
    </div>
  );
}

export function PolicyForm({ orgSlug, policy }: { orgSlug: string; policy: { recording_mode: string; retention_days: number; notice_text: string } | null }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const [draft, setDraft] = useState<FormData | null>(null);
  const publish = (f: FormData) => submit(() => api(`/api/orgs/${orgSlug}/settings/policy`, { method: "POST", body: { recordingMode: f.get("recordingMode"), retentionDays: Number(f.get("retentionDays")), noticeText: f.get("noticeText") } }), "New policy version published.");
  return (
    <>
      {/* The dialog sits outside the form: a <form> inside a <form> is invalid HTML and breaks hydration. */}
      <ConfirmDialog open={!!draft} onClose={() => setDraft(null)} tone="primary" title="Publish a new policy version?" description="Each person sees the new notice once, when they next start a recorded session, and agrees to it before anything is captured. Nothing else changes for them." confirmLabel="Publish version" pendingLabel="Publishing…" onConfirm={async () => { if (draft) await publish(draft); }} />
      <form className={SETTINGS_GROUP} onSubmit={(e) => { e.preventDefault(); setDraft(new FormData(e.currentTarget)); }}>
        {error ? <SettingsAlert>{error}</SettingsAlert> : null}
        <SettingsRow label="Recording" hint="The first time someone records under this notice, they read it and agree to it before anything is captured. Recordings are video only, started by the person, with a visible indicator." htmlFor="p-mode" error={fieldErrors.recordingMode}>
          <Select id="p-mode" name="recordingMode" defaultValue={policy?.recording_mode ?? "disabled"}><option value="disabled">Off: nobody can record</option><option value="optional">On: each person may press Record screen while a timer runs</option><option value="required_on_designated_tasks">On, and required on tasks marked recording required</option></Select>
        </SettingsRow>
        <SettingsRow label="Keep recordings for" hint="1 to 30 days in the pilot, then they are deleted automatically. Not a legal compliance claim." htmlFor="p-ret" error={fieldErrors.retentionDays}>
          <InputAdorned id="p-ret" name="retentionDays" type="number" inputMode="numeric" min={1} max={30} defaultValue={policy?.retention_days ?? 7} required suffix="days" className="sm:max-w-64" />
        </SettingsRow>
        <SettingsRow stacked label="Monitoring notice shown to employees" hint="At least 20 characters. Get it reviewed for your jurisdiction before a real employee pilot." htmlFor="p-notice" error={fieldErrors.noticeText}>
          <Textarea id="p-notice" name="noticeText" className="min-h-48" defaultValue={policy?.notice_text ?? ""} required minLength={20} maxLength={20000} />
        </SettingsRow>
        <SettingsRow label="Audio" hint="Never captured: audio capture is permanently disabled." align="text"><span className="text-secondary">Off, always</span></SettingsRow>
        <SettingsFooter status={ok}><Button type="submit" size="md" loading={pending}>{pending ? "Publishing…" : "Publish new version"}</Button></SettingsFooter>
      </form>
    </>
  );
}

const SCOPE_LABEL: Record<string, string> = { team: "Team recordings", organisation: "All recordings", privacy_admin: "Privacy administrator" };

export function GrantsPanel({ orgSlug, grants, members, teams, isOwner }: { orgSlug: string; grants: { id: string; grantee_name: string; scope_type: string; scope_name: string | null; granted_by_name: string; granted_at: string }[]; members: { id: string; display_name: string }[]; teams: { id: string; name: string }[]; isOwner: boolean }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const [scope, setScope] = useState("team");
  // A team grant needs a team to point at; say so instead of sending a grant the server will turn away.
  const blocked = members.length === 0 ? "Nobody else is in the workspace yet, so there is no one to grant access to." : scope === "team" && teams.length === 0 ? "There are no teams yet. Create one under People and teams, or grant all recordings instead." : null;
  return (
    <div className="grid gap-3">
      <div className={SETTINGS_GROUP}>
        {error ? <SettingsAlert>{error}</SettingsAlert> : null}
        {grants.length === 0 ? <p className="px-5 py-4 text-sm font-normal text-secondary">No extra grants. The person recorded, their team lead, HR and the owner can already watch; add a grant to let someone else.</p> : grants.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">{g.grantee_name}<Badge>{SCOPE_LABEL[g.scope_type] ?? g.scope_type}{g.scope_name ? `: ${g.scope_name}` : ""}</Badge></p>
              <p className="text-meta font-normal text-secondary">Granted by {g.granted_by_name}, <time dateTime={g.granted_at} suppressHydrationWarning>{dateOnly(g.granted_at)}</time></p>
            </div>
            {isOwner ? <ConfirmButton size="md" variant="danger" disabled={pending} title={`Revoke ${g.grantee_name}'s access?`} description={`${g.grantee_name} can no longer play ${g.scope_type === "team" && g.scope_name ? `${g.scope_name}'s recordings` : "these recordings"}. Their earlier plays stay in the audit log.`} confirmLabel="Revoke access" pendingLabel="Revoking…" onConfirm={() => submit(() => api(`/api/orgs/${orgSlug}/grants/${g.id}`, { method: "DELETE" }), `${g.grantee_name}'s access was revoked.`)}>Revoke</ConfirmButton> : null}
          </div>
        ))}
      </div>
      {isOwner ? (
        <form className={SETTINGS_GROUP} onSubmit={(e) => { e.preventDefault(); if (blocked) return; const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/grants`, { method: "POST", body: { granteeMembershipId: f.get("granteeMembershipId"), scopeType: f.get("scopeType"), scopeId: f.get("scopeId") || null } }), "Access granted. It is logged with your name."); }}>
          <SettingsRow label="Person" hint="Who gets to watch." htmlFor="g-who" error={fieldErrors.granteeMembershipId}><Select id="g-who" name="granteeMembershipId" disabled={!members.length}>{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></SettingsRow>
          <SettingsRow label="Can play" hint="One team's recordings, all of them, or privacy administration." htmlFor="g-scope" error={fieldErrors.scopeType}><Select id="g-scope" name="scopeType" value={scope} onChange={(e) => setScope(e.target.value)}>{Object.entries(SCOPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></SettingsRow>
          {scope === "team" ? <SettingsRow label="Team" htmlFor="g-team" error={fieldErrors.scopeId}><Select id="g-team" name="scopeId" disabled={!teams.length}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></SettingsRow> : null}
          {blocked ? <p className="px-5 py-3 text-sm font-normal text-secondary">{blocked}</p> : null}
          <SettingsFooter status={ok}><Button type="submit" size="md" variant="secondary" loading={pending} disabled={!!blocked}>{pending ? "Granting…" : "Grant access"}</Button></SettingsFooter>
        </form>
      ) : null}
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
      <SettingsRow label="Connection" hint="The key is tested with one request, then stored encrypted and never shown again." align="text">
        <span className="flex flex-wrap items-center gap-2"><Badge tone={status.source === "none" ? "warning" : "success"} dot>{status.source === "none" ? "Not connected" : "Connected"}</Badge><span className="text-secondary">{state}</span></span>
      </SettingsRow>
      <SettingsRow label="What is sent" hint="Each request Brenda makes to Anthropic is billed to this key." align="text">
        <span className="text-secondary">The request and what she needed to read for it, and only what the person asking is allowed to see.</span>
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
