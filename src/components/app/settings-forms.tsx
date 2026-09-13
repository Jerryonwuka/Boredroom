"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { api, isApiFailure } from "@/lib/api-client";

function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, okMsg = "Saved.") {
    setPending(true); setError(null); setOk(null); setFieldErrors({});
    try { const r = await fn(); setOk(okMsg); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, ok, fieldErrors, submit };
}

const ZONES = ["Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];

export function OrgSettingsForm({ orgSlug, name, timezone }: { orgSlug: string; name: string; timezone: string }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const zones = ZONES.includes(timezone) ? ZONES : [timezone, ...ZONES];
  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/settings/organisation`, { method: "PATCH", body: { name: f.get("name"), timezone: f.get("timezone") } })); }}>
      {error ? <Alert tone="danger" className="md:col-span-2">{error}</Alert> : null}{ok ? <Alert tone="success" className="md:col-span-2">{ok}</Alert> : null}
      <Field label="Name" htmlFor="o-name" error={fieldErrors.name}><Input id="o-name" name="name" defaultValue={name} required /></Field>
      <Field label="Time zone" htmlFor="o-tz" hint="applies prospectively; submitted reports keep their zone" error={fieldErrors.timezone}><Select id="o-tz" name="timezone" defaultValue={timezone}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></Field>
      <div><Button type="submit" disabled={pending}>Save</Button></div>
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function ScheduleForm({ orgSlug, schedule }: { orgSlug: string; schedule: { working_days: number[]; start_local: string; end_local: string } | null }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  const days = schedule?.working_days ?? [1, 2, 3, 4, 5];
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/settings/schedule`, { method: "PUT", body: { workingDays: f.getAll("days").map(Number), startLocal: f.get("start"), endLocal: f.get("end") } })); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}{ok ? <Alert tone="success">{ok}</Alert> : null}
      <fieldset><legend className="mb-1 text-sm font-semibold text-fg-muted">Working days</legend><div className="flex flex-wrap gap-3 text-sm">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="days" value={i} defaultChecked={days.includes(i)} /> {d}</label>)}</div></fieldset>
      <div className="grid grid-cols-2 gap-3 md:w-80">
        <Field label="Start" htmlFor="s-start"><Input id="s-start" name="start" type="time" defaultValue={(schedule?.start_local ?? "09:00").slice(0, 5)} required /></Field>
        <Field label="End" htmlFor="s-end" error={fieldErrors.endLocal}><Input id="s-end" name="end" type="time" defaultValue={(schedule?.end_local ?? "17:00").slice(0, 5)} required /></Field>
      </div>
      <div><Button type="submit" disabled={pending}>Save schedule</Button></div>
    </form>
  );
}

export function PolicyForm({ orgSlug, policy }: { orgSlug: string; policy: { recording_mode: string; retention_days: number; notice_text: string; reminder_minutes_before_end: number } | null }) {
  const { pending, error, ok, fieldErrors, submit } = useForm();
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (!confirm("Publish a new policy version? Every member must acknowledge it before recorded work.")) return; submit(() => api(`/api/orgs/${orgSlug}/settings/policy`, { method: "POST", body: { recordingMode: f.get("recordingMode"), retentionDays: Number(f.get("retentionDays")), noticeText: f.get("noticeText"), reminderMinutesBeforeEnd: Number(f.get("reminder")) } }), "New policy version published."); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}{ok ? <Alert tone="success">{ok}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Recording" htmlFor="p-mode"><Select id="p-mode" name="recordingMode" defaultValue={policy?.recording_mode ?? "disabled"}><option value="disabled">Off — nobody can record</option><option value="optional">On — staff and team leads get a “Record screen” button while a timer runs (their choice)</option><option value="required_on_designated_tasks">On, and required on tasks marked “recording required”</option></Select></Field>
        <p className="-mt-1 text-xs text-fg-subtle">Recording is off for new organisations. Switch it on here; each person must acknowledge the notice below before they can record. Recordings are video only, started by the person, with a visible indicator.</p>
        <Field label="Retention (days)" htmlFor="p-ret" hint="1–30" error={fieldErrors.retentionDays}><Input id="p-ret" name="retentionDays" type="number" min={1} max={30} defaultValue={policy?.retention_days ?? 7} required /></Field>
        <Field label="Reminder before day end (min)" htmlFor="p-rem"><Input id="p-rem" name="reminder" type="number" min={0} max={240} defaultValue={policy?.reminder_minutes_before_end ?? 30} /></Field>
      </div>
      <Field label="Monitoring notice shown to employees" htmlFor="p-notice" error={fieldErrors.noticeText}><Textarea id="p-notice" name="noticeText" className="min-h-48" defaultValue={policy?.notice_text ?? ""} required minLength={20} /></Field>
      <p className="text-xs text-fg-subtle">Audio capture is permanently disabled. Get the notice reviewed for your jurisdiction before a real employee pilot.</p>
      <div><Button type="submit" disabled={pending}>Publish new version</Button></div>
    </form>
  );
}

export function GrantsPanel({ orgSlug, grants, members, teams, isOwner }: { orgSlug: string; grants: { id: string; grantee_name: string; scope_type: string; scope_name: string | null; granted_by_name: string; granted_at: string }[]; members: { id: string; display_name: string }[]; teams: { id: string; name: string }[]; isOwner: boolean }) {
  const { pending, error, ok, submit } = useForm();
  const [scope, setScope] = useState("team");
  return (
    <div>
      {error ? <Alert tone="danger" className="mb-2">{error}</Alert> : null}{ok ? <Alert tone="success" className="mb-2">{ok}</Alert> : null}
      <ul className="mb-3 divide-y divide-border">
        {grants.length === 0 ? <li className="py-2 text-sm text-fg-muted">No grants. Nobody can play back recordings except the person recorded.</li> : grants.map((g) => (
          <li key={g.id} className="flex items-center justify-between py-2 text-sm"><span>{g.grantee_name} <Badge tone="accent">{g.scope_type.replace("_", " ")}{g.scope_name ? `: ${g.scope_name}` : ""}</Badge> <span className="text-fg-subtle">by {g.granted_by_name}</span></span>{isOwner ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(() => api(`/api/orgs/${orgSlug}/grants/${g.id}`, { method: "DELETE" }), "Grant revoked.")}>Revoke</Button> : null}</li>
        ))}
      </ul>
      {isOwner ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/grants`, { method: "POST", body: { granteeMembershipId: f.get("granteeMembershipId"), scopeType: f.get("scopeType"), scopeId: f.get("scopeId") || null } }), "Grant recorded."); }}>
          <Field label="Grantee" htmlFor="g-who"><Select id="g-who" name="granteeMembershipId">{members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></Field>
          <Field label="Scope" htmlFor="g-scope"><Select id="g-scope" name="scopeType" value={scope} onChange={(e) => setScope(e.target.value)}><option value="team">Team recordings</option><option value="organisation">All recordings</option><option value="privacy_admin">Privacy administrator</option></Select></Field>
          {scope === "team" ? <Field label="Team" htmlFor="g-team"><Select id="g-team" name="scopeId">{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field> : null}
          <Button type="submit" variant="outline" disabled={pending}>Grant</Button>
        </form>
      ) : null}
    </div>
  );
}
