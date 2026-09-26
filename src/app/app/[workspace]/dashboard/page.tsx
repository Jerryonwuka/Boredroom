import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { PermissionDenied, EmptyState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { orgDashboard } from "@/server/services/views";
import { attendanceBoard } from "@/server/services/attendance";
import { formatDuration, formatDateTime, relativeTime, formatLongDate, cn } from "@/lib/utils";
import { Person } from "@/components/ui/person";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { ClipboardCheck } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function pct(n: number, of: number) { return of ? `${Math.round((n / of) * 100)}%` : ""; }

export default async function DashboardPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/dashboard`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="The organisation dashboard is for the organisation account (owners and HR). Team leads use their team board; staff use My Day." /></AppShell>;
  const [d, att] = await Promise.all([orgDashboard(ctx), attendanceBoard(ctx)]);
  const base = `/app/${ctx.org.slug}`;
  const now = new Date(d.serverNow).getTime();
  const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: att.schedule.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const clockedIn = att.counts.in + att.counts.out;
  const people = clockedIn + att.counts.not_in;

  // Three verdicts: the room, the day and the work. Each row beneath is a fact with its share.
  const attendanceVerdict = clockedIn === 0 ? "Nobody yet" : att.counts.late ? `${att.counts.late} late` : "On time";
  const focusVerdict = d.counts.working === 0 ? "Quiet" : `${d.counts.working} working`;
  const deliveryVerdict = d.counts.tasks_blocked ? "Needs a look" : d.counts.tasks_done_today ? "Moving" : "Nothing done yet";

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="eye-dashboard" overline={formatLongDate(d.today)} title={<>Welcome, {ctx.user.displayName.split(" ")[0]}.</>} description={<>Here is {ctx.org.name} right now, from clocks, timers and tasks. Nothing here is a productivity score.</>} meta={<>Last sync {formatDateTime(d.serverNow, ctx.org.timezone)}</>}
        actions={<><Link href={`${base}/people`}><Button>Add people and teams</Button></Link><Link href={`${base}/reviews`} aria-label={counts.attention ? `Review queue, ${counts.attention} waiting` : "Review queue"} title="Review queue" className={cn(ICON_BUTTON, "size-11")}><ClipboardCheck className="size-[18px]" aria-hidden />{counts.attention ? <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums text-accent-fg">{counts.attention > 99 ? "99+" : counts.attention}</span> : null}</Link></>} />

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <StatCard label="Attendance" verdict={attendanceVerdict} tone={att.counts.late ? "warning" : "default"} href={`${base}/attendance`}
          rows={[{ label: "Clocked in", value: clockedIn, share: pct(clockedIn, people), tone: "success" }, { label: "Late", value: att.counts.late, share: pct(att.counts.late, people), tone: "warning" }, { label: "Not clocked in", value: att.counts.not_in, share: pct(att.counts.not_in, people), tone: "neutral" }]} />
        <StatCard label="Focus" verdict={focusVerdict} tone={d.counts.working ? "accent" : "default"} href={`${base}/workroom`}
          rows={[{ label: "Working now", value: d.counts.working, share: pct(d.counts.working, people), tone: "accent" }, { label: "Connected", value: d.counts.connected, share: pct(d.counts.connected, people), tone: "info" }]} />
        <StatCard label="Delivery" verdict={deliveryVerdict} tone={d.counts.tasks_blocked ? "danger" : "default"} href={`${base}/tasks`}
          rows={[{ label: "Done today", value: d.counts.tasks_done_today, tone: "success" }, { label: "Open", value: d.counts.tasks_open, tone: "neutral" }, { label: "Blocked", value: d.counts.tasks_blocked, tone: "danger" }]} />
      </div>

      <section className="mb-8">
        <CardHeader title="Working right now" action={<Link href={`${base}/workroom`} className="link-action">Open the Workroom</Link>} />
        {d.workingNow.length === 0 ? <EmptyState icon3d="stopwatch" title="Nobody has a session open" description="Open sessions appear here the moment someone presses Start." /> : (
          <DataTable caption="People with an open session">
            <thead><tr><th>Person</th><th>Team</th><th>State</th><th>Task</th><th>Since</th><th>Sync</th><th>Today</th></tr></thead>
            <tbody>{d.workingNow.map((w) => {
              const stale = w.state === "running" && now - new Date(w.last_heartbeat_at).getTime() > d.staleAfterSeconds * 1000;
              return <tr key={w.membership_id}><td><Person orgSlug={ctx.org.slug} membershipId={w.membership_id} name={w.display_name} href={`${base}/workroom/${w.membership_id}`} /></td><td className="text-fg-muted">{w.team_names.join(", ") || "—"}</td><td><Badge tone={stale ? "danger" : SESSION_STATE_TONE[w.state]} dot>{stale ? "stale" : label(w.state)}</Badge></td><td><Link href={`${base}/tasks/${w.task_id}`} className="hover:underline">{w.task_title}</Link></td><td className="text-sm">{formatDateTime(w.started_at, ctx.org.timezone)}</td><td className="text-sm text-fg-muted">{relativeTime(w.last_heartbeat_at, now)}</td><td className="tabular-nums">{formatDuration(w.today_seconds)}</td></tr>;
            })}</tbody>
          </DataTable>
        )}
      </section>

      <section className="mb-8">
        <CardHeader title={<span className="flex items-center gap-2">Clocked in today<Badge tone="accent" dot>Today</Badge></span>} action={<Link href={`${base}/attendance`} className="link-action">Open Attendance</Link>} />
        {clockedIn === 0 ? <EmptyState icon3d="clock-in" title="Nobody has clocked in yet today" description="People appear here the moment they press Clock in. This list starts empty every day." /> : (
          <DataTable caption="People who clocked in today">
            <thead><tr><th>Person</th><th className="hidden md:table-cell">Team</th><th>Clocked in</th><th>Status</th><th className="hidden md:table-cell">Clocked out</th></tr></thead>
            <tbody>{att.people.filter((p) => p.clock_in_at).map((p) => (
              <tr key={p.membership_id}>
                <td><Person orgSlug={ctx.org.slug} membershipId={p.membership_id} name={p.display_name} href={`${base}/workroom/${p.membership_id}`} /></td>
                <td className="hidden text-fg-muted md:table-cell">{p.teams.join(", ") || "—"}</td>
                <td className="tabular-nums">{fmtTime(p.clock_in_at!)}</td>
                <td>{(p.late_seconds ?? 0) > 0 ? <Badge tone="warning">Late by {formatDuration(p.late_seconds!)}</Badge> : <Badge tone="success">On time</Badge>}</td>
                <td className="hidden tabular-nums md:table-cell">{p.clock_out_at ? fmtTime(p.clock_out_at) : <span className="text-fg-subtle">still in</span>}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <section>
          <CardHeader title="Teams" action={<Link href={`${base}/people?tab=teams`} className="link-action">Manage teams</Link>} />
          {d.teams.length === 0 ? <EmptyState icon3d="people" title="No teams yet" description="Create teams such as Design, Tech or Branding, then put a team lead on each." action={<Link href={`${base}/people`}><Button size="sm">Go to People</Button></Link>} /> : (
            <DataTable caption="Teams">
              <thead><tr><th>Team</th><th>Lead</th><th>Members</th><th>Open</th><th>Blocked</th><th>Working now</th></tr></thead>
              <tbody>{d.teams.map((t) => <tr key={t.id}><td><Link href={`${base}/teams/${t.id}`} className="font-semibold hover:underline">{t.name}</Link></td><td>{t.leads.length ? <span className="flex items-center -space-x-1.5">{t.leads.map((name, i) => <Person key={t.lead_ids[i] ?? name} orgSlug={ctx.org.slug} membershipId={t.lead_ids[i] ?? name} name={name} showName={false} size={30} href={`${base}/workroom/${t.lead_ids[i] ?? ""}`} className="ring-2 ring-[var(--bg-elevated)] rounded-full" />)}</span> : <span className="text-warning">no lead yet</span>}</td><td className="tabular-nums">{t.members}</td><td className="tabular-nums">{t.open_tasks}</td><td className="tabular-nums">{t.blocked ? <span className="text-danger">{t.blocked}</span> : 0}</td><td className="tabular-nums">{t.working}</td></tr>)}</tbody>
            </DataTable>
          )}
        </section>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Recently completed" />
            <ul className="space-y-2 text-sm">{d.recentDone.length === 0 ? <li className="text-fg-subtle">Nothing approved yet.</li> : d.recentDone.map((t) => <li key={t.id} className="chip chip-link px-3 py-2"><Link href={`${base}/tasks/${t.id}`} className="block font-medium hover:underline">{t.title}</Link><p className="text-xs text-fg-subtle">{t.assignee_name}, {formatDateTime(t.completed_at, ctx.org.timezone)}</p></li>)}</ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
