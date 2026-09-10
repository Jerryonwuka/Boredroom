"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
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

export function InviteForm({ orgSlug, teams, isOwner }: { orgSlug: string; teams: Team[]; isOwner: boolean }) {
  const { pending, error, fieldErrors, submit } = useForm();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!open) return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={() => { setOpen(true); setDone(null); }}>Invite someone</Button>
      {done ? <Alert tone="success">Invitation sent to {done}.</Alert> : null}
    </div>
  );
  return (
    <form className="tile grid w-full gap-3 p-4 md:w-[520px]" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); submit(() => api(`/api/orgs/${orgSlug}/invitations`, { method: "POST", body: { email: f.get("email"), role: f.get("role"), teamId: f.get("teamId") || null, employeeCode: f.get("employeeCode") || null } }), () => { setDone(String(f.get("email"))); setOpen(false); }); }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email" htmlFor="inv-email" error={fieldErrors.email}><Input id="inv-email" name="email" type="email" required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role" htmlFor="inv-role" error={fieldErrors.role}><Select id="inv-role" name="role" defaultValue="employee"><option value="employee">Employee</option><option value="manager">Team manager</option>{isOwner ? <><option value="hr">HR administrator</option><option value="owner">Owner</option></> : null}</Select></Field>
        <Field label="Team" htmlFor="inv-team" hint="optional"><Select id="inv-team" name="teamId" defaultValue=""><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
      </div>
      <Field label="Employee ID" htmlFor="inv-code" hint="optional, e.g. EMP-042" error={fieldErrors.employeeCode}><Input id="inv-code" name="employeeCode" /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Sending…" : "Invite"}</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function MemberRow({ orgSlug, member, teams, isOwner, self }: { orgSlug: string; member: { id: string; display_name: string; email: string; employee_code: string; role: string; status: string; teams: { id: string; name: string; is_manager: boolean }[]; acknowledged: boolean }; teams: Team[]; isOwner: boolean; self: boolean }) {
  const { pending, error, submit } = useForm();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const revoked = member.status === "revoked";
  return (
    <tr className={revoked ? "opacity-60" : ""}>
      <td><p className="font-semibold">{member.display_name}{self ? <span className="ml-2 text-xs text-fg-subtle">(you)</span> : null}</p><p className="text-xs text-fg-subtle">{member.email}</p>{error ? <p className="text-xs text-danger">{error}</p> : null}</td>
      <td>{member.employee_code}</td>
      <td>{revoked ? <Badge tone="danger">revoked</Badge> : self || (!isOwner && (member.role === "owner" || member.role === "hr")) ? <Badge tone="accent">{member.role}</Badge> : (
        <Select aria-label={`Role for ${member.display_name}`} className="h-9 w-36 py-1 text-sm" value={member.role} disabled={pending} onChange={(e) => submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "PATCH", body: { role: e.target.value } }))}>
          <option value="employee">employee</option><option value="manager">manager</option>{isOwner ? <><option value="hr">hr</option><option value="owner">owner</option></> : null}
        </Select>
      )}</td>
      <td>
        <div className="flex flex-wrap gap-1">{member.teams.map((t) => <Badge key={t.id} tone={t.is_manager ? "accent" : "neutral"}>{t.name}{t.is_manager ? " · manager" : ""}</Badge>)}</div>
        {!revoked ? (
          <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const teamId = String(f.get("teamId")); if (!teamId) return; submit(() => api(`/api/orgs/${orgSlug}/teams/${teamId}/members`, { method: "POST", body: { membershipId: member.id, isManager: f.get("isManager") === "on" } })); }}>
            <select aria-label="Team" name="teamId" className="h-8 rounded-lg border border-border bg-inset px-2 text-xs"><option value="">Add to team…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isManager" /> as manager</label>
            <Button size="sm" variant="ghost" type="submit" disabled={pending}>Add</Button>
            {member.teams.length ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(() => api(`/api/orgs/${orgSlug}/teams/${member.teams[0].id}/members`, { method: "POST", body: { membershipId: member.id, isManager: false, remove: true } }))}>Remove from {member.teams[0].name}</Button> : null}
          </form>
        ) : null}
      </td>
      <td>{member.acknowledged ? <Badge tone="success">acknowledged</Badge> : <Badge tone="warning">pending</Badge>}</td>
      <td>{!revoked && !self ? (confirmRevoke ? <div className="flex gap-1"><Button size="sm" variant="danger" disabled={pending} onClick={() => submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "DELETE" }), () => setConfirmRevoke(false))}>Confirm offboard</Button><Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>Cancel</Button></div> : <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(true)}>Offboard</Button>) : null}</td>
    </tr>
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

export function TeamsPanel({ orgSlug, teams }: { orgSlug: string; teams: Team[] }) {
  const { pending, error, submit } = useForm();
  return (
    <div className="tile p-4">
      {error ? <Alert tone="danger" className="mb-2">{error}</Alert> : null}
      <ul className="mb-3 flex flex-wrap gap-2">{teams.map((t) => <li key={t.id}><Badge>{t.name} · {t.member_count ?? 0}</Badge></li>)}{teams.length === 0 ? <li className="text-sm text-fg-muted">No teams yet.</li> : null}</ul>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); submit(() => api(`/api/orgs/${orgSlug}/teams`, { method: "POST", body: { name: f.get("name") } }), () => form.reset()); }}>
        <Field label="New team" htmlFor="team-name"><Input id="team-name" name="name" required maxLength={120} /></Field>
        <Button type="submit" variant="outline" disabled={pending}>Create team</Button>
      </form>
    </div>
  );
}
