import Link from "next/link";
import { ClipboardCheck, Hourglass, LogIn, SquareCheckBig, Timer, CircleCheck } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { TaskPeekLink } from "@/components/app/tasks-page";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { ProgressArc } from "@/components/ui/progress-arc";
import { taskViewer } from "@/server/lib/task-viewer";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { FilterBar, FilterSelect } from "@/components/ui/filter-control";
import { BarChart } from "@/components/ui/charts";
import { Badge, CountPill, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { ListRow } from "@/components/ui/rows";
import { ToolSquare } from "@/components/ui/tool-tile";
import { PermissionDenied, EmptyState } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Person } from "@/components/ui/person";
import { LiveClock, LiveSync, LiveRefresh, StatusDot } from "@/components/app/live";
import { orgDashboard } from "@/server/services/views";
import { attendanceBoard, attendanceMonth } from "@/server/services/attendance";
import { uuid } from "@/server/lib/api";
import { formatDuration, formatDateTime, relativeTime, formatLongDate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

const TABS = ["overview", "working", "clocked", "teams"] as const;
type Tab = (typeof TABS)[number];
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };

/**
 * The organisation dashboard (owners and HR), v4 analytics language: the page title with underline tabs, four stat
 * cards for right now, the analytics card (a metric strip over a monochrome chart of the month, today in orange) with
 * its Month and Team filters, then who is working and what was finished. The other tabs hold the full tables.
 * Nothing here is a productivity score: every figure comes from clocks, timers and tasks.
 */
