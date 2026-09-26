import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PermissionDenied, Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { settingsView } from "@/server/services/views";
import { OrgSettingsForm, ScheduleForm, PolicyForm, GrantsPanel, AssistantConnectionForm, RecordingSwitch } from "@/components/app/settings-forms";
import { assistantStatus } from "@/server/services/orgs";
import { orgBilling } from "@/server/admin/billing";
import { BillingCard } from "@/components/app/billing-card";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ setup?: string; billing?: string; plan?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/settings`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied /></AppShell>;
  const [{ policy, schedule, grants, members, teams, counts: c }, ai, billing] = await Promise.all([settingsView(ctx), assistantStatus(ctx), orgBilling(ctx)]);
  const isOwner = ctx.membership.role === "owner";
  const checklist = [
    { label: "Workspace created", done: true },
    { label: "Time zone and schedule set", done: !!schedule },
    { label: "Teams defined and managers assigned", done: c.teams > 0 },
    { label: "Monitoring policy reviewed", done: !!policy && policy.version >= 1 },
    { label: "At least one project", done: c.projects > 0 },
    { label: "Employees invited", done: c.members > 1 },
  ];
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader icon="desk" back={{ href: `/app/${ctx.org.slug}/dashboard`, label: "Dashboard" }} title="Settings" description="Values here live in policy and schedule records, not in the interface. Changes are audited." />
      {sp.setup ? <Alert tone="success" className="mb-6" title="Workspace ready">Work through the checklist to finish setup.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-3 font-display text-lg"><img src="/icons/screen-record.png" alt="" className="size-8" />Screen recording</h2><Badge tone={policy?.recording_mode === "disabled" ? "danger" : "success"} dot>{policy?.recording_mode === "disabled" ? "Off" : policy?.recording_mode === "optional" ? "On (each person's choice)" : "On, required on marked tasks"}</Badge></div>
            <p className="mb-3 text-sm text-fg-muted">When on, staff and team leads see <strong className="text-fg">Record screen</strong> in their timer once they have acknowledged the monitoring notice. Nothing records until they press it. Switching publishes a new notice version that everyone acknowledges once.</p>
            {isOwner ? <RecordingSwitch orgSlug={ctx.org.slug} mode={policy?.recording_mode ?? "disabled"} /> : <Alert tone="info">Only owners can change this.</Alert>}
          </Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-3 font-display text-lg"><img src="/icons/day-checklist.png" alt="" className="size-8" />AI assistant</h2><Badge tone={ai.source === "none" ? "warning" : "success"} dot>{ai.source === "none" ? "Not connected (built-in parser)" : ai.source === "organisation" ? `Connected, Claude (${ai.model})` : "Connected via server key"}</Badge></div>
            <p className="mb-3 text-sm text-fg-muted">The assistant on My Day turns typed or dictated notes into to-dos. Connect an Anthropic API key so it runs on Claude; without one a simple built-in parser is used and the page says so. The key is tested with one request, then stored encrypted and never shown again.</p>
            {isOwner ? <AssistantConnectionForm orgSlug={ctx.org.slug} status={ai} /> : <Alert tone="info">Only owners can connect the assistant.</Alert>}
          </Card>
          <Card id="billing"><CardHeader title="Plan and billing" description="What the organisation is on, and the other plans. Paid plans are billed through Paystack." /><BillingCard preselect={sp.plan} orgSlug={ctx.org.slug} data={billing} notice={sp.billing} /></Card>
          <Card><CardHeader title="Organisation" /><OrgSettingsForm orgSlug={ctx.org.slug} name={ctx.org.name} timezone={ctx.org.timezone} /></Card>
          <Card><CardHeader title="Working schedule and clocking" /><p className="mb-3 text-sm text-fg-muted">Everyone clocks in and out against these times, in the organisation&apos;s time zone. A clock-in after the start (plus any grace) is flagged late on the Attendance page. Also used for the end-of-day reminder; never an automatic pay rule.</p><ScheduleForm orgSlug={ctx.org.slug} schedule={schedule} /></Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-lg">Monitoring policy</h2>{policy ? <Badge tone="accent">version {policy.version}</Badge> : null}</div>
            <p className="mb-3 text-sm text-fg-muted">Publishing creates a new version; every member must acknowledge it before starting recorded sessions. The full notice, retention and reminder live here; the quick switch above only changes the recording mode. Retention: {policy?.retention_days ?? 7} days (1–30 in the pilot; not a legal compliance claim). Heartbeat every {policy?.heartbeat_seconds ?? 30}s, stale after {policy?.stale_after_seconds ?? 90}s.</p>
            {isOwner ? <PolicyForm orgSlug={ctx.org.slug} policy={policy} /> : <Alert tone="info">Only owners can publish policy versions.</Alert>}
          </Card>
          <Card>
            <CardHeader title="Recording access grants" className="mb-1" />
            <p className="mb-3 text-sm text-fg-muted">Supervisors (the owner, HR and a person’s team lead) can watch their people’s recordings. Grants extend playback to anyone else; every grant and every play is logged.</p>
            <GrantsPanel orgSlug={ctx.org.slug} grants={grants} members={members} teams={teams} isOwner={isOwner} />
          </Card>
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Setup checklist" className="mb-1" />
            <ul className="mt-2 space-y-2 text-sm">{checklist.map((i) => <li key={i.label} className="flex items-center gap-2"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${i.done ? "bg-success" : "bg-fg-subtle"}`} /><span className={i.done ? "" : "text-fg-muted"}>{i.label}</span></li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2"><Link href={`/app/${ctx.org.slug}/people`}><Button size="sm" variant="outline">People and teams</Button></Link><Link href={`/app/${ctx.org.slug}/projects`}><Button size="sm" variant="subtle">Projects</Button></Link></div>
          </Card>
          <Card>
            <CardHeader title="Attachments" className="mb-1" />
            <p className="mt-1 text-sm text-fg-muted">Allowed: {(policy?.attachment_mime_types ?? []).map((m) => m.split("/")[1]).join(", ")}, up to {Math.round((policy?.attachment_max_bytes ?? 0) / 1048576)} MB each, in private storage; downloads use 60-second links.</p>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
