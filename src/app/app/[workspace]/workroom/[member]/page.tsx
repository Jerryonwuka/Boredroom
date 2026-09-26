import Link from "next/link";
import { notFound } from "next/navigation";
import { Video } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { TaskPeekLink } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { LiveClock, LiveBadge } from "@/components/app/live";
import { RecordingsTable } from "@/components/app/recordings-table";
import { workroomPerson, workroomStatus } from "@/server/services/views";
import { listRecordings } from "@/server/services/recording";
import { localMidnight } from "@/server/lib/time";
import { formatDuration, formatDateTime, relativeTime, formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workroom" };

const STATUS = { active: { label: "Active", tone: "success" as const }, paused: { label: "Paused", tone: "warning" as const }, clocked_out: { label: "Off the clock", tone: "info" as const }, not_started: { label: "Not started today", tone: "neutral" as const } };

/** One person's day: what they are on now, every task they touched, each session, and today's recordings. */
export default async function WorkroomPersonPage({ params }: { params: Promise<{ workspace: string; member: string }> }) {
  const { workspace, member } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/workroom/${member}`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied /></AppShell>;
  const data = await workroomPerson(ctx, member);
  if (!data) notFound();
  const { person, tasks, sessions } = data;
  const now = new Date(data.serverNow).getTime();
  const status = workroomStatus(person, data.staleAfterSeconds, now);
  const recordings = (await listRecordings(ctx, { membershipId: member, limit: 50 })).filter((r) => r.capture_started_at && new Date(r.capture_started_at) >= localMidnight(data.today, ctx.org.timezone));
  const base = `/app/${ctx.org.slug}`;
  const finished = tasks.filter((t) => t.status === "completed");
  const inCheck = tasks.filter((t) => t.status === "in_review");
  const open = tasks.filter((t) => t.status !== "completed" && t.status !== "in_review");
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="person-laptop" back={{ href: `${base}/workroom`, label: "Workroom" }} overline={`${formatLongDate(data.today)}, ${person.teams.join(", ") || "no team"}`} title={person.display_name}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[status].tone} dot={status === "active" || status === "paused"}>{STATUS[status].label}</Badge>{person.recording_live ? <LiveBadge /> : null}<span>{person.employee_code}, {person.role === "manager" ? "team lead" : "staff"}{person.last_activity_at ? `, last active ${relativeTime(person.last_activity_at, now)}` : ""}</span></span>}
        actions={<span className="flex flex-wrap items-center gap-3"><Link href={`${base}/messages?to=${member}`} className={buttonVariants({ size: "sm" })}>Message {person.display_name.split(" ")[0]}</Link><Link href={`${base}/timesheets?member=${member}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Timesheet and records</Link></span>} />

      <div className="mb-6 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
        <Card className={status === "active" ? "tile-active" : ""}>
          <p className="eyebrow">{person.task_title ? (status === "active" ? "Working on now" : "Paused on") : "Right now"}</p>
          {person.task_title ? <><p className="mt-2 font-display text-4xl leading-none"><LiveClock seconds={person.session_seconds} serverNow={data.serverNow} running={status === "active"} className={status === "active" ? "text-accent" : "text-fg-muted"} /></p><Link href={`${base}/tasks/${person.task_id}`} className="mt-3 block truncate font-semibold hover:underline">{person.task_title}</Link><p className="text-xs text-fg-subtle">since {person.started_at ? formatDateTime(person.started_at, ctx.org.timezone) : "—"}</p></> : <p className="mt-2 font-display text-2xl text-fg-muted">{status === "clocked_out" ? "Off the clock" : "No session yet"}</p>}
        </Card>
        <StatCard label="Time today" verdict={formatDuration(person.today_seconds)} rows={[{ label: "First start", value: person.first_start_today ? formatDateTime(person.first_start_today, ctx.org.timezone) : "—", tone: "neutral" }, { label: "Sessions", value: sessions.length, tone: "info" }]} />
        <StatCard label="Tasks today" verdict={tasks.length} rows={[{ label: "Done", value: finished.length, tone: "success" }, { label: "Sent for check", value: inCheck.length, tone: "info" }, { label: "Open", value: open.length, tone: "neutral" }, { label: "Recordings", value: recordings.length, tone: person.recording_live ? "danger" : "neutral" }]} />
      </div>

      <section className="mb-8">
        <CardHeader title="Today&apos;s tasks" className="mb-3" />
        {tasks.length === 0 ? <EmptyState icon3d="card-check" title="No tasks touched today" description="Tasks appear here when they are started, planned for today, or finished today." /> : (
          <DataTable caption="Tasks today">
            <thead><tr><th>Task</th><th>Status</th><th>Time today</th><th>Sessions</th><th>First started</th><th>Recordings</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{tasks.map((t) => (
              <tr key={t.id} className={t.current ? "bg-accent-soft/30" : ""}>
                <td><TaskPeekLink orgSlug={ctx.org.slug} viewer={taskViewer(ctx)} task={{ id: t.id, title: t.title, status: t.status, due_at: t.due_at, project_name: t.project_name }} /><p className="text-xs text-fg-subtle">{t.project_name}{t.created_by_name !== person.display_name ? `, from ${t.created_by_name}` : ""}{t.due_at ? `, due ${formatDateTime(t.due_at, ctx.org.timezone)}` : ""}</p></td>
                <td>{t.current ? <Badge tone="success" dot>Working now</Badge> : <Badge tone={TASK_STATUS_TONE[t.status]}>{t.status === "in_review" ? "Sent for check" : label(t.status)}</Badge>}</td>
                <td className="tabular-nums">{formatDuration(t.seconds_today)}</td>
                <td className="tabular-nums">{t.sessions_today}</td>
                <td className="text-sm">{t.first_started_today ? formatDateTime(t.first_started_today, ctx.org.timezone) : "—"}</td>
                <td>{t.recordings ? <Link href={`${base}/tasks/${t.id}`} className="inline-flex items-center gap-1 hover:underline"><Video className="size-4 text-accent" aria-hidden />{t.recordings}</Link> : <span className="text-fg-subtle">—</span>}</td>
                <td>{t.status !== "completed" ? <Link href={`${base}/messages?to=${member}&task=${t.id}`} className="whitespace-nowrap text-sm text-fg-muted hover:text-fg">Ask for an update</Link> : null}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <CardHeader title="Sessions today" className="mb-3" />
          {sessions.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No sessions yet today.</p> : (
            <ul className="space-y-2">{sessions.map((s) => (
              <li key={s.id} className="tile flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <Badge tone={SESSION_STATE_TONE[s.state]} dot={s.state === "running"}>{label(s.state)}</Badge>
                <Link href={`${base}/tasks/${s.task_id}`} className="min-w-[10rem] flex-1 truncate font-medium hover:underline">{s.task_title}</Link>
                <span className="tabular-nums text-fg-muted">{formatDuration(s.seconds)}</span>
                <span className="text-xs text-fg-subtle">{formatDateTime(s.started_at, ctx.org.timezone)}{s.ended_at ? ` to ${formatDateTime(s.ended_at, ctx.org.timezone)}` : ""}{s.stop_outcome ? `, ${label(s.stop_outcome)}` : ""}</span>
                {s.recordings ? <span className="inline-flex items-center gap-1 text-xs"><Video className="size-3.5 text-accent" aria-hidden />{s.recordings}</span> : null}
                {s.stop_note ? <p className="w-full text-xs text-fg-muted">“{s.stop_note}”</p> : null}
              </li>
            ))}</ul>
          )}
        </section>
        <section>
          <CardHeader title="Recordings today" className="mb-3" />
          {recordings.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No screen recordings today.</p> : <RecordingsTable orgSlug={ctx.org.slug} rows={recordings} timeZone={ctx.org.timezone} showPerson={false} compact />}
        </section>
      </div>
    </AppShell>
  );
}
