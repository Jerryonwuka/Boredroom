import Link from "next/link";
import { Video } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { LiveClock, LiveBadge } from "@/components/app/live";
import { Rise } from "@/components/ui/motion";
import { workroomView, workroomStatus, type WorkroomStatus } from "@/server/services/views";
import { formatDuration, formatDateTime, relativeTime, formatLongDate, cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workroom" };

const STATUS: Record<WorkroomStatus, { label: string; tone: "success" | "warning" | "neutral" | "info"; dot: boolean }> = {
  active: { label: "Active", tone: "success", dot: true },
  paused: { label: "Paused", tone: "warning", dot: true },
  clocked_out: { label: "Off the clock", tone: "info", dot: false },
  not_started: { label: "Not started today", tone: "neutral", dot: false },
};

/** Everyone at work right now, and everyone who worked today, with what they are on and for how long. */
export default async function WorkroomPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string; show?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/workroom`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PermissionDenied description="The Workroom is for team leads and the organisation account. Your own day is on My Day." /></AppShell>;
  const data = await workroomView(ctx, { teamId: sp.team ?? null });
  const now = new Date(data.serverNow).getTime();
  const base = `/app/${ctx.org.slug}`;
  const isOrg = ctx.membership.role !== "manager";
  const rows = data.rows.map((r) => ({ ...r, status: workroomStatus(r, data.staleAfterSeconds, now) }));
  const shown = sp.show === "all" ? rows : rows.filter((r) => r.status !== "not_started");
  const c = { active: rows.filter((r) => r.status === "active").length, paused: rows.filter((r) => r.status === "paused").length, out: rows.filter((r) => r.status === "clocked_out").length, none: rows.filter((r) => r.status === "not_started").length };
  const totalToday = rows.reduce((a, r) => a + r.today_seconds, 0);
  const live = rows.filter((r) => r.recording_live).length;
  const q = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); const merged = { team: sp.team, show: sp.show, ...extra }; for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v); const s = p.toString(); return `${base}/workroom${s ? `?${s}` : ""}`; };
  const chip = (active: boolean) => cn("chip chip-link whitespace-nowrap rounded-full px-3 py-1 text-sm", active ? "border-accent/60 text-fg" : "text-fg-muted");
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader icon="eye-dashboard" back={{ href: isOrg ? `${base}/dashboard` : base, label: isOrg ? "Dashboard" : "Back" }} overline={formatLongDate(data.today)} title="Who is working now"
        description={<>Everyone who has clocked in today and what they are on. Updates live; last sync {formatDateTime(data.serverNow, ctx.org.timezone)}. Click a person to see their whole day.</>} />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="The room" verdict={c.active ? `${c.active} active` : "Quiet"} tone={c.active ? "accent" : "default"} rows={[{ label: "Active", value: c.active, tone: "success" }, { label: "Paused", value: c.paused, tone: "warning" }, { label: "Off the clock", value: c.out, tone: "info" }, { label: "Not started", value: c.none, tone: "neutral" }]} />
        <StatCard label="Time today" verdict={formatDuration(totalToday)} rows={[{ label: "People who worked", value: rows.length - c.none, tone: "success" }, { label: "Tasks worked", value: rows.reduce((a, r) => a + r.tasks_today, 0), tone: "neutral" }]} />
        <StatCard label="Recording" verdict={live ? `${live} live` : "None live"} tone={live ? "danger" : "default"} href={`${base}/recordings`} rows={[{ label: "Recordings today", value: rows.reduce((a, r) => a + r.recordings_today, 0), tone: "danger" }, { label: "Done today", value: rows.reduce((a, r) => a + r.done_today, 0), tone: "success" }]} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {data.teams.length > 1 ? <><Link href={q({ team: undefined })} className={chip(!sp.team)}>All teams</Link>{data.teams.map((t) => <Link key={t.id} href={q({ team: t.id })} className={chip(sp.team === t.id)}>{t.name}</Link>)}</> : null}
        <Link href={q({ show: sp.show === "all" ? undefined : "all" })} className="ml-auto text-sm text-fg-muted hover:text-fg">{sp.show === "all" ? "Hide people who have not started" : "Show everyone"}</Link>
      </div>

      {shown.length === 0 ? <EmptyState icon3d="person-laptop" title={rows.length === 0 ? "Nobody to show" : "Nobody has clocked in yet today"} description={rows.length === 0 ? "Team leads see the people on their teams; the organisation account sees everyone who holds tasks." : "As soon as someone presses Start on My Day they appear here."} action={rows.length ? <Link href={q({ show: "all" })}><Button size="sm" variant="outline">Show everyone</Button></Link> : undefined} /> : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => {
            const st = STATUS[r.status];
            return (
              <Rise as="li" key={r.membership_id}>
                <Link href={`${base}/workroom/${r.membership_id}`} className={cn("tile tile-link block h-full p-5", r.status === "active" && "tile-active")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar profileId={r.membership_id} name={r.display_name} size={36} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{r.display_name}</p>
                        <p className="truncate text-xs text-fg-subtle">{r.teams.join(", ") || "No team"}, {r.role === "manager" ? "team lead" : "staff"}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {r.recording_live ? <LiveBadge /> : null}
                      <Badge tone={st.tone} dot={st.dot}>{st.label}</Badge>
                    </div>
                  </div>
                  <div className="mt-4 min-h-[76px]">
                    {r.task_title ? (
                      <>
                        <LiveClock seconds={r.session_seconds} serverNow={data.serverNow} running={r.status === "active"} className={cn("block font-display text-3xl leading-none", r.status === "active" ? "text-accent" : "text-fg-muted")} />
                        <p className="mt-2 truncate text-sm text-fg">{r.task_title}</p>
                        <p className="text-xs text-fg-subtle">{r.status === "active" ? "since" : "paused, started"} {r.started_at ? formatDateTime(r.started_at, ctx.org.timezone) : "—"}</p>
                      </>
                    ) : r.status === "clocked_out" ? (
                      <p className="text-sm text-fg-muted">Last active {r.last_activity_at ? relativeTime(r.last_activity_at, now) : "earlier today"}. Started at {r.first_start_today ? formatDateTime(r.first_start_today, ctx.org.timezone) : "—"}.</p>
                    ) : <p className="text-sm text-fg-subtle">No session today yet.</p>}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft pt-3 text-xs tabular-nums text-fg-subtle">
                    <span><strong className="font-semibold text-fg-muted">{formatDuration(r.today_seconds)}</strong> today</span>
                    <span>{r.tasks_today} task{r.tasks_today === 1 ? "" : "s"} worked</span>
                    <span>{r.done_today} done{r.sent_for_check_today ? `, ${r.sent_for_check_today} sent for check` : ""}</span>
                    {r.recordings_today ? <span className="inline-flex items-center gap-1"><Video className="size-3.5 text-accent" aria-hidden />{r.recordings_today}</span> : null}
                  </div>
                </Link>
              </Rise>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-xs text-fg-subtle">Status comes from timers only: Active means a running timer with a live connection, Paused means paused, interrupted or no heartbeat for {data.staleAfterSeconds}s, Off the clock means they worked today but nothing is running. Nothing here is a productivity score.</p>
    </AppShell>
  );
}
