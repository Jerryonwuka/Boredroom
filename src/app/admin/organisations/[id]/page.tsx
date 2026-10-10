import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, HardDrive, ShieldCheck, Timer, UsersRound } from "lucide-react";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { requireAdmin, can } from "@/server/admin/auth";
import { organisationDetail } from "@/server/admin/organisations";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { ProgressBar } from "@/components/ui/progress-arc";
import { buttonVariants } from "@/components/ui/button";
import { AdminAction, SheetButton } from "@/components/admin/actions";
import { Cells, Facts, ORG_ROLE, linkCls, subCls, words } from "@/components/admin/fields";
import { OrgPlanForm, FeatureOverridesForm, ExtendTrialForm } from "@/components/admin/org-forms";
import { ImpersonateButton } from "@/components/admin/impersonate";
import { bytes, dateOnly, num, hours, money } from "@/lib/format";
import { cn, formatDateTime, formatDuration, relativeTime } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Organisation" };
const TABS = ["overview", "users", "teams", "activity", "tasks", "attendance", "usage", "billing", "storage", "security", "audit"] as const;
const PAYMENT_TONE = (s: string) => (s === "success" ? "success" : s === "failed" ? "danger" : "neutral") as "success" | "danger" | "neutral";

export default async function OrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("organization.view");
  const { id } = await params;
  const { tab: t } = await searchParams;
  const tab = (TABS as readonly string[]).includes(t ?? "") ? (t as (typeof TABS)[number]) : "overview";
  let d: Awaited<ReturnType<typeof organisationDetail>>;
  try { d = await organisationDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const { org } = d;
  const base = `/admin/organisations/${id}`;
  const act = `/api/admin/organisations/${id}/actions`;
  const storage = Number(d.usage.deliverable_bytes);
  const seats = org.plan_max_users ? `${org.users} / ${org.plan_max_users}` : `${org.users}`;
  const quota = org.plan_max_storage ? `${bytes(storage)} / ${bytes(org.plan_max_storage)}` : bytes(storage);
  const heavy = !!org.plan_max_storage && storage > org.plan_max_storage * 0.8;
  const working = d.activity.filter((a) => a.state === "running").length;
  const auditList = (items: typeof d.audit) => (
    <ul className="grid gap-2.5">
      {items.map((a) => (
        <li key={a.id} className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground">{a.action}</p>
          <p className={subCls}>{a.admin_email ?? "System"}, {relativeTime(a.occurred_at)}</p>
          {a.reason ? <p className="text-meta font-normal text-secondary">{a.reason}</p> : null}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div>
        <PageHeader back={{ href: "/admin/organisations", label: "Organisations" }} title={org.name}
          description={<>{org.owner_name ? <>Owned by {org.owner_name} ({org.owner_email}). </> : "No owner yet. "}{org.plan_name ?? "No plan"}{org.sub_status ? `, ${words(org.sub_status).toLowerCase()}` : ""}{org.period_end ? ` until ${dateOnly(org.period_end)}` : ""}. Created {dateOnly(org.created_at)}, {org.timezone}.</>}
          meta={<>ID <span className="font-mono">{org.id}</span>, {org.slug}{org.status !== "active" ? `, ${words(org.status).toLowerCase()}${org.suspended_reason ? `: ${org.suspended_reason}` : ""}` : ""}</>}
          actions={<>
            {org.status === "active" && can(admin, "organization.suspend") ? <AdminAction path={act} body={{ action: "suspend" }} reason danger confirm={{ title: `Suspend ${org.name}?`, description: "Everyone in it is signed out and cannot sign back in until it is unsuspended. Nothing is deleted.", label: "Suspend" }}>Suspend</AdminAction> : null}
            {org.status !== "active" && can(admin, "organization.suspend") ? <AdminAction path={act} body={{ action: "unsuspend" }} reason confirm={{ title: `Reinstate ${org.name}?`, label: "Reinstate" }} variant="primary">Reinstate</AdminAction> : null}
            {org.status !== "archived" && can(admin, "organization.delete") ? <AdminAction path={act} body={{ action: "archive" }} reason danger confirm={{ title: `Archive ${org.name}?`, description: "The workspace closes, the subscription is cancelled, and the data is kept for the retention period. This is the soft delete.", label: "Archive" }}>Archive</AdminAction> : null}
          </>}
          tabs={TABS.map((x) => ({ label: words(x), href: `${base}${x === "overview" ? "" : `?tab=${x}`}`, value: x }))} tabValue={tab} tabsLabel="Organisation sections" />

        {tab === "overview" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid content-start gap-6">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <StatCard label="People" value={seats} icon={<UsersRound />} hint={`${num(d.usage.active_users_7d)} active this week`} />
                <StatCard label="Working now" value={num(d.activity.length)} icon={<Timer />} hint={working ? <span className="inline-flex items-center gap-1.5"><StatusDot tone="live" /><span className="tabular-nums">{num(working)}</span> running</span> : "No timer running"} />
                <StatCard label="Hours, 30 days" value={hours(d.usage.hours_30d)} icon={<Clock />} hint="Confirmed intervals" />
                <StatCard label="Storage" value={quota} tone={heavy ? "danger" : "default"} icon={<HardDrive />}
                  actions={org.plan_max_storage ? <ProgressBar value={storage} max={Number(org.plan_max_storage)} label="Storage used of the plan's limit" size="sm" doneTone="accent" /> : undefined} />
              </div>
              <Card>
                <CardHeader title="Health profile" />
                <Cells items={[
                  { label: "Adoption", value: <>{num(d.usage.active_users_7d)} of {num(org.users)} people active this week</> },
                  { label: "Clock-ins, 30 days", value: <span className="tabular-nums">{num(d.usage.clock_ins_30d)}</span> },
                  { label: "Tasks", value: <>{num(d.tasks.open)} open, {num(d.tasks.blocked)} blocked, {num(d.tasks.completed_30d)} done in 30 days</> },
                  { label: "Files", value: <>{bytes(d.usage.deliverable_bytes)} of deliverables, {num(d.usage.voice_notes)} voice notes</> },
                  { label: "Billing", value: <>{org.plan_name ?? "No plan"}, {org.sub_status ? words(org.sub_status).toLowerCase() : "none"}{org.period_end ? `, ${org.sub_status === "trial" ? "trial ends" : "renews"} ${dateOnly(org.period_end)}` : ""}</> },
                  { label: "Last activity", value: org.last_activity_at ? relativeTime(org.last_activity_at) : "Never" },
                ]} />
              </Card>
            </div>
            <div className="grid content-start gap-3">
              <Card>
                <CardHeader title="Teams" size="sm" className="mb-3" action={<Link href={`${base}?tab=teams`} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-2")}>All<AnimatedChevronRight aria-hidden /></Link>} />
                {d.teams.filter((x) => !x.archived_at).length === 0 ? <p className="text-sm font-normal text-secondary">No teams yet.</p> : (
                  <ul className="grid gap-2.5">{d.teams.filter((x) => !x.archived_at).map((x) => (
                    <li key={x.id} className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{x.name}</p><p className={subCls}>{x.members} people{x.leads.length ? `, lead ${x.leads.join(", ")}` : ", no lead"}</p></li>
                  ))}</ul>
                )}
              </Card>
              <Card>
                <CardHeader title="Recent admin actions" size="sm" className="mb-3" action={<Link href={`${base}?tab=audit`} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-2")}>All<AnimatedChevronRight aria-hidden /></Link>} />
                {d.audit.length === 0 ? <EmptyState compact icon={ShieldCheck} title="Nothing here yet" /> : auditList(d.audit.slice(0, 6))}
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "users" ? (d.members.length === 0 ? <EmptyState icon={UsersRound} title="Nobody in this organisation yet" /> : (
          <DataTable caption="Members">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Joined</th><th>Last seen</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.members.map((m) => (
              <tr key={m.membership_id}>
                <td><Link href={`/admin/users/${m.auth_user_id}`} className={linkCls}>{m.display_name}</Link><span className={subCls}>{m.email}, {m.employee_code}</span></td>
                <td>{ORG_ROLE[m.role] ?? words(m.role)}</td>
                <td>{m.user_status !== "active" ? <Badge tone="danger">{words(m.user_status)}</Badge> : m.status !== "active" ? <Badge>{words(m.status)}</Badge> : <Badge tone="success">Active</Badge>}</td>
                <td className="tabular-nums">{dateOnly(m.joined)}</td>
                <td className="text-secondary">{m.last_seen ? relativeTime(m.last_seen) : "Never"}</td>
                <td className="text-right">{can(admin, "organization.impersonate") && m.user_status === "active" ? <ImpersonateButton userId={m.auth_user_id} name={m.display_name} size="xs" /> : null}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )) : null}

        {tab === "teams" ? (d.teams.length === 0 ? <EmptyState icon={UsersRound} title="No teams yet" /> : (
          <DataTable caption="Teams">
            <thead><tr><th>Team</th><th>Members</th><th>Leads</th><th>State</th></tr></thead>
            <tbody>{d.teams.map((x) => <tr key={x.id}><td className="font-medium">{x.name}</td><td className="tabular-nums">{x.members}</td><td>{x.leads.join(", ") || <span className="text-warning">No lead</span>}</td><td>{x.archived_at ? <Badge>Archived</Badge> : <Badge tone="success">Active</Badge>}</td></tr>)}</tbody>
          </DataTable>
        )) : null}

        {tab === "activity" ? (d.activity.length === 0 ? <EmptyState icon={Timer} title="Nobody has a session open" description="Open timers appear here as they run." /> : (
          <DataTable caption="Open sessions">
            <thead><tr><th>Person</th><th>State</th><th>Task</th><th>Since</th><th>Last heartbeat</th></tr></thead>
            <tbody>{d.activity.map((a, i) => (
              <tr key={i}>
                <td className="font-medium">{a.display_name}</td>
                <td>{a.state === "running" ? <Badge><StatusDot tone="live" pulse={false} size={6} />Running</Badge> : <Badge tone="warning" dot>{words(a.state)}</Badge>}</td>
                <td>{a.task_title}</td>
                <td className="tabular-nums">{formatDateTime(a.started_at, org.timezone)}</td>
                <td className="text-secondary">{relativeTime(a.last_heartbeat_at)}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )) : null}

        {tab === "tasks" ? <Ledger items={[{ label: "Open", value: num(d.tasks.open) }, { label: "Blocked", value: num(d.tasks.blocked), tone: d.tasks.blocked ? "danger" : "default" }, { label: "Waiting for a check", value: num(d.tasks.in_review) }, { label: "Completed", value: num(d.tasks.completed), note: `${num(d.tasks.completed_30d)} in 30 days` }]} /> : null}

        {tab === "attendance" ? (d.attendance.length === 0 ? <EmptyState icon={Clock} title="No clock-ins in the last two weeks" /> : (
          <DataTable caption="Clock-ins by day">
            <thead><tr><th>Day</th><th>Clock-ins</th><th>Late</th></tr></thead>
            <tbody>{d.attendance.map((a) => <tr key={a.local_date}><td className="tabular-nums">{dateOnly(a.local_date)}</td><td className="tabular-nums">{a.clock_ins}</td><td className="tabular-nums">{a.late ? <span className="text-warning">{a.late}</span> : 0}</td></tr>)}</tbody>
          </DataTable>
        )) : null}

        {tab === "usage" ? <Ledger items={[{ label: "Sessions, 30 days", value: num(d.usage.sessions_30d) }, { label: "Hours, 30 days", value: hours(d.usage.hours_30d) }, { label: "Clock-ins, 30 days", value: num(d.usage.clock_ins_30d) }, { label: "Active people, 7 days", value: num(d.usage.active_users_7d) }]} /> : null}

        {tab === "billing" ? (
          <div className="grid gap-6">
            <Card>
              <CardHeader title="Subscription" action={can(admin, "subscription.edit") ? <>
                <SheetButton label="Change plan" title={`Change ${org.name}'s plan`} description="The change is immediate and written to the audit trail with your reason.">
                  <OrgPlanForm orgId={id} plans={d.plans} current={{ planId: org.sub_id ? d.plans.find((p) => p.code === org.plan_code)?.id ?? "" : "", interval: org.billing_interval ?? "monthly" }} />
                </SheetButton>
                <SheetButton label="Extend trial" title="Extend the trial" description="Adds days to the current period and puts an expired subscription back on trial.">
                  <ExtendTrialForm orgId={id} />
                </SheetButton>
              </> : undefined} />
              <div className="grid gap-x-8 md:grid-cols-2">
                <Facts items={[
                  { label: "Plan", value: org.plan_name ?? "None" },
                  { label: "Status", value: org.sub_status ? words(org.sub_status) : "None" },
                  { label: org.sub_status === "trial" ? "Trial ends" : "Period ends", value: org.period_end ? dateOnly(org.period_end) : "Not set" },
                  { label: "Auto-renew", value: org.auto_renew ? "On" : "Off" },
                ]} />
                <Facts items={[
                  { label: "Interval", value: words(org.billing_interval ?? "monthly") },
                  { label: "Last payment", value: org.last_payment_at ? dateOnly(org.last_payment_at) : "None" },
                  { label: "Payment status", value: org.payment_status ? words(org.payment_status) : "None" },
                ]} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Payments" action={<Link href={`/admin/billing/payments?org=${id}`} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-2")}>All<AnimatedChevronRight aria-hidden /></Link>} />
              {d.payments.length === 0 ? <p className="text-sm font-normal text-secondary">No payments yet.</p> : (
                <DataTable caption="Payments">
                  <thead><tr><th>Reference</th><th>Plan</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
                  <tbody>{d.payments.map((p) => <tr key={p.id}><td><Link href={`/admin/billing/payments/${p.id}`} className={cn(linkCls, "font-mono text-xs")}>{p.reference}</Link></td><td>{p.plan_name ?? <span className="text-secondary">None</span>}</td><td className="tabular-nums">{money(p.amount, p.currency)}</td><td><Badge tone={PAYMENT_TONE(p.status)}>{words(p.status)}</Badge></td><td className="tabular-nums">{dateOnly(p.paid_at ?? p.created_at)}</td></tr>)}</tbody>
                </DataTable>
              )}
            </Card>
          </div>
        ) : null}

        {tab === "storage" ? (
          <div className="grid gap-3">
            <Ledger items={[{ label: "Deliverables", value: bytes(d.usage.deliverable_bytes), tone: heavy ? "danger" : "default" }, { label: "Voice notes", value: num(d.usage.voice_notes) }, { label: "Avatars", value: num(d.usage.avatars) }, { label: "Plan limit", value: org.plan_max_storage ? bytes(org.plan_max_storage) : "None" }]} />
            {org.plan_max_storage ? <ProgressBar value={storage} max={Number(org.plan_max_storage)} label="Storage used of the plan's limit" valueText={`${bytes(storage)} of ${bytes(org.plan_max_storage)}`} doneTone="accent" /> : null}
          </div>
        ) : null}

        {tab === "security" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Feature overrides" description="Per-organisation switches that win over the plan and the global flags. Leave a feature on Inherit to follow them." />
              {can(admin, "organization.edit") ? <FeatureOverridesForm orgId={id} keys={d.featureKeys} overrides={org.feature_overrides} plan={org.plan_features ?? {}} /> : <p className="text-sm font-normal text-secondary">Your role can view but not change these.</p>}
            </Card>
            <Card className="self-start">
              <CardHeader title="Account" />
              <Facts items={[
                { label: "Status", value: org.status === "active" ? <Badge tone="success">Active</Badge> : <Badge tone="danger">{words(org.status)}</Badge> },
                { label: "Suspended", value: org.suspended_at ? dateOnly(org.suspended_at) : "Never" },
                { label: "Archived", value: org.archived_at ? dateOnly(org.archived_at) : "No" },
                { label: "Members", value: <span className="tabular-nums">{num(org.users)}</span> },
              ]} />
              {org.suspended_reason ? <p className="mt-3 text-sm font-normal text-secondary">Reason: {org.suspended_reason}</p> : null}
            </Card>
          </div>
        ) : null}

        {tab === "audit" ? (d.audit.length === 0 ? <EmptyState icon={ShieldCheck} title="No administrative actions yet" /> : (
          <DataTable caption="Administrative actions">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Reason</th></tr></thead>
            <tbody>{d.audit.map((a) => <tr key={a.id}><td className="tabular-nums">{formatDateTime(a.occurred_at)}</td><td>{a.admin_email ?? "System"}</td><td className="font-mono text-xs">{a.action}</td><td className="text-secondary">{a.reason ?? "None given"}</td></tr>)}</tbody>
          </DataTable>
        )) : null}
      </div>
      <PageNotes>
        {tab === "overview" ? <PageNote section="Health profile">An operational profile, not a ranking.</PageNote> : null}
        <PageNote>Hours are confirmed intervals; storage counts deliverables in bytes, and voice notes and avatars by number. {formatDuration(Math.round(d.usage.hours_30d * 3600))} in 30 days.</PageNote>
      </PageNotes>
    </>
  );
}
