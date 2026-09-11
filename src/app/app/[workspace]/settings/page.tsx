import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { PermissionDenied, Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { settingsView } from "@/server/services/views";
import { OrgSettingsForm, ScheduleForm, PolicyForm, GrantsPanel } from "@/components/app/settings-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ setup?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/settings`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied /></AppShell>;
  const { policy, schedule, grants, members, teams, counts: c } = await settingsView(ctx);
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
      <PageHeader overline="Workspace" title="Settings" description="Values here live in policy and schedule records, not in the interface. Changes are audited." />
      {sp.setup ? <Alert tone="success" className="mb-6" title="Workspace ready">Work through the checklist to finish setup.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card><h2 className="font-display text-lg">Organisation</h2><OrgSettingsForm orgSlug={ctx.org.slug} name={ctx.org.name} timezone={ctx.org.timezone} /></Card>
          <Card><h2 className="font-display text-lg">Working schedule</h2><p className="mb-3 text-sm text-fg-muted">Informational: used for the end-of-day reminder and report completeness. Never an automatic pay rule.</p><ScheduleForm orgSlug={ctx.org.slug} schedule={schedule} /></Card>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-lg">Monitoring policy</h2>{policy ? <Badge tone="accent">version {policy.version}</Badge> : null}</div>
            <p className="mb-3 text-sm text-fg-muted">Publishing creates a new version; every member must acknowledge it before starting recorded sessions. Recording stays disabled until you activate it here. Retention: {policy?.retention_days ?? 7} days (1–30 in the pilot; not a legal compliance claim). Heartbeat every {policy?.heartbeat_seconds ?? 30}s, stale after {policy?.stale_after_seconds ?? 90}s.</p>
            {isOwner ? <PolicyForm orgSlug={ctx.org.slug} policy={policy} /> : <Alert tone="info">Only owners can publish policy versions.</Alert>}
          </Card>
          <Card>
            <h2 className="font-display text-lg">Recording access grants</h2>
            <p className="mb-3 text-sm text-fg-muted">Company role alone grants no playback. Grants are explicit, scoped and logged. A privacy administrator resolves flagged footage.</p>
            <GrantsPanel orgSlug={ctx.org.slug} grants={grants} members={members} teams={teams} isOwner={isOwner} />
          </Card>
        </div>
        <aside className="space-y-4">
          <Card>
            <h2 className="font-display text-lg">Setup checklist</h2>
            <ul className="mt-2 space-y-2 text-sm">{checklist.map((i) => <li key={i.label} className="flex items-center gap-2"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${i.done ? "bg-success" : "bg-fg-subtle"}`} /><span className={i.done ? "" : "text-fg-muted"}>{i.label}</span></li>)}</ul>
            <div className="mt-3 flex flex-col gap-1 text-sm"><Link className="underline" href={`/app/${ctx.org.slug}/people`}>Invite people and define teams</Link><Link className="underline" href={`/app/${ctx.org.slug}/projects`}>Create a project</Link></div>
          </Card>
          <Card>
            <h2 className="font-display text-lg">Attachments</h2>
            <p className="mt-1 text-sm text-fg-muted">Allowed: {(policy?.attachment_mime_types ?? []).map((m) => m.split("/")[1]).join(", ")} · max {Math.round((policy?.attachment_max_bytes ?? 0) / 1048576)} MB · private storage; downloads use 60-second links.</p>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
