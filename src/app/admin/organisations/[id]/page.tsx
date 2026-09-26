import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin, can } from "@/server/admin/auth";
import { organisationDetail } from "@/server/admin/organisations";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { AdminAction, JsonForm } from "@/components/admin/actions";
import { inputCls } from "@/components/admin/fields";
import { OrgPlanForm, FeatureOverridesForm } from "@/components/admin/org-forms";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { bytes, dateOnly, num, hours, money } from "@/lib/format";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/utils";

export const metadata = { title: "Organisation" };
const TABS = ["overview", "users", "teams", "activity", "tasks", "attendance", "usage", "billing", "storage", "security", "audit"] as const;

export default async function OrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("organization.view");
  const { id } = await params;
  const { tab: t } = await searchParams;
  const tab = (TABS as readonly string[]).includes(t ?? "") ? (t as (typeof TABS)[number]) : "overview";
  let d: Awaited<ReturnType<typeof organisationDetail>>;
  try { d = await organisationDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const { org } = d;
  const base = `/admin/organisations/${id}`;
  const storage = Number(d.usage.recording_bytes) + Number(d.usage.deliverable_bytes);
  const seats = org.plan_max_users ? `${org.users} / ${org.plan_max_users}` : `${org.users}`;
  const quota = org.plan_max_storage ? `${bytes(storage)} / ${bytes(org.plan_max_storage)}` : bytes(storage);

  return (
    <>
      <PageHeader icon="desk" back={{ href: "/admin/organisations", label: "Organisations" }} title={org.name}
        description={<>{org.owner_name ? <>Owned by {org.owner_name} ({org.owner_email}). </> : "No owner yet. "}{org.plan_name ?? "No plan"}{org.sub_status ? `, ${org.sub_status.replace("_", " ")}` : ""}{org.period_end ? ` until ${dateOnly(org.period_end)}` : ""}. Created {dateOnly(org.created_at)}, {org.timezone}.</>}
        meta={<>ID {org.id} · {org.slug}{org.status !== "active" ? ` · ${org.status.toUpperCase()}${org.suspended_reason ? `: ${org.suspended_reason}` : ""}` : ""}</>}
        actions={<>
          {org.status === "active" && can(admin, "organization.suspend") ? <AdminAction path={`/api/admin/organisations/${id}/actions`} body={{ action: "suspend" }} reason danger confirm={{ title: `Suspend ${org.name}?`, description: "Everyone in it is signed out and cannot sign back in until it is unsuspended. Nothing is deleted.", label: "Suspend" }}>Suspend</AdminAction> : null}
          {org.status !== "active" && can(admin, "organization.suspend") ? <AdminAction path={`/api/admin/organisations/${id}/actions`} body={{ action: "unsuspend" }} reason confirm={{ title: `Reinstate ${org.name}?`, label: "Reinstate" }} variant="primary">Reinstate</AdminAction> : null}
          {org.status !== "archived" && can(admin, "organization.delete") ? <AdminAction path={`/api/admin/organisations/${id}/actions`} body={{ action: "archive" }} reason danger confirm={{ title: `Archive ${org.name}?`, description: "The workspace closes, the subscription is cancelled, and the data is kept for the retention period. This is the soft delete.", label: "Archive" }}>Archive</AdminAction> : null}
        </>} />

      <Tabs tabs={TABS.map((x) => ({ label: x[0].toUpperCase() + x.slice(1), href: `${base}${x === "overview" ? "" : `?tab=${x}`}`, value: x }))} value={tab} className="mb-6" label="Organisation sections" />

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <Card><CardHeader title="Right now" /><Ledger items={[{ label: "People", value: seats, note: `${num(d.usage.active_users_7d)} active this week` }, { label: "Working now", value: num(d.activity.length), tone: d.activity.length ? "accent" : "default" }, { label: "Hours, 30 days", value: hours(d.usage.hours_30d) }, { label: "Storage", value: quota, tone: org.plan_max_storage && storage > org.plan_max_storage * 0.8 ? "danger" : "default" }]} /></Card>
            <Card><CardHeader title="Health profile" description="An operational profile, not a ranking." />
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                <li className="chip px-3 py-2"><span className="eyebrow">Adoption</span><p>{num(d.usage.active_users_7d)} of {num(org.users)} people active this week</p></li>
                <li className="chip px-3 py-2"><span className="eyebrow">Clock-ins, 30 days</span><p>{num(d.usage.clock_ins_30d)}</p></li>
                <li className="chip px-3 py-2"><span className="eyebrow">Tasks</span><p>{num(d.tasks.open)} open, {num(d.tasks.blocked)} blocked, {num(d.tasks.completed_30d)} done in 30 days</p></li>
                <li className="chip px-3 py-2"><span className="eyebrow">Recordings</span><p>{num(d.usage.recordings)} ({bytes(d.usage.recording_bytes)})</p></li>
                <li className="chip px-3 py-2"><span className="eyebrow">Billing</span><p>{org.plan_name ?? "No plan"}, {org.sub_status ?? "none"}{org.period_end ? `, ${org.sub_status === "trial" ? "trial ends" : "renews"} ${dateOnly(org.period_end)}` : ""}</p></li>
                <li className="chip px-3 py-2"><span className="eyebrow">Last activity</span><p>{org.last_activity_at ? relativeTime(org.last_activity_at) : "never"}</p></li>
              </ul>
            </Card>
          </div>
          <div className="space-y-4">
            <Card><CardHeader title="Teams" className="mb-2" /><ul className="space-y-1 text-sm">{d.teams.filter((x) => !x.archived_at).map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{x.name}</span><span className="text-fg-subtle">{x.members} people{x.leads.length ? `, lead ${x.leads.join(", ")}` : ", no lead"}</span></li>)}{d.teams.length === 0 ? <li className="text-fg-subtle">No teams yet.</li> : null}</ul></Card>
            <Card><CardHeader title="Recent admin actions" className="mb-2" /><ul className="space-y-1 text-xs text-fg-muted">{d.audit.slice(0, 6).map((a) => <li key={a.id}><span className="font-medium text-fg">{a.action}</span> · {a.admin_email ?? "system"} · {relativeTime(a.occurred_at)}{a.reason ? <p className="text-fg-subtle">{a.reason}</p> : null}</li>)}{d.audit.length === 0 ? <li><EmptyState compact title="Nothing here yet" icon3d="box-doc-check" /></li> : null}</ul></Card>
          </div>
        </div>
      ) : null}

      {tab === "users" ? (
        <DataTable caption="Members">
          <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Joined</th><th>Last seen</th><th></th></tr></thead>
          <tbody>{d.members.map((m) => <tr key={m.membership_id}><td><Link href={`/admin/users/${m.auth_user_id}`} className="font-semibold hover:underline">{m.display_name}</Link><p className="text-xs text-fg-subtle">{m.email} · {m.employee_code}</p></td><td>{m.role}</td><td>{m.user_status !== "active" ? <Badge tone="danger">{m.user_status}</Badge> : m.status !== "active" ? <Badge tone="neutral">{m.status}</Badge> : <Badge tone="success">active</Badge>}</td><td className="text-sm">{dateOnly(m.joined)}</td><td className="text-sm text-fg-muted">{m.last_seen ? relativeTime(m.last_seen) : "never"}</td><td className="text-right">{can(admin, "organization.impersonate") && m.user_status === "active" ? <ImpersonateButton userId={m.auth_user_id} name={m.display_name} /> : null}</td></tr>)}</tbody>
        </DataTable>
      ) : null}

      {tab === "teams" ? (
        <DataTable caption="Teams"><thead><tr><th>Team</th><th>Members</th><th>Leads</th><th>State</th></tr></thead><tbody>{d.teams.map((x) => <tr key={x.id}><td className="font-semibold">{x.name}</td><td className="tabular-nums">{x.members}</td><td>{x.leads.join(", ") || <span className="text-warning">no lead</span>}</td><td>{x.archived_at ? <Badge tone="neutral">archived</Badge> : <Badge tone="success">active</Badge>}</td></tr>)}</tbody></DataTable>
      ) : null}

      {tab === "activity" ? (d.activity.length === 0 ? <EmptyState icon3d="stopwatch" title="Nobody has a session open" description="Open timers appear here as they run." /> : (
        <DataTable caption="Open sessions"><thead><tr><th>Person</th><th>State</th><th>Task</th><th>Since</th><th>Last heartbeat</th></tr></thead><tbody>{d.activity.map((a, i) => <tr key={i}><td className="font-semibold">{a.display_name}</td><td><Badge tone={a.state === "running" ? "success" : "warning"} dot>{a.state}</Badge></td><td>{a.task_title}</td><td className="text-sm">{formatDateTime(a.started_at, org.timezone)}</td><td className="text-sm text-fg-muted">{relativeTime(a.last_heartbeat_at)}</td></tr>)}</tbody></DataTable>
      )) : null}

      {tab === "tasks" ? <Card><Ledger items={[{ label: "Open", value: num(d.tasks.open) }, { label: "Blocked", value: num(d.tasks.blocked), tone: d.tasks.blocked ? "danger" : "default" }, { label: "Waiting for a check", value: num(d.tasks.in_review) }, { label: "Completed", value: num(d.tasks.completed), note: `${num(d.tasks.completed_30d)} in 30 days` }]} /></Card> : null}

      {tab === "attendance" ? (d.attendance.length === 0 ? <EmptyState icon3d="clock-in" title="No clock-ins in the last two weeks" /> : (
        <DataTable caption="Clock-ins by day"><thead><tr><th>Day</th><th>Clock-ins</th><th>Late</th></tr></thead><tbody>{d.attendance.map((a) => <tr key={a.local_date}><td>{dateOnly(a.local_date)}</td><td className="tabular-nums">{a.clock_ins}</td><td className="tabular-nums">{a.late ? <span className="text-warning">{a.late}</span> : 0}</td></tr>)}</tbody></DataTable>
      )) : null}

      {tab === "usage" ? <Card><Ledger items={[{ label: "Sessions, 30 days", value: num(d.usage.sessions_30d) }, { label: "Hours, 30 days", value: hours(d.usage.hours_30d) }, { label: "Clock-ins, 30 days", value: num(d.usage.clock_ins_30d) }, { label: "Active people, 7 days", value: num(d.usage.active_users_7d) }]} /></Card> : null}

      {tab === "billing" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Card><CardHeader title="Subscription" /><Ledger items={[{ label: "Plan", value: org.plan_name ?? "None" }, { label: "Status", value: org.sub_status ?? "none" }, { label: org.sub_status === "trial" ? "Trial ends" : "Period ends", value: org.period_end ? dateOnly(org.period_end) : "—" }, { label: "Auto-renew", value: org.auto_renew ? "On" : "Off" }]} />
              <p className="eyebrow mt-3">Interval {org.billing_interval ?? "monthly"} · Last payment {org.last_payment_at ? dateOnly(org.last_payment_at) : "none"} · Payment status {org.payment_status ?? "—"}</p></Card>
            <Card><CardHeader title="Payments" action={<Link href={`/admin/billing/payments?org=${id}`} className="link-action">All</Link>} />
              {d.payments.length === 0 ? <p className="text-sm text-fg-subtle">No payments yet.</p> : <DataTable caption="Payments"><thead><tr><th>Reference</th><th>Plan</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{d.payments.map((p) => <tr key={p.id}><td><Link href={`/admin/billing/payments/${p.id}`} className="font-mono text-xs hover:underline">{p.reference}</Link></td><td>{p.plan_name ?? "—"}</td><td className="tabular-nums">{money(p.amount, p.currency)}</td><td><Badge tone={p.status === "success" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{p.status}</Badge></td><td className="text-sm">{dateOnly(p.paid_at ?? p.created_at)}</td></tr>)}</tbody></DataTable>}</Card>
          </div>
          {can(admin, "subscription.edit") ? <div className="space-y-4"><Card><CardHeader title="Change plan" className="mb-2" /><OrgPlanForm orgId={id} plans={d.plans} current={{ planId: org.sub_id ? d.plans.find((p) => p.code === org.plan_code)?.id ?? "" : "", interval: org.billing_interval ?? "monthly" }} /></Card><Card><CardHeader title="Extend trial" description="Adds days to the current period and puts an expired subscription back on trial." className="mb-2" /><JsonForm path={`/api/admin/organisations/${id}/actions`} transform={(d) => ({ action: "extend_trial", days: Number(d.days), reason: String(d.reason) })} submitLabel="Extend"><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Days</span><input name="days" type="number" min={1} max={365} defaultValue={14} className={inputCls} required /></label><label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span>Reason</span><input name="reason" className={inputCls} required minLength={3} /></label></JsonForm></Card></div> : null}
        </div>
      ) : null}

      {tab === "storage" ? <Card><Ledger items={[{ label: "Recordings", value: bytes(d.usage.recording_bytes), note: `${num(d.usage.recordings)} files` }, { label: "Deliverables", value: bytes(d.usage.deliverable_bytes) }, { label: "Total", value: bytes(storage) }, { label: "Plan limit", value: org.plan_max_storage ? bytes(org.plan_max_storage) : "None" }]} /></Card> : null}

      {tab === "security" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Feature overrides" description="Per-organisation switches that win over the plan and the global flags. Leave a feature unset to inherit." className="mb-2" />{can(admin, "organization.edit") ? <FeatureOverridesForm orgId={id} keys={d.featureKeys} overrides={org.feature_overrides} plan={org.plan_features ?? {}} /> : <p className="text-sm text-fg-muted">Your role can view but not change these.</p>}</Card>
          <Card><CardHeader title="Account" className="mb-2" /><Ledger items={[{ label: "Status", value: org.status, tone: org.status === "active" ? "default" : "danger" }, { label: "Suspended", value: org.suspended_at ? dateOnly(org.suspended_at) : "—" }, { label: "Archived", value: org.archived_at ? dateOnly(org.archived_at) : "—" }, { label: "Members", value: num(org.users) }]} />{org.suspended_reason ? <p className="mt-3 text-sm text-fg-muted">Reason: {org.suspended_reason}</p> : null}</Card>
        </div>
      ) : null}

      {tab === "audit" ? (d.audit.length === 0 ? <EmptyState icon3d="shield-check" title="No administrative actions yet" /> : (
        <DataTable caption="Administrative actions"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Reason</th></tr></thead><tbody>{d.audit.map((a) => <tr key={a.id}><td className="text-sm">{formatDateTime(a.occurred_at)}</td><td>{a.admin_email ?? "system"}</td><td className="font-mono text-xs">{a.action}</td><td className="text-sm text-fg-muted">{a.reason ?? "—"}</td></tr>)}</tbody></DataTable>
      )) : null}
      <p className="eyebrow mt-6">Hours are confirmed intervals; storage counts recordings and deliverables · {formatDuration(Math.round(d.usage.hours_30d * 3600))} in 30 days</p>
    </>
  );
}
