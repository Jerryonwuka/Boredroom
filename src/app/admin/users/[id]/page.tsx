import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ShieldCheck } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { userDetail } from "@/server/admin/users";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { AdminAction, SheetButton } from "@/components/admin/actions";
import { ChangeRoleForm } from "@/components/admin/user-forms";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { ORG_ROLE, linkCls, subCls, words } from "@/components/admin/fields";
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
  const signIn = [u.google ? "Google" : null, u.has_password ? "a password" : null].filter(Boolean).join(" or ") || "nothing yet";
  return (
    <>
      <PageHeader back={{ href: "/admin/users", label: "Users" }}
        title={<span className="flex items-center gap-3"><Avatar profileId={u.profile_id} name={u.display_name} avatarKey={u.avatar_key} presence={(u.presence as Presence) ?? "offline"} size={40} />{u.display_name}</span>}
        description={<>{u.email}{u.title ? `, ${u.title}` : ""}. {u.status === "active" ? (u.email_verified_at ? "Active" : "Email not verified yet") : `${words(u.status)}${u.status_reason ? `: ${u.status_reason}` : ""}`}. Signs in with {signIn}.{u.admin_role ? ` Control Center role: ${words(u.admin_role)}.` : ""}</>}
        meta={<>ID <span className="font-mono">{u.auth_user_id}</span>, created {dateOnly(u.created_at)}, last sign-in {u.last_login_at ? formatDateTime(u.last_login_at) : "never"}</>}
        actions={<>
          {u.status === "active" && can(admin, "user.impersonate") && !u.admin_role ? <ImpersonateButton userId={id} name={u.display_name} /> : null}
          {u.status === "active" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "suspend" }} reason danger confirm={{ title: `Suspend ${u.display_name}?`, description: "They are signed out everywhere and cannot sign in until reinstated.", label: "Suspend" }}>Suspend</AdminAction> : null}
          {u.status !== "active" && u.status !== "deleted" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "reinstate" }} reason variant="primary" confirm={{ title: `Reinstate ${u.display_name}?`, label: "Reinstate" }}>Reinstate</AdminAction> : null}
          {u.status === "active" && can(admin, "user.suspend") ? <AdminAction path={act} body={{ action: "ban" }} reason danger confirm={{ title: `Ban ${u.display_name}?`, description: "A ban is a suspension that is not expected to be lifted.", label: "Ban" }}>Ban</AdminAction> : null}
          {u.status !== "deleted" && can(admin, "user.delete") ? <AdminAction path={act} body={{ action: "delete" }} reason danger confirm={{ title: `Delete ${u.display_name}'s account?`, description: "The account is closed and marked deleted; records stay for the retention period. This is the soft delete.", label: "Delete" }}>Delete</AdminAction> : null}
        </>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-6">
          <section aria-labelledby="user-activity">
            <h2 id="user-activity" className="sr-only">Activity</h2>
            <Ledger items={[{ label: "Open tasks", value: num(d.tasks.open) }, { label: "Completed", value: num(d.tasks.completed) }, { label: "Sessions, 30 days", value: num(d.tasks.sessions_30d) }, { label: "Hours, 30 days", value: hours(d.tasks.hours_30d) }]} />
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-meta font-normal text-secondary">
              <span>Recordings: <span className="tabular-nums">{num(d.recordings.count)}</span>, {bytes(d.recordings.bytes)}.</span>
              <span className="inline-flex items-center gap-1.5">Now: {u.online ? <><StatusDot tone="live" />working</> : u.clocked_in ? "clocked in" : "not working"}</span>
            </p>
          </section>
          <Card>
            <CardHeader title="Clock-ins" />
            {d.clockIns.length === 0 ? <EmptyState compact icon={Clock} title="No clock-ins yet" /> : (
              <DataTable caption="Clock-ins">
                <thead><tr><th>Day</th><th>Organisation</th><th>In</th><th>Out</th><th>Late</th></tr></thead>
                <tbody>{d.clockIns.map((c, i) => <tr key={i}><td className="tabular-nums">{dateOnly(c.local_date)}</td><td>{c.org_name}</td><td className="tabular-nums">{formatDateTime(c.clock_in_at)}</td><td className="tabular-nums">{c.clock_out_at ? formatDateTime(c.clock_out_at) : <span className="text-secondary">Still in</span>}</td><td>{c.late_seconds ? <span className="text-warning">{formatDuration(c.late_seconds)}</span> : <span className="text-secondary">On time</span>}</td></tr>)}</tbody>
              </DataTable>
            )}
          </Card>
          <Card>
            <CardHeader title="Sessions and devices" description="Open and recent sign-ins." />
            {d.sessions.length === 0 ? <p className="text-sm font-normal text-secondary">No sessions recorded.</p> : (
              <DataTable caption="Sessions">
                <thead><tr><th>Started</th><th>Last seen</th><th>State</th><th>Device</th></tr></thead>
                <tbody>{d.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="tabular-nums">{formatDateTime(s.created_at)}</td>
                    <td className="text-secondary">{relativeTime(s.last_seen_at)}</td>
                    <td><span className="inline-flex flex-wrap gap-1">{s.revoked_at ? <Badge>Revoked</Badge> : new Date(s.expires_at) < new Date() ? <Badge>Expired</Badge> : <Badge tone="success">Open</Badge>}{s.impersonation_id ? <Badge tone="warning">Impersonation</Badge> : null}</span></td>
                    <td className="max-w-[260px] truncate text-meta text-secondary" title={s.user_agent ?? undefined}>{s.user_agent ?? "Unknown"}</td>
                  </tr>
                ))}</tbody>
              </DataTable>
            )}
          </Card>
          <Card>
            <CardHeader title="Security events" description="Sign-ins and other account events." />
            {d.logins.length === 0 ? <p className="text-sm font-normal text-secondary">None recorded.</p> : (
              <ul className="grid gap-2.5">{d.logins.map((l, i) => (
                <li key={i} className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{l.action}</p>
                  <p className={subCls}>{formatDateTime(l.occurred_at)}{l.metadata?.ip ? `, ${String(l.metadata.ip)}` : ""}{l.metadata?.method ? `, ${String(l.metadata.method)}` : ""}</p>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-3">
          <Card>
            <CardHeader title="Organisations" size="sm" className="mb-3" />
            {u.orgs?.length ? (
              <ul className="grid gap-2.5">{u.orgs.map((o) => (
                <li key={o.id} className="min-w-0"><Link href={`/admin/organisations/${o.id}`} className={linkCls}>{o.name}</Link><span className={subCls}>{ORG_ROLE[o.role] ?? o.role}{o.plan ? `, ${o.plan}` : ""}</span></li>
              ))}</ul>
            ) : <p className="text-sm font-normal text-secondary">Not in any organisation.</p>}
          </Card>
          {(can(admin, "support.act") && u.status === "active") || (can(admin, "user.edit") && u.orgs?.length) ? (
            <Card>
              <CardHeader title="Support" size="sm" className="mb-3" />
              <div className="flex flex-wrap gap-2">
                {can(admin, "support.act") && u.status === "active" ? <>
                  <AdminAction path={act} body={{ action: "force_logout" }} reason confirm={{ title: "Sign them out everywhere?", label: "Sign out" }}>Sign out everywhere</AdminAction>
                  <AdminAction path={act} body={{ action: "force_password_reset" }} reason confirm={{ title: "Force a password reset?", description: "Every session is revoked and a reset email goes to them.", label: "Send reset" }}>Force password reset</AdminAction>
                </> : null}
                {can(admin, "user.edit") && u.orgs?.length ? (
                  <SheetButton label="Change role" title={`Change ${u.display_name}'s role`} description="Their role in one of their organisations. Written to the audit trail with your reason.">
                    <ChangeRoleForm path={act} memberships={d.memberships.map((m) => ({ id: m.id, org_name: m.org_name, role: m.role }))} />
                  </SheetButton>
                ) : null}
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Administrative changes" size="sm" className="mb-3" />
            {d.adminAudit.length === 0 ? <EmptyState compact icon={ShieldCheck} title="Nothing here yet" /> : (
              <ul className="grid gap-2.5">{d.adminAudit.map((a) => (
                <li key={a.id} className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{a.action}</p>
                  <p className={subCls}>{a.admin_email ?? "System"}, {relativeTime(a.occurred_at)}</p>
                  {a.reason ? <p className="text-meta font-normal text-secondary">{a.reason}</p> : null}
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
