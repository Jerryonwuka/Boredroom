import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, can } from "@/server/admin/auth";
import { userDetail } from "@/server/admin/users";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { AdminAction, JsonForm } from "@/components/admin/actions";
import { inputCls } from "@/components/admin/fields";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { bytes, dateOnly, num, hours } from "@/lib/format";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/utils";
import type { Presence } from "@/lib/presence";

export const metadata = { title: "User" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("user.view");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof userDetail>>;
  try { d = await userDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const u = d.user;
  const act = `/api/admin/users/${id}/actions`;
  return (
    <>
      <PageHeader back={{ href: "/admin/users", label: "Users" }} title={<span className="flex items-center gap-3"><Avatar profileId={u.profile_id} name={u.display_name} avatarKey={u.avatar_key} presence={(u.presence as Presence) ?? "offline"} size={44} />{u.display_name}</span>}
        description={<>{u.email}{u.title ? `, ${u.title}` : ""}. {u.status === "active" ? (u.email_verified_at ? "Active" : "Email not verified yet") : `${u.status[0].toUpperCase()}${u.status.slice(1)}${u.status_reason ? `: ${u.status_reason}` : ""}`}. Signs in with {u.google ? "Google" : ""}{u.google && u.has_password ? " or " : ""}{u.has_password ? "a password" : ""}{!u.google && !u.has_password ? "nothing yet" : ""}.{u.admin_role ? ` Control Center role: ${u.admin_role}.` : ""}</>}
        meta={<>ID {u.auth_user_id} · Created {dateOnly(u.created_at)} · Last login {u.last_login_at ? formatDateTime(u.last_login_at) : "never"}</>}
        actions={<>
          {u.status === "active" && can(admin, "user.impersonate") && !u.admin_role ? <ImpersonateButton userId={id} name={u.display_name} /> : null}
          {u.status === "active" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "suspend" }} reason danger confirm={{ title: `Suspend ${u.display_name}?`, description: "They are signed out everywhere and cannot sign in until reinstated.", label: "Suspend" }}>Suspend</AdminAction> : null}
          {u.status !== "active" && u.status !== "deleted" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "reinstate" }} reason variant="primary" confirm={{ title: `Reinstate ${u.display_name}?`, label: "Reinstate" }}>Reinstate</AdminAction> : null}
          {u.status === "active" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "ban" }} reason danger confirm={{ title: `Ban ${u.display_name}?`, description: "A ban is a suspension that is not expected to be lifted.", label: "Ban" }}>Ban</AdminAction> : null}
          {u.status !== "deleted" && can(admin, "user.delete") ? <AdminAction path={act} body={{ action: "delete" }} reason danger confirm={{ title: `Delete ${u.display_name}'s account?`, description: "The account is closed and marked deleted; records stay for the retention period. This is the soft delete.", label: "Delete" }}>Delete</AdminAction> : null}
        </>} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card><CardHeader title="Activity" /><Ledger items={[{ label: "Open tasks", value: num(d.tasks.open) }, { label: "Completed", value: num(d.tasks.completed) }, { label: "Sessions, 30 days", value: num(d.tasks.sessions_30d) }, { label: "Hours, 30 days", value: hours(d.tasks.hours_30d) }]} /><p className="eyebrow mt-3">Recordings {num(d.recordings.count)} · {bytes(d.recordings.bytes)} · Now: {u.online ? "working" : u.clocked_in ? "clocked in" : "not working"}</p></Card>
          <Card><CardHeader title="Organisations" />
            {u.orgs?.length ? <ul className="divide-y divide-border-soft text-sm">{u.orgs.map((o) => <li key={o.id} className="flex items-center justify-between gap-3 py-2"><span><Link href={`/admin/organisations/${o.id}`} className="font-semibold hover:underline">{o.name}</Link> <span className="text-fg-subtle">{o.role}{o.plan ? `, ${o.plan}` : ""}</span></span></li>)}</ul> : <p className="text-sm text-fg-subtle">Not in any organisation.</p>}
          </Card>
          <Card><CardHeader title="Clock-ins" />{d.clockIns.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <DataTable caption="Clock-ins"><thead><tr><th>Day</th><th>Organisation</th><th>In</th><th>Out</th><th>Late</th></tr></thead><tbody>{d.clockIns.map((c, i) => <tr key={i}><td>{dateOnly(c.local_date)}</td><td>{c.org_name}</td><td className="text-sm">{formatDateTime(c.clock_in_at)}</td><td className="text-sm">{c.clock_out_at ? formatDateTime(c.clock_out_at) : "—"}</td><td>{c.late_seconds ? <span className="text-warning">{formatDuration(c.late_seconds)}</span> : "—"}</td></tr>)}</tbody></DataTable>}</Card>
          <Card><CardHeader title="Sessions and devices" description="Open and recent sign-ins." />
            <DataTable caption="Sessions"><thead><tr><th>Started</th><th>Last seen</th><th>State</th><th>Device</th></tr></thead><tbody>{d.sessions.map((s) => <tr key={s.id}><td className="text-sm">{formatDateTime(s.created_at)}</td><td className="text-sm text-fg-muted">{relativeTime(s.last_seen_at)}</td><td>{s.revoked_at ? <Badge tone="neutral">revoked</Badge> : new Date(s.expires_at) < new Date() ? <Badge tone="neutral">expired</Badge> : <Badge tone="success">open</Badge>}{s.impersonation_id ? <Badge tone="warning" className="ml-1">impersonation</Badge> : null}</td><td className="max-w-[260px] truncate text-xs text-fg-subtle">{s.user_agent ?? "—"}</td></tr>)}</tbody></DataTable>
          </Card>
          <Card><CardHeader title="Security events" description="Sign-ins and other account events." /><ul className="space-y-1 text-xs text-fg-muted">{d.logins.map((l, i) => <li key={i}><span className="font-mono">{l.action}</span> · {formatDateTime(l.occurred_at)}{l.metadata?.ip ? ` · ${String(l.metadata.ip)}` : ""}{l.metadata?.method ? ` · ${String(l.metadata.method)}` : ""}</li>)}{d.logins.length === 0 ? <li>None recorded.</li> : null}</ul></Card>
        </div>
        <div className="space-y-4">
          {can(admin, "support.act") && u.status === "active" ? (
            <Card><CardHeader title="Support" className="mb-2" />
              <div className="flex flex-wrap gap-2">
                <AdminAction path={act} body={{ action: "force_logout" }} reason confirm={{ title: "Sign them out everywhere?", label: "Sign out" }}>Sign out everywhere</AdminAction>
                <AdminAction path={act} body={{ action: "force_password_reset" }} reason confirm={{ title: "Force a password reset?", description: "Every session is revoked and a reset email goes to them.", label: "Send reset" }}>Force password reset</AdminAction>
              </div>
            </Card>
          ) : null}
          {can(admin, "user.edit") && u.orgs?.length ? (
            <Card><CardHeader title="Change role" className="mb-2" />
              <JsonForm path={act} transform={(d) => ({ action: "change_role", membershipId: String(d.membershipId), role: String(d.role), reason: String(d.reason) })} submitLabel="Change role">
                <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Organisation</span><select name="membershipId" className={inputCls} required>{d.memberships.map((m) => <option key={m.id} value={m.id}>{m.org_name} ({m.role})</option>)}</select></label>
                <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>New role</span><select name="role" className={inputCls}><option value="employee">Staff</option><option value="manager">Team lead</option><option value="hr">HR administrator</option><option value="owner">Organisation owner</option></select></label>
                <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Reason</span><input name="reason" className={inputCls} required minLength={3} /></label>
              </JsonForm>
            </Card>
          ) : null}
          <Card><CardHeader title="Administrative changes" className="mb-2" /><ul className="space-y-1 text-xs text-fg-muted">{d.adminAudit.map((a) => <li key={a.id}><span className="font-medium text-fg">{a.action}</span> · {a.admin_email ?? "system"} · {relativeTime(a.occurred_at)}{a.reason ? <p className="text-fg-subtle">{a.reason}</p> : null}</li>)}{d.adminAudit.length === 0 ? <li>None.</li> : null}</ul></Card>
        </div>
      </div>
    </>
  );
}

