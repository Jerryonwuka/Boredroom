import Link from "next/link";
import { notFound } from "next/navigation";
import { Hourglass, SquareCheckBig, Timer } from "lucide-react";
import { AnimatedMessageSquare } from "@/components/ui/animated-icons";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { TaskPeekLink } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label, taskStatusLabel } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { LiveClock, LiveBadge, LiveRefresh } from "@/components/app/live";
import { CallButton } from "@/components/app/call-button";
import { callsAvailability } from "@/server/services/calls";
import { workroomPerson, workroomStatus } from "@/server/services/views";
import { formatDuration, formatDateTime, relativeTime, formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workroom" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

// Active is a running timer: live, so orange (accent rules, 6 October 2026); paused keeps amber.
const STATUS = { active: { label: "Active", tone: "accent" as const }, paused: { label: "Paused", tone: "warning" as const }, clocked_out: { label: "Off the clock", tone: "neutral" as const }, not_started: { label: "Not started today", tone: "neutral" as const } };
const TABS = ["tasks", "sessions"] as const;
type Tab = (typeof TABS)[number];

/**
 * One person's day, v4: their name with tabs for Tasks and Sessions, the live session clock in the first stat card
 * (orange digits while it runs), then calm tables. Everything here happened today. Orange marks only what is live: their
 * status while active, "On a call" while they are in one (owner decision, 8 October 2026: phase 8, which also took out
 * the screen-video tab, column and figure), the running clock, the task they are on now.
 */
export default async function WorkroomPersonPage({ params, searchParams }: { params: Promise<{ workspace: string; member: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace, member } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/workroom/${member}`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PageHeader title="Workroom" divider /><PermissionDenied description="A person's day is for their team lead and the organisation account. Your own day is on My Day." /></AppShell>;
  const data = await workroomPerson(ctx, member);
  if (!data) notFound();
  const { person, tasks, sessions } = data;
  const now = new Date(data.serverNow).getTime();
  const status = workroomStatus(person, data.staleAfterSeconds, now);
  const running = status === "active";
  const base = `/app/${ctx.org.slug}`;
  const tz = ctx.org.timezone;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "tasks";
  const tabHref = (t: Tab) => `${base}/workroom/${member}${t === "tasks" ? "" : `?tab=${t}`}`;
  // Everything on this page happened today, so times read as times; a session left open since an earlier day keeps its date.
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const at = (iso: string) => (dayOf(iso) === data.today ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : formatDateTime(iso, tz));
  const finished = tasks.filter((t) => t.status === "completed");
  const inCheck = tasks.filter((t) => t.status === "in_review");
  const first = person.display_name.split(" ")[0];
  // Calls (owner decision, 8 October 2026: phase 8): "Call {first}" beside Message; hidden before 0054 or without LiveKit.
  const calls = await callsAvailability();
  const viewer = taskViewer(ctx);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/workroom`, label: "Workroom" }} title={person.display_name}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={STATUS[status].tone} dot>{STATUS[status].label}</Badge>{person.on_call ? <LiveBadge /> : null}<span>{formatLongDate(data.today)}</span></span>}
        meta={<>{person.employee_code}, {person.role === "manager" ? "team lead" : "staff"}, {person.teams.join(", ") || "no team"}{person.last_activity_at ? `, last active ${relativeTime(person.last_activity_at, now)}` : ""}</>}
        actions={<>
          <Link href={`${base}/timesheets?member=${member}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>Timesheet</Link>
          {member !== ctx.membership.id ? <CallButton orgSlug={ctx.org.slug} target={{ kind: "person", membershipId: member, name: person.display_name }} live={null} available={calls.available} size="sm" variant="secondary" /> : null}
          <Link href={`${base}/messages?to=${member}`} className={buttonVariants({ size: "sm" })}><AnimatedMessageSquare aria-hidden />Message {first}</Link>
        </>}
        tabsLabel={`${first}'s day`} tabValue={tab}
        tabs={[
          { label: "Tasks", value: "tasks", href: tabHref("tasks"), count: tasks.length },
          { label: "Sessions", value: "sessions", href: tabHref("sessions"), count: sessions.length },
        ]} />

      <LiveRefresh seconds={Math.max(30, data.staleAfterSeconds)} />
      <div className="@container mb-10">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-3">
          <StatCard label={person.task_title ? (running ? "Working on now" : "Paused on") : "Right now"} icon={<Timer />}
            value={person.task_title ? <LiveClock seconds={person.session_seconds} serverNow={data.serverNow} running={running} /> : status === "clocked_out" ? "Off the clock" : "No session yet"}
            hint={person.task_title ? <><Link href={`${base}/tasks/${person.task_id}`} className="link-inline">{person.task_title}</Link>, since <span className="tabular-nums">{person.started_at ? at(person.started_at) : "earlier"}</span></> : undefined} />
          <StatCard label="Time today" value={hours(person.today_seconds)} icon={<Hourglass />} hint={person.first_start_today ? <>First start <span className="tabular-nums">{at(person.first_start_today)}</span>, <span className="tabular-nums">{sessions.length}</span> session{sessions.length === 1 ? "" : "s"}</> : "No session yet today"} />
          <StatCard label="Tasks today" value={tasks.length} icon={<SquareCheckBig />} hint={<><span className="tabular-nums">{finished.length}</span> done, <span className="tabular-nums">{inCheck.length}</span> sent for check</>} />
        </div>
      </div>

      {tab === "tasks" ? (
        tasks.length === 0 ? <EmptyState icon3d="card-check" title="No tasks touched today" description="Tasks appear here when they are started, planned for today, or finished today." action={<Link href={`${base}/messages?to=${member}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>Ask {first} what they are working on</Link>} /> : (
          <DataTable caption="Tasks today">
            <thead><tr><th>Task</th><th>Status</th><th className="!text-right">Time today</th><th className="!text-right">Sessions</th><th>First started</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <TaskPeekLink orgSlug={ctx.org.slug} viewer={viewer} task={{ id: t.id, title: t.title, status: t.status, due_at: t.due_at, project_name: t.project_name }} className="font-medium" />
                  <p className="text-meta text-secondary">{t.project_name}{t.created_by_name !== person.display_name ? `, from ${t.created_by_name}` : ""}{t.due_at ? `, due ${formatDateTime(t.due_at, tz)}` : ""}</p>
                </td>
                <td>{t.current ? <Badge tone="accent" dot>Working now</Badge> : <Badge tone={TASK_STATUS_TONE[t.status]}>{taskStatusLabel(t.status)}</Badge>}</td>
                <td className="text-right tabular-nums">{formatDuration(t.seconds_today)}</td>
                <td className="text-right tabular-nums">{t.sessions_today}</td>
                <td className="tabular-nums text-secondary">{t.first_started_today ? at(t.first_started_today) : "None"}</td>
                <td className="text-right">{t.status !== "completed" ? <Link href={`${base}/messages?to=${member}&task=${t.id}`} className={buttonVariants({ size: "xs", variant: "ghost" })}>Ask for an update</Link> : null}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )
      ) : null}

      {tab === "sessions" ? (
        sessions.length === 0 ? <EmptyState icon3d="stopwatch" title="No sessions yet today" description="A session starts when they press Start on a task." /> : (
          <DataTable caption="Sessions today">
            <thead><tr><th>State</th><th>Task</th><th className="!text-right">Length</th><th>From</th><th>To</th><th>Outcome</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}>
                <td><Badge tone={s.state === "running" ? "accent" : SESSION_STATE_TONE[s.state]} dot>{label(s.state)}</Badge></td>
                <td><Link href={`${base}/tasks/${s.task_id}`} className="font-medium hover:underline">{s.task_title}</Link>{s.stop_note ? <p className="text-meta text-secondary">{s.stop_note}</p> : null}</td>
                <td className="text-right tabular-nums">{formatDuration(s.seconds)}</td>
                <td className="tabular-nums text-secondary">{at(s.started_at)}</td>
                <td className="tabular-nums text-secondary">{s.ended_at ? at(s.ended_at) : "Still open"}</td>
                <td className="text-secondary">{s.stop_outcome ? label(s.stop_outcome) : "None"}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )
      ) : null}
    </AppShell>
  );
}
