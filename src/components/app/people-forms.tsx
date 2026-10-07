"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Ellipsis, Link2, MessageSquare, Plus, RefreshCw, Users, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Input, Select, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Badge, MonoChip } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { successToast } from "@/components/ui/toast";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
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
  const reset = () => { setError(null); setFieldErrors({}); };
  return { pending, error, fieldErrors, submit, reset };
}

type Team = { id: string; name: string; member_count?: number };
const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

/**
 * "Add new person" (owner decision, 26 September 2026: a pop-up with email, role, team, employee ID), v4: the page
 * header's one orange standout ("Add people", accent rules 6 October 2026) opens a side sheet; Cancel and Invite sit in
 * its footer; a green-dot toast confirms.
 */
export function InviteForm({ orgSlug, teams, isOwner, label = "Invite someone" }: { orgSlug: string; teams: Team[]; isOwner: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, submit, reset } = useForm();
  const formId = useId();
  const close = () => { if (!pending) setOpen(false); };
  return (
    <>
      <Button size="sm" variant="accent" onClick={() => { reset(); setOpen(true); }} aria-haspopup="dialog"><Plus aria-hidden />{label}</Button>
      <Sheet open={open} onClose={close} title="Add a person" description="They get an email link that creates their account with this role and team. For quick joining, share the join code instead."
        footer={<><Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Sending…" : "Invite"}</Button></>}>
        <form id={formId} className="grid gap-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit(() => api(`/api/orgs/${orgSlug}/invitations`, { method: "POST", body: { email: f.get("email"), role: f.get("role"), teamId: f.get("teamId") || null, employeeCode: f.get("employeeCode") || null } }), () => { successToast(`Invitation sent to ${String(f.get("email"))}`); setOpen(false); }); }}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Email" htmlFor="inv-email" error={fieldErrors.email}><Input id="inv-email" name="email" type="email" required autoFocus /></Field>
          <Field label="Role" htmlFor="inv-role" error={fieldErrors.role}><Select id="inv-role" name="role" defaultValue="employee"><option value="employee">Staff</option><option value="manager">Team lead</option>{isOwner ? <><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></> : null}</Select></Field>
          <Field label="Team" htmlFor="inv-team" hint="Optional" error={fieldErrors.teamId}><Select id="inv-team" name="teamId" defaultValue=""><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Employee ID" htmlFor="inv-code" hint="Optional" description="Letters, digits and dashes, such as EMP-042." error={fieldErrors.employeeCode}><Input id="inv-code" name="employeeCode" maxLength={24} autoCapitalize="characters" /></Field>
        </form>
      </Sheet>
    </>
  );
}

/**
 * One person in the People table, v4: name and email, the employee ID as a mono chip, the role (a small select where
 * the caller may change it), their teams as badges, whether they agreed to the recording rules, and a "…" menu for
 * Message, Teams and Offboard. Offboarding asks first.
 */
export function MemberRow({ orgSlug, member, teams, isOwner, self }: { orgSlug: string; member: { id: string; display_name: string; email: string; employee_code: string; role: string; status: string; teams: { id: string; name: string; is_manager: boolean }[]; acknowledged: boolean }; teams: Team[]; isOwner: boolean; self: boolean }) {
  const { pending, error, submit } = useForm();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [teamSheet, setTeamSheet] = useState(false);
  const revoked = member.status === "revoked";
  return (
    <tr className={revoked ? "opacity-60" : undefined}>
      <td>
        <p className="font-medium text-foreground">{member.display_name}{self ? <span className="ml-1.5 font-normal text-secondary">(you)</span> : null}</p>
        <p className="text-meta text-secondary">{member.email}</p>
        {error ? <p role="alert" className="mt-1 text-meta font-medium text-danger">{error}</p> : null}
      </td>
      <td><MonoChip>{member.employee_code}</MonoChip></td>
      <td>{revoked ? <Badge tone="danger">Offboarded</Badge> : self || (!isOwner && (member.role === "owner" || member.role === "hr")) ? <Badge>{ROLE_LABEL[member.role]}</Badge> : (
        <Select aria-label={`Role for ${member.display_name}`} fieldSize="sm" className="w-40" value={member.role} disabled={pending} onChange={(e) => submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "PATCH", body: { role: e.target.value } }))}>
          <option value="employee">Staff</option><option value="manager">Team lead</option>{isOwner ? <><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></> : null}
        </Select>
      )}</td>
      <td>
        <span className="flex flex-wrap items-center gap-1">
          {member.teams.map((t) => <Badge key={t.id}>{t.name}{t.is_manager ? ", lead" : ""}</Badge>)}
          {!revoked && !member.teams.length ? <Button size="xs" variant="secondary" onClick={() => setTeamSheet(true)} aria-haspopup="dialog" aria-label={`Add to team, ${member.display_name}`}><Plus aria-hidden />Add to team</Button> : null}
        </span>
      </td>
      <td>{member.acknowledged ? <Badge tone="success" dot>Agreed</Badge> : <Badge tone="info">Not asked yet</Badge>}</td>
      {/* No text-right on the cell: the sheet and the confirm inside it would inherit it. The trigger is pushed right instead. */}
      <td className="w-10">
        {!revoked ? (
          <span className="flex justify-end">
            <Menu align="end" label={`Actions for ${member.display_name}`} trigger={<IconButton aria-label={`Actions for ${member.display_name}`} disabled={pending}><Ellipsis aria-hidden /></IconButton>}>
              {!self ? <MenuItem href={`/app/${orgSlug}/messages?to=${member.id}`} icon={<MessageSquare />}>Message</MenuItem> : null}
              <MenuItem onSelect={() => setTeamSheet(true)} icon={<Users />}>{member.teams.length ? "Teams…" : "Add to team…"}</MenuItem>
              {!self ? <><MenuSeparator /><MenuItem tone="danger" onSelect={() => setConfirmRevoke(true)} icon={<UserX />}>Offboard…</MenuItem></> : null}
            </Menu>
          </span>
        ) : null}
        {!revoked && !self ? <ConfirmDialog open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title={`Offboard ${member.display_name}?`} description="They are signed out and lose access to this workspace. Their records stay." confirmLabel="Offboard" pendingLabel="Offboarding…" onConfirm={async () => { await submit(() => api(`/api/orgs/${orgSlug}/members/${member.id}`, { method: "DELETE" })); }} /> : null}
        {!revoked ? <TeamSheet open={teamSheet} orgSlug={orgSlug} member={member} teams={teams} onClose={() => setTeamSheet(false)} /> : null}
      </td>
    </tr>
  );
}

