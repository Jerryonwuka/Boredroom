import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied, EmptyState } from "@/components/ui/states";
import { orgDashboard } from "@/server/services/views";
import { formatDuration, formatDateTime, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/dashboard`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="The organisation dashboard is for the organisation account (owners and HR). Team leads use their team board; staff use My Day." /></AppShell>;
  const d = await orgDashboard(ctx);
  const base = `/app/${ctx.org.slug}`;
  const now = new Date(d.serverNow).getTime();
  const tiles = [
    { label: "Tasks done today", value: String(d.counts.tasks_done_today), note: `${d.counts.tasks_done_total} completed in total`, href: `${base}/reports` },
    { label: "People in organisation", value: String(d.counts.people), note: `${d.counts.teams} team${d.counts.teams === 1 ? "" : "s"}`, href: `${base}/people` },
    { label: "Accounts connected now", value: String(d.counts.connected), note: `${d.counts.working} session${d.counts.working === 1 ? "" : "s"} open (running, paused or interrupted)`, href: `${base}/team` },
    { label: "Total time today", value: formatDuration(d.counts.seconds_today), note: "confirmed timer time across everyone", href: `${base}/timesheets` },
  ];
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline={`Organisation · ${d.today}`} title={ctx.org.name} description={<>What is happening right now. Last sync {formatDateTime(d.serverNow, ctx.org.timezone)}. Counts are facts about tasks and timers, not a productivity score.</>}
        actions={<><Link href={`${base}/people`}><span className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-[15px] font-semibold text-accent-fg hover:bg-accent-hover">Add people and teams</span></Link><Link href={`${base}/reviews`}><span className="inline-flex h-11 items-center rounded-full border border-accent px-5 text-[15px] font-semibold hover:bg-accent-soft">Review queue{counts.attention ? ` (${counts.attention})` : ""}</span></Link></>} />
      <div className="mb-8 grid gap-4 md:grid-cols-4">
        {tiles.map((t) => <Link key={t.label} href={t.href} className="tile p-5 hover:border-border-strong"><p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{t.label}</p><p className="mt-1 font-display text-4xl">{t.value}</p><p className="mt-1 text-xs text-fg-muted">{t.note}</p></Link>)}
      </div>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Open tasks</p><p className="font-display text-3xl">{d.counts.tasks_open}</p></Card>
        <Card className={d.counts.tasks_blocked ? "border-danger/40" : ""}><p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Blocked</p><p className="font-display text-3xl">{d.counts.tasks_blocked}</p></Card>
        <Card><p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Waiting for review</p><p className="font-display text-3xl">{d.counts.tasks_in_review}<span className="ml-2 text-base text-fg-muted">tasks · {d.counts.reports_pending} reports</span></p></Card>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg">Working right now ({d.workingNow.length})</h2>
        {d.workingNow.length === 0 ? <EmptyState title="Nobody has a session open" description="Open sessions appear here the moment someone presses Start." /> : (
          <DataTable caption="People with an open session">
            <thead><tr><th>Person</th><th>Team</th><th>State</th><th>Task</th><th>Since</th><th>Sync</th><th>Today</th></tr></thead>
            <tbody>{d.workingNow.map((w) => {
              const stale = w.state === "running" && now - new Date(w.last_heartbeat_at).getTime() > d.staleAfterSeconds * 1000;
              return <tr key={w.membership_id}><td><Link href={`${base}/timesheets?member=${w.membership_id}`} className="font-semibold hover:underline">{w.display_name}</Link></td><td className="text-fg-muted">{w.team_names.join(", ") || "—"}</td><td><Badge tone={stale ? "danger" : SESSION_STATE_TONE[w.state]} dot>{stale ? "stale" : label(w.state)}</Badge></td><td><Link href={`${base}/tasks/${w.task_id}`} className="hover:underline">{w.task_title}</Link></td><td className="text-sm">{formatDateTime(w.started_at, ctx.org.timezone)}</td><td className="text-sm text-fg-muted">{relativeTime(w.last_heartbeat_at, now)}</td><td>{formatDuration(w.today_seconds)}</td></tr>;
            })}</tbody>
          </DataTable>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-3 font-display text-lg">Teams</h2>
          {d.teams.length === 0 ? <EmptyState title="No teams yet" description="Create teams such as Design, Tech or Branding, then put a team lead on each." action={<Link href={`${base}/people`} className="underline">Go to People</Link>} /> : (
            <DataTable caption="Teams">
              <thead><tr><th>Team</th><th>Lead</th><th>Members</th><th>Open</th><th>Blocked</th><th>Working now</th></tr></thead>
              <tbody>{d.teams.map((t) => <tr key={t.id}><td><Link href={`${base}/teams/${t.id}`} className="font-semibold hover:underline">{t.name}</Link></td><td>{t.leads.length ? t.leads.join(", ") : <span className="text-warning">no lead yet</span>}</td><td>{t.members}</td><td>{t.open_tasks}</td><td>{t.blocked ? <span className="text-danger">{t.blocked}</span> : 0}</td><td>{t.working}</td></tr>)}</tbody>
            </DataTable>
          )}
        </section>
        <Card>
          <h2 className="font-display text-lg">Recently completed</h2>
          <ul className="mt-2 space-y-2 text-sm">{d.recentDone.length === 0 ? <li className="text-fg-subtle">Nothing approved yet.</li> : d.recentDone.map((t) => <li key={t.id}><Link href={`${base}/tasks/${t.id}`} className="hover:underline">{t.title}</Link><p className="text-xs text-fg-subtle">{t.assignee_name} · {formatDateTime(t.completed_at, ctx.org.timezone)}</p></li>)}</ul>
        </Card>
      </div>
    </AppShell>
  );
}
