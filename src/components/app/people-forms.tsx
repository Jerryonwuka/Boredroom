"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { IconButton, ICON_BUTTON } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { Copy, Link2, Check, RefreshCw, X, Plus, MessageSquare, UserX } from "lucide-react";
import { successToast } from "@/components/app/tasks-page";
import { SITE_ORIGIN } from "@/lib/site";
import { cn } from "@/lib/utils";
import { api, isApiFailure } from "@/lib/api-client";

function useForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function submit<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setPending(true); setError(null); setFieldErrors({});
    try { const r = await fn(); after?.(r); router.refresh(); return r; }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); return null; }
    finally { setPending(false); }
  }
  return { pending, error, fieldErrors, submit };
}

type Team = { id: string; name: string; member_count?: number };
const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

/** "Add new person" opens a pop-up (owner decision, 26 September 2026): email, role, team, employee ID. */
export function InviteForm({ orgSlug, teams, isOwner, label = "Invite someone" }: { orgSlug: string; teams: Team[]; isOwner: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog">{label}</Button>
      {open ? <InviteSheet orgSlug={orgSlug} teams={teams} isOwner={isOwner} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InviteSheet({ orgSlug, teams, isOwner, onClose }: { orgSlug: string; teams: Team[]; isOwner: boolean; onClose: () => void }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/invitations`, { method: "POST", body: { email: f.get("email"), role: f.get("role"), teamId: f.get("teamId") || null, employeeCode: f.get("employeeCode") || null } }), () => { successToast(`Invitation sent to ${String(f.get("email"))}`); onClose(); }); }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id={titleId} className="font-display text-xl">Add a person</h2><p className="mt-1 text-sm text-fg-muted">They get an email link that creates their account with this role and team. For quick joining, share the join code instead.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Email" htmlFor="inv-email" error={fieldErrors.email}><Input id="inv-email" name="email" type="email" required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role" htmlFor="inv-role" error={fieldErrors.role}><Select id="inv-role" name="role" defaultValue="employee"><option value="employee">Staff</option><option value="manager">Team lead</option>{isOwner ? <><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></> : null}</Select></Field>
          <Field label="Team" htmlFor="inv-team" hint="optional"><Select id="inv-team" name="teamId" defaultValue=""><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </div>
        <Field label="Employee ID" htmlFor="inv-code" hint="optional, e.g. EMP-042" error={fieldErrors.employeeCode}><Input id="inv-code" name="employeeCode" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</Button></div>
      </form>
    </dialog>
  );
}

export function MemberRow({ orgSlug, member, teams, isOwner, self }: { orgSlug: string; member: { id: string; display_name: string; email: string; employee_code: string; role: string; status: string; teams: { id: string; name: string; is_manager: boolean }[]; acknowledged: boolean }; teams: Team[]; isOwner: boolean; self: boolean }) {
  const { pending, error, submit } = useForm();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [teamSheet, setTeamSheet] = useState(false);
  const revoked = member.status === "revoked";
  return (
    <tr className={revoked ? "opacity-60" : ""}>
      <td><p className="font-semibold">{member.display_name}{self ? <span className="ml-2 text-xs text-fg-subtle">(you)</span> : null}</p><p className="text-xs text-fg-subtle">{member.email}</p>{error ? <p className="text-xs text-danger">{error}</p> : null}</td>
      <td>{member.employee_code}</td>
      <td>{revoked ? <Badge tone="danger">revoked</Badge> : self || (!isOwner && (member.role === "owner" || member.role === "hr")) ? <Badge tone="accent">{ROLE_LABEL[member.role]}</Badge> : (
        <Select aria-label={`Role for ${member.display_name}`} className="h-9 w-44 py-1 text-sm" value={member.role} disabled={pending} onChange={(e) => submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "PATCH", body: { role: e.target.value } }))}>
          <option value="employee">Staff</option><option value="manager">Team lead</option>{isOwner ? <><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></> : null}
        </Select>
      )}</td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          {member.teams.map((t) => <Badge key={t.id} tone={t.is_manager ? "accent" : "neutral"}>{t.name}{t.is_manager ? ", team lead" : ""}</Badge>)}
          {!revoked ? <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setTeamSheet(true)} aria-haspopup="dialog"><Plus className="size-3.5" aria-hidden />{member.teams.length ? "Teams" : "Add to team"}</Button> : null}
        </div>
        {teamSheet ? <TeamSheet orgSlug={orgSlug} member={member} teams={teams} onClose={() => setTeamSheet(false)} /> : null}
      </td>
      <td>{member.acknowledged ? <Badge tone="success">acknowledged</Badge> : <Badge tone="warning">pending</Badge>}</td>
      <td className="whitespace-nowrap">
        {!revoked && !self ? (
          <span className="flex items-center gap-1.5">
            <Link href={`/app/${orgSlug}/messages?to=${member.id}`} aria-label={`Message ${member.display_name}`} className={cn(ICON_BUTTON, "size-9")}><MessageSquare className="size-4" aria-hidden /></Link>
            <IconButton aria-label={`Offboard ${member.display_name}`} disabled={pending} onClick={() => setConfirmRevoke(true)} className="size-9 border-danger/40 bg-danger/10 text-danger hover:border-danger/70 hover:bg-danger/15 hover:text-danger"><UserX className="size-4" aria-hidden /></IconButton>
            <ConfirmDialog open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title={`Offboard ${member.display_name}?`} description="They are signed out and lose access to this workspace. Their records stay." confirmLabel="Offboard" onConfirm={async () => { await submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "DELETE" })); }} />
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * A person's teams in a pop-up (owner decision, 26 September 2026), so the list stays one line per person: the teams
 * they are in, each with a Remove, and a form to add them to another, as a member or as its team lead.
 */
function TeamSheet({ orgSlug, member, teams, onClose }: { orgSlug: string; member: { id: string; display_name: string; teams: { id: string; name: string; is_manager: boolean }[] }; teams: Team[]; onClose: () => void }) {
  const { pending, error, submit } = useForm();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  const available = teams.filter((t) => !member.teams.some((m) => m.id === t.id));
  const call = (teamId: string, body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/teams/${teamId}/members`, { method: "POST", body: { membershipId: member.id, ...body } }));
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id={titleId} className="font-display text-xl">Teams for {member.display_name}</h2><p className="mt-1 text-sm text-fg-muted">A team lead creates and assigns that team&apos;s tasks and checks its work.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div>
          <p className="eyebrow mb-1.5">In these teams</p>
          {member.teams.length === 0 ? <p className="text-sm text-fg-subtle">Not in a team yet.</p> : (
            <ul className="divide-y divide-border-soft rounded-[var(--radius-sm)] border border-border-soft">
              {member.teams.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">{t.name}{t.is_manager ? <Badge tone="accent">team lead</Badge> : null}</span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => call(t.id, { isManager: !t.is_manager })}>{t.is_manager ? "Make member" : "Make team lead"}</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-danger hover:text-danger" disabled={pending} onClick={() => call(t.id, { isManager: false, remove: true })}>Remove</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {available.length ? (
          <form className="grid gap-3 border-t border-border-soft pt-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const teamId = String(f.get("teamId")); if (teamId) void call(teamId, { isManager: f.get("isManager") === "on" }); }}>
            <Field label="Add to team" htmlFor={`${titleId}-team`}><Select id={`${titleId}-team`} name="teamId" defaultValue={available[0].id}>{available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isManager" /> As the team lead</label>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Done</Button><Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</Button></div>
          </form>
        ) : <div className="flex justify-end border-t border-border-soft pt-4"><Button type="button" variant="ghost" onClick={onClose}>Done</Button></div>}
      </div>
    </dialog>
  );
}

export function InvitationRow({ orgSlug, id, email, role, team, state, expires, sent }: { orgSlug: string; id: string; email: string; role: string; team: string | null; state: string; expires: string; sent: boolean }) {
  const { pending, submit } = useForm();
  const tone = { pending: "info", accepted: "success", expired: "neutral", revoked: "danger" }[state] as "info" | "success" | "neutral" | "danger";
  return (
    <tr>
      <td>{email}{!sent && state === "pending" ? <span className="ml-2 text-xs text-warning">not sent</span> : null}</td>
      <td>{role}</td>
      <td>{team ?? "—"}</td>
      <td><Badge tone={tone}>{state}</Badge></td>
      <td>{expires}</td>
      <td>{state === "pending" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(() => api(`/api/orgs/${orgSlug}/invitations/${id}`, { method: "DELETE" }))}>Revoke</Button> : null}</td>
    </tr>
  );
}

/** "Add new team": creates the team and opens it so people can be added straight away. */
/** "Add new team" opens a pop-up (owner decision, 26 September 2026) with the one field that matters. */
export function NewTeamForm({ orgSlug }: { orgSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-haspopup="dialog">Add new team</Button>
      {open ? <NewTeamSheet orgSlug={orgSlug} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewTeamSheet({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  const router = useRouter();
  const { pending, error, submit } = useForm();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form className="grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/teams`, { method: "POST", body: { name: f.get("name") } }), (r) => { onClose(); if (r?.id) router.push(`/app/${orgSlug}/teams/${r.id}`); }); }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id={titleId} className="font-display text-xl">New team</h2><p className="mt-1 text-sm text-fg-muted">Name it, then put a team lead on it and add people from the team&apos;s page.</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Team name" htmlFor="team-name" hint="e.g. Design, Tech, Branding"><Input id="team-name" name="name" required maxLength={120} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create team"}</Button></div>
      </form>
    </dialog>
  );
}

type JoinCode = { join_code: string | null; join_code_enabled: boolean; join_code_role: string; join_code_team_id: string | null; join_code_rotated_at: string | null };

/** The organisation account's join code: the only way staff can create accounts. */
export function JoinCodePanel({ orgSlug, joinCode, teams }: { orgSlug: string; joinCode: JoinCode; teams: Team[] }) {
  const appOrigin = SITE_ORIGIN;
  const { pending, error, submit } = useForm();
  const [copied, setCopied] = useState<string | null>(null);
  const patch = (body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/settings/join-code`, { method: "PATCH", body }));
  const link = joinCode.join_code ? `${appOrigin}/join/${joinCode.join_code}` : null;
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000); } catch { /* clipboard unavailable */ } };
  return (
    <div className="tile p-4">
      {error ? <Alert tone="danger" className="mb-3">{error}</Alert> : null}
      {!joinCode.join_code ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">No join code yet. Generate one and share it with your staff; they enter it at <span className="text-fg">boredroom.cc/join</span>.</p>
          <Button disabled={pending} onClick={() => patch({ rotate: true, enabled: true })}>Generate join code</Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <p className="text-sm text-fg-muted">Organisation code</p>
            <p className="mt-1 font-mono text-3xl tracking-widest">{joinCode.join_code}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <IconButton aria-label={copied === "code" ? "Code copied" : "Copy the code"} onClick={() => copy(joinCode.join_code!, "code")} className={cn("size-9", copied === "code" && "border-success/60 text-success")}>{copied === "code" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}</IconButton>
              <IconButton aria-label={copied === "link" ? "Link copied" : "Copy the join link"} onClick={() => copy(link!, "link")} className={cn("size-9", copied === "link" && "border-success/60 text-success")}>{copied === "link" ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}</IconButton>
              <ConfirmButton size="icon" variant="ghost" className="size-9 rounded-full" aria-label="Generate a new code" title="Generate a new join code?" description="The current code and link stop working immediately. People who already joined are not affected." confirmLabel="Generate new code" disabled={pending} onConfirm={() => patch({ rotate: true })}><RefreshCw className="size-4" aria-hidden /></ConfirmButton>
              <span className="ml-1 text-xs text-fg-subtle" aria-live="polite">{copied === "code" ? "Code copied" : copied === "link" ? "Link copied" : ""}</span>
            </div>
          </div>
          <div className="grid gap-3">
            <Switch checked={joinCode.join_code_enabled} disabled={pending} onChange={(e) => patch({ enabled: e.target.checked })} hint={joinCode.join_code_enabled ? "Anyone with the code or link can join right now." : "Paused: the code and link are refused until you switch this back on."} className="-mx-3"><span className="flex items-center gap-2">Accepting joins<Badge tone={joinCode.join_code_enabled ? "success" : "danger"} dot>{joinCode.join_code_enabled ? "open" : "paused"}</Badge></span></Switch>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="People who join become" htmlFor="jc-role"><Select id="jc-role" className="h-10 w-44 py-1 text-sm" value={joinCode.join_code_role} disabled={pending} onChange={(e) => patch({ role: e.target.value })}><option value="employee">Staff</option><option value="manager">Team lead</option></Select></Field>
              <Field label="and are placed in team" htmlFor="jc-team"><Select id="jc-team" className="h-10 w-48 py-1 text-sm" value={joinCode.join_code_team_id ?? ""} disabled={pending} onChange={(e) => patch({ teamId: e.target.value || null })}><option value="">No team yet (assign later)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            </div>
            <p className="text-xs text-fg-subtle">Share the code in your team chat or send the link. Anyone who joins is listed below and can be offboarded at any time.</p>
          </div>
        </div>
      )}
    </div>
  );
}