export default async function DashboardPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string; month?: string; team?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/dashboard`);
  if (!["owner", "hr"].includes(ctx.membership.role)) return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="The organisation dashboard is for the organisation account (owners and HR). Team leads use their team board; staff use My Day." /></AppShell>;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  // A team id from the address bar is checked before it reaches a uuid column: a mistyped link shows everyone.
  const teamId = sp.team && uuid.safeParse(sp.team).success ? sp.team : null;
  const [d, att, m] = await Promise.all([orgDashboard(ctx), attendanceBoard(ctx), tab === "overview" ? attendanceMonth(ctx, { month: sp.month, teamId }) : Promise.resolve(null)]);
  const base = `/app/${ctx.org.slug}`;
  const tz = ctx.org.timezone;
  const now = new Date(d.serverNow).getTime();
  const fmtTime = (iso: string, zone = att.schedule.timezone) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  // A session that started today reads as a time; one left open since an earlier day keeps its date.
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const since = (iso: string) => (dayOf(iso) === d.today ? fmtTime(iso, tz) : formatDateTime(iso, tz));
  const clockedIn = att.counts.in + att.counts.out;
  const people = clockedIn + att.counts.not_in;
  const stale = (w: (typeof d.workingNow)[number]) => w.state === "running" && now - new Date(w.last_heartbeat_at).getTime() > d.staleAfterSeconds * 1000;
  const viewer = taskViewer(ctx);
  // One quiet way to hand the day's summary to Brenda (her page fills her box; the person presses Send).
  const askBrenda = ctx.plan.features.AI_ASSISTANT === true ? `${base}/home?ask=${encodeURIComponent("Summarise what the team got done today: hours worked, tasks finished, and anything blocked or overdue.")}` : null;
  const tabHref = (t: Tab) => `${base}/dashboard${t === "overview" ? "" : `?tab=${t}`}`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Dashboard" description={<>{ctx.org.name}, {formatLongDate(d.today)}. From clocks, timers and tasks; nothing here is a productivity score.</>}
        meta={<LiveSync at={fmtTime(d.serverNow, tz)} note="updates as people clock in, start and finish" />}
        actions={<>
          <Link href={`${base}/reviews`} className={buttonVariants({ variant: "secondary", size: "sm" })}><ClipboardCheck aria-hidden />Review queue{counts.attention ? <CountPill count={counts.attention} /> : null}</Link>
          <Link href={`${base}/people`} className={buttonVariants({ size: "sm" })}>Add people</Link>
        </>}
        tabsLabel="Dashboard sections" tabValue={tab}
        tabs={[
          { label: "Overview", value: "overview", href: tabHref("overview") },
          { label: "Working now", value: "working", href: tabHref("working"), count: d.workingNow.length },
          { label: "Clocked in", value: "clocked", href: tabHref("clocked"), count: clockedIn },
          { label: "Teams", value: "teams", href: tabHref("teams"), count: d.teams.length },
        ]} />
      <LiveRefresh seconds={Math.max(30, d.staleAfterSeconds)} />

      {tab === "overview" ? (
        <>
          {/* Sized by the room the page has (container query), not the window: beside the sidebar a 768px window leaves ~500px. */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
              <StatCard label="Clocked in" value={clockedIn} href={`${base}/attendance`} icon={<LogIn />}
                hint={people ? <>of <span className="tabular-nums">{people}</span> people{att.counts.late ? <>, <span className="tabular-nums text-warning">{att.counts.late}</span> late</> : ""}</> : "Nobody to clock in yet"} />
              <StatCard label="Working now" value={d.counts.working} href={tabHref("working")} icon={<Timer />}
                hint={<><span className="tabular-nums">{d.counts.connected}</span> with a live connection</>} />
              <StatCard label="Hours today" value={hours(d.counts.seconds_today)} icon={<Hourglass />} hint="Confirmed timer time" />
              <StatCard label="Done today" value={d.counts.tasks_done_today} href={`${base}/tasks`} icon={<SquareCheckBig />}
                hint={<><span className="tabular-nums">{d.counts.tasks_open}</span> open, <span className={cn("tabular-nums", d.counts.tasks_blocked && "text-danger")}>{d.counts.tasks_blocked}</span> blocked</>} />
            </div>
          </div>

          {m ? <MonthCard m={m} teamId={teamId} base={base} /> : null}

          <div className="@container mt-10">
            <div className="grid gap-10 @4xl:grid-cols-2 @4xl:gap-6">
              <section aria-labelledby="working-now" className="min-w-0">
                <SectionTitle id="working-now" title="Working now" action={d.workingNow.length ? <Link href={tabHref("working")} className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link> : undefined} />
                {d.workingNow.length === 0 ? <EmptyState compact icon3d="stopwatch" title="Nobody has a session open" description="Open sessions appear here the moment someone presses Start." /> : (
                  <ul className="-mx-2">
                    {d.workingNow.slice(0, 6).map((w) => {
                      const lost = stale(w);
                      const running = w.state === "running" && !lost;
                      return (
                        <ListRow key={w.membership_id} href={`${base}/workroom/${w.membership_id}`}
                          leading={<Avatar profileId={w.membership_id} name={w.display_name} size={40} />}
                          title={w.display_name} subtitle={w.task_title}
                          meta={<><StatusDot tone={running ? "success" : lost ? "danger" : "warning"} live={running} className="ml-1" /><span className="truncate">{lost ? "Connection lost" : running ? `Working since ${since(w.started_at)}` : `${label(w.state)}, started ${since(w.started_at)}`}</span></>}
                          trailing={<LiveClock seconds={w.today_seconds} serverNow={d.serverNow} running={running} className={running ? "text-foreground" : "text-secondary"} />} />
                      );
                    })}
                  </ul>
                )}
              </section>
              <section aria-labelledby="recently-completed" className="min-w-0">
                <SectionTitle id="recently-completed" title="Recently completed" action={askBrenda ? <Link href={askBrenda} className={buttonVariants({ variant: "ghost", size: "sm" })}><BrendaGlyph aria-hidden />Ask Brenda for a summary</Link> : undefined} />
                {d.recentDone.length === 0 ? <EmptyState compact icon3d="card-check" title="Nothing approved yet" description="Finished work shows here once its check is done." /> : (
                  <ul className="-mx-2">
                    {/* ListRow's layout by hand: the title is the task's peek button, and its sheet cannot sit inside a <p>. */}
                    {d.recentDone.map((t) => (
                      <li key={t.id} className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-3">
                        <ToolSquare><CircleCheck /></ToolSquare>
                        <div className="min-w-0 flex-1">
                          <TaskPeekLink orgSlug={ctx.org.slug} viewer={viewer} task={{ id: t.id, title: t.title }} className="block max-w-full truncate text-sm font-semibold text-foreground" />
                          <p className="truncate text-meta font-normal text-secondary">{t.assignee_name}, {formatDateTime(t.completed_at, tz)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {tab === "working" ? (
        d.workingNow.length === 0 ? <EmptyState icon3d="stopwatch" title="Nobody has a session open" description="Open sessions appear here the moment someone presses Start." action={<Link href={`${base}/workroom`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open the Workroom</Link>} /> : (
          <DataTable caption="People with an open session">
            <thead><tr><th>Person</th><th>Team</th><th>State</th><th>Task</th><th>Since</th><th>Last sync</th><th className="!text-right">Today</th></tr></thead>
            <tbody>{d.workingNow.map((w) => {
              const lost = stale(w);
              const running = w.state === "running" && !lost;
              return (
                <tr key={w.membership_id}>
                  <td><Person orgSlug={ctx.org.slug} membershipId={w.membership_id} name={w.display_name} href={`${base}/workroom/${w.membership_id}`} /></td>
                  <td className="text-secondary">{w.team_names.join(", ") || "None"}</td>
                  <td><Badge tone={lost ? "danger" : SESSION_STATE_TONE[w.state]} dot>{lost ? "Connection lost" : label(w.state)}</Badge></td>
                  <td><span className="flex items-center gap-2.5"><ProgressArc percent={w.task_progress} size={28} /><TaskPeekLink orgSlug={ctx.org.slug} viewer={viewer} task={{ id: w.task_id, title: w.task_title }} className="font-medium" /></span></td>
                  <td className="tabular-nums text-secondary">{since(w.started_at)}</td>
                  <td className="text-secondary">{relativeTime(w.last_heartbeat_at, now)}</td>
                  <td className="text-right"><LiveClock seconds={w.today_seconds} serverNow={d.serverNow} running={running} className={running ? "text-foreground" : "text-secondary"} /></td>
                </tr>
              );
            })}</tbody>
          </DataTable>
        )
      ) : null}

      {tab === "clocked" ? (
        clockedIn === 0 ? <EmptyState icon3d="clock-in" title="Nobody has clocked in yet today" description="People appear here the moment they press Clock in. This list starts empty every day." action={<Link href={`${base}/attendance?tab=not_in`} className={buttonVariants({ variant: "secondary", size: "sm" })}>See who has not clocked in</Link>} /> : (
          <DataTable caption="People who clocked in today">
            <thead><tr><th>Person</th><th>Team</th><th>Clocked in</th><th>Status</th><th>Clocked out</th></tr></thead>
            <tbody>{att.people.filter((p) => p.clock_in_at).map((p) => (
              <tr key={p.membership_id}>
                <td><Person orgSlug={ctx.org.slug} membershipId={p.membership_id} name={p.display_name} href={`${base}/workroom/${p.membership_id}`} /></td>
                <td className="text-secondary">{p.teams.join(", ") || "None"}</td>
                <td className="tabular-nums">{fmtTime(p.clock_in_at!)}</td>
                <td>{(p.late_seconds ?? 0) > 0 ? <Badge tone="warning" dot>Late by {formatDuration(p.late_seconds!)}</Badge> : <Badge tone="success" dot>On time</Badge>}</td>
                <td>{p.clock_out_at ? <span className="tabular-nums">{fmtTime(p.clock_out_at)}</span> : <span className="text-subtle">Still in</span>}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )
      ) : null}

      {tab === "teams" ? (
        d.teams.length === 0 ? <EmptyState icon3d="people" title="No teams yet" description="Create teams such as Design, Tech or Branding, then put a team lead on each." action={<Link href={`${base}/people?tab=teams`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Create a team</Link>} /> : (
          <>
            <DataTable caption="Teams">
              <thead><tr><th>Team</th><th>Lead</th><th className="!text-right">Members</th><th className="!text-right">Open</th><th className="!text-right">Blocked</th><th className="!text-right">Working now</th></tr></thead>
              <tbody>{d.teams.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`${base}/teams/${t.id}`} className="font-medium hover:underline">{t.name}</Link></td>
                  <td>{t.leads.length ? <span className="flex items-center -space-x-1.5">{t.leads.map((name, i) => <Person key={t.lead_ids[i] ?? name} orgSlug={ctx.org.slug} membershipId={t.lead_ids[i] ?? name} name={name} showName={t.leads.length === 1} size={28} href={`${base}/workroom/${t.lead_ids[i] ?? ""}`} className={t.leads.length > 1 ? "rounded-full ring-2 ring-background" : undefined} />)}</span> : <Badge tone="warning">No lead yet</Badge>}</td>
                  <td className="text-right tabular-nums">{t.members}</td>
                  <td className="text-right tabular-nums">{t.open_tasks}</td>
                  <td className={cn("text-right tabular-nums", t.blocked && "text-danger")}>{t.blocked}</td>
                  <td className="text-right tabular-nums">{t.working}</td>
                </tr>
              ))}</tbody>
            </DataTable>
            <div className="mt-4"><Link href={`${base}/people?tab=teams`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Manage teams</Link></div>
          </>
        )
      ) : null}
    </AppShell>
  );
}

/**
 * The month at a glance: the metric strip (hours on the clock, days clocked in, late arrivals, missed days) over a bar
 * per day, grey with today in orange. Month and Team filters submit at once (no Show buttons).
 */
function MonthCard({ m, teamId, base }: { m: Awaited<ReturnType<typeof attendanceMonth>>; teamId: string | null; base: string }) {
  const thisMonth = m.today.slice(0, 7);
  const current = m.month === thisMonth;
  const days = current ? m.days.filter((x) => x <= m.today) : m.days;
  const nowMs = Date.parse(m.serverNow);
  const perDay = days.map((day) => {
    let present = 0, late = 0, missed = 0, secs = 0;
    const working = m.workingDays.includes(day);
    for (const r of m.rows) {
      const c = r.days[day];
      if (c) {
        present++;
        if (c.late > 0) late++;
        // Clock-in to clock-out; today's open record counts up to now, an earlier day left open adds nothing.
        const end = c.out ? Date.parse(c.out) : day === m.today ? nowMs : null;
        if (end) secs += Math.max(0, Math.round((end - Date.parse(c.in)) / 1000));
      } else if (working && day < m.today && day >= r.joined) missed++;
    }
    return { present, late, missed, secs };
  });
  const sum = (k: "present" | "late" | "missed" | "secs") => perDay.reduce((a, x) => a + x[k], 0);
  const labels = days.map((x) => String(Number(x.slice(8))));
  const highlight = current ? days.length - 1 : -1;
  const name = monthLabel(m.month);
  const late = sum("late");
  const present = sum("present");
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, -i));
  if (!months.includes(m.month)) months.push(m.month);
  const team = teamId ? m.teams.find((t) => t.id === teamId)?.name : null;
  return (
    <AnalyticsCard className="mt-3" label={`Attendance, ${name}`} title="Attendance" description={`${name}, ${team ?? "everyone"}`}
      toolbar={
        <form action={`${base}/dashboard`}>
          <FilterBar>
            <FilterSelect label="Month" name="month" defaultValue={m.month} autoSubmit options={months.map((x) => ({ value: x, label: monthLabel(x) }))} />
            {m.teams.length ? <FilterSelect label="Team" name="team" defaultValue={teamId ?? ""} autoSubmit options={[{ value: "", label: "All teams" }, ...m.teams.map((t) => ({ value: t.id, label: t.name }))]} /> : null}
          </FilterBar>
        </form>
      }
      metrics={[
        { key: "hours", label: "Hours on the clock", value: hours(sum("secs")), content: <BarChart title={`Hours on the clock by day, ${name}`} labels={labels} values={perDay.map((x) => Math.round(x.secs / 360) / 10)} highlight={highlight} format={(n) => `${Math.round(n * 10) / 10}h`} empty="Nobody has clocked in this month." /> },
        { key: "present", label: "Days clocked in", value: present, content: <BarChart title={`People clocked in by day, ${name}`} labels={labels} values={perDay.map((x) => x.present)} highlight={highlight} format={(n) => String(Math.round(n))} empty="Nobody has clocked in this month." /> },
        { key: "late", label: "Late arrivals", value: late, hint: present ? `${Math.round((late / present) * 100)}% of days` : undefined, content: <BarChart title={`Late arrivals by day, ${name}`} labels={labels} values={perDay.map((x) => x.late)} highlight={highlight} format={(n) => String(Math.round(n))} empty="Nobody was late this month." /> },
        { key: "missed", label: "Missed days", value: sum("missed"), content: <BarChart title={`Working days with no clock-in, ${name}`} labels={labels} values={perDay.map((x) => x.missed)} highlight={-1} format={(n) => String(Math.round(n))} empty="No missed days this month." /> },
      ]} />
  );
}