/**
 * A person's teams in a side sheet (owner decision, 26 September 2026: the list stays one line per person): the teams
 * they are in, each with Make team lead or Make member and Remove, and a form to add them to another. What a team lead
 * does is a note at the bottom of the sheet (owner request, 7 October 2026).
 */
function TeamSheet({ open, orgSlug, member, teams, onClose }: { open: boolean; orgSlug: string; member: { id: string; display_name: string; teams: { id: string; name: string; is_manager: boolean }[] }; teams: Team[]; onClose: () => void }) {
  const { pending, error, submit } = useForm();
  const formId = useId();
  const available = teams.filter((t) => !member.teams.some((m) => m.id === t.id));
  const call = (teamId: string, body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/teams/${teamId}/members`, { method: "POST", body: { membershipId: member.id, ...body } }));
  return (
    <Sheet open={open} onClose={onClose} title={`Teams for ${member.display_name}`}
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <div className="grid gap-8">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <section aria-labelledby={`${formId}-in`}>
          <h3 id={`${formId}-in`} className="mb-2 text-sm font-semibold text-foreground">In these teams</h3>
          {member.teams.length === 0 ? <p className="text-sm font-normal text-secondary">Not in a team yet.</p> : (
            <ul className="-mx-2 grid gap-0.5">
              {member.teams.map((t) => (
                <li key={t.id} className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-1 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-foreground"><span className="truncate">{t.name}</span>{t.is_manager ? <Badge size="sm">Team lead</Badge> : null}</span>
                  <span className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" disabled={pending} onClick={() => call(t.id, { isManager: !t.is_manager })}>{t.is_manager ? "Make member" : "Make team lead"}</Button>
                    <Button size="xs" variant="ghost" className="text-danger hover:text-danger" disabled={pending} onClick={() => call(t.id, { isManager: false, remove: true })} aria-label={`Remove from ${t.name}`}>Remove</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {available.length ? (
          <form className="grid gap-4 border-t border-border pt-6" aria-labelledby={`${formId}-add`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const teamId = String(f.get("teamId")); if (teamId) void call(teamId, { isManager: f.get("isManager") === "on" }); }}>
            <h3 id={`${formId}-add`} className="text-sm font-semibold text-foreground">Add to another team</h3>
            <Field label="Team" htmlFor={`${formId}-team`}><Select id={`${formId}-team`} name="teamId" defaultValue={available[0].id}>{available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Checkbox name="isManager">As the team lead</Checkbox>
            <div><Button type="submit" variant="secondary" loading={pending}>{pending ? "Adding…" : "Add to team"}</Button></div>
          </form>
        ) : null}
      </div>
      <PageNotes>
        <PageNote>A team lead creates and assigns that team&apos;s tasks and checks its work.</PageNote>
      </PageNotes>
    </Sheet>
  );
}

export function InvitationRow({ orgSlug, id, email, role, team, state, expires, sent }: { orgSlug: string; id: string; email: string; role: string; team: string | null; state: string; expires: string; sent: boolean }) {
  const { pending, error, submit } = useForm();
  const tone = { pending: "neutral", accepted: "success", expired: "info", revoked: "danger" }[state] as "neutral" | "success" | "info" | "danger";
  return (
    <tr>
      <td>
        <span className="font-medium text-foreground">{email}</span>
        {!sent && state === "pending" ? <p className="flex items-center gap-1.5 text-meta text-secondary"><span className="size-1.5 rounded-full bg-warning" aria-hidden />Email not sent</p> : null}
        {error ? <p role="alert" className="mt-1 text-meta font-medium text-danger">{error}</p> : null}
      </td>
      <td className="text-secondary">{role}</td>
      <td className="text-secondary">{team ?? "None"}</td>
      <td><Badge tone={tone} dot={state === "pending" || state === "accepted"}>{state.charAt(0).toUpperCase() + state.slice(1)}</Badge></td>
      <td className="nowrap tabular-nums text-secondary">{expires}</td>
      <td>{state === "pending" ? <span className="flex justify-end"><ConfirmButton size="xs" variant="ghost" disabled={pending} aria-label={`Revoke the invitation to ${email}`} title={`Revoke the invitation to ${email}?`} description="The link in their email stops working at once. You can send a new invitation later." confirmLabel="Revoke invitation" pendingLabel="Revoking…" onConfirm={() => submit(() => api(`/api/orgs/${orgSlug}/invitations/${id}`, { method: "DELETE" }))}>{pending ? "Revoking…" : "Revoke"}</ConfirmButton></span> : null}</td>
    </tr>
  );
}

/** "Add new team" (owner decision, 26 September 2026: a pop-up with the one field that matters); opens the new team. */
export function NewTeamForm({ orgSlug, variant = "accent" }: { orgSlug: string; variant?: "accent" | "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, submit, reset } = useForm();
  const formId = useId();
  const close = () => { if (!pending) setOpen(false); };
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => { reset(); setOpen(true); }} aria-haspopup="dialog"><Plus aria-hidden />Add new team</Button>
      <Sheet open={open} onClose={close} size="sm" title="New team" description="Name it, then put a team lead on it and add people from the team's page."
        footer={<><Button variant="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" form={formId} loading={pending}>{pending ? "Creating…" : "Create team"}</Button></>}>
        <form id={formId} className="grid gap-5" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit(() => api<{ id: string }>(`/api/orgs/${orgSlug}/teams`, { method: "POST", body: { name: f.get("name") } }), (r) => { setOpen(false); if (r?.id) router.push(`/app/${orgSlug}/teams/${r.id}`); }); }}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Team name" htmlFor="team-name" description="Such as Design, Tech or Branding." error={fieldErrors.name}><Input id="team-name" name="name" required maxLength={120} autoFocus /></Field>
        </form>
      </Sheet>
    </>
  );
}

type JoinCode = { join_code: string | null; join_code_enabled: boolean; join_code_role: string; join_code_team_id: string | null; join_code_rotated_at: string | null };

/**
 * The organisation account's join code, the only way staff can create accounts, in a v4 section card. How to share it
 * and that joiners can be offboarded is a page note on the People page (owner request, 7 October 2026).
 */
export function JoinCodePanel({ orgSlug, joinCode, teams }: { orgSlug: string; joinCode: JoinCode; teams: Team[] }) {
  const appOrigin = SITE_ORIGIN;
  const { pending, error, submit } = useForm();
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const patch = (body: Record<string, unknown>) => submit(() => api(`/api/orgs/${orgSlug}/settings/join-code`, { method: "PATCH", body }));
  const link = joinCode.join_code ? `${appOrigin}/join/${joinCode.join_code}` : null;
  // A blocked clipboard (an insecure origin, a denied permission) says so instead of doing nothing.
  const copy = async (text: string, what: string) => { setCopyFailed(false); try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); setCopyFailed(true); } };
  return (
    <div className="card-section">
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      {!joinCode.join_code ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm font-normal text-secondary">No join code yet. Generate one and share it with your staff; they enter it at <span className="font-medium text-foreground">{appOrigin.replace(/^https?:\/\//, "")}/join</span>.</p>
          <Button variant="secondary" size="sm" loading={pending} onClick={() => patch({ rotate: true, enabled: true })}>{pending ? "Generating…" : "Generate join code"}</Button>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
          <div>
            <p className="text-sm font-medium text-secondary">Organisation code</p>
            <p className="mt-1 select-all font-mono text-3xl tabular-nums text-foreground">{joinCode.join_code}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <IconButton aria-label={copied === "code" ? "Code copied" : "Copy the code"} onClick={() => copy(joinCode.join_code!, "code")} className={cn(copied === "code" && "text-success hover:text-success")}>{copied === "code" ? <Check aria-hidden /> : <Copy aria-hidden />}</IconButton>
              <IconButton aria-label={copied === "link" ? "Link copied" : "Copy the join link"} onClick={() => copy(link!, "link")} className={cn(copied === "link" && "text-success hover:text-success")}>{copied === "link" ? <Check aria-hidden /> : <Link2 aria-hidden />}</IconButton>
              <ConfirmButton size="icon-sm" variant="ghost" aria-label="Generate a new code" title="Generate a new join code?" description="The current code and link stop working immediately. People who already joined are not affected." confirmLabel="Generate new code" disabled={pending} onConfirm={() => patch({ rotate: true })}><RefreshCw aria-hidden /></ConfirmButton>
              <span className="ml-1 text-xs font-medium text-secondary" aria-live="polite">{copied === "code" ? "Code copied" : copied === "link" ? "Link copied" : ""}</span>
            </div>
            {copyFailed ? <p role="alert" className="mt-2 max-w-xs text-meta font-normal text-danger">This browser blocked copying. Select the code or the link <span className="font-medium text-foreground">{link}</span> and copy it by hand.</p> : null}
          </div>
          <div className="grid content-start gap-4">
            <Switch checked={joinCode.join_code_enabled} disabled={pending} onChange={(e) => patch({ enabled: e.target.checked })} hint={joinCode.join_code_enabled ? "Anyone with the code or link can join right now." : "Paused: the code and link are refused until you switch this back on."} className="py-0">
              <span className="flex items-center gap-2">Accepting joins<Badge tone={joinCode.join_code_enabled ? "success" : "danger"} dot>{joinCode.join_code_enabled ? "Open" : "Paused"}</Badge></span>
            </Switch>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="People who join become" htmlFor="jc-role"><Select id="jc-role" value={joinCode.join_code_role} disabled={pending} onChange={(e) => patch({ role: e.target.value })}><option value="employee">Staff</option><option value="manager">Team lead</option></Select></Field>
              <Field label="And are placed in" htmlFor="jc-team"><Select id="jc-team" value={joinCode.join_code_team_id ?? ""} disabled={pending} onChange={(e) => patch({ teamId: e.target.value || null })}><option value="">No team yet (assign later)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
