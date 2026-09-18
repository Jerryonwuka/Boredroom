import Link from "next/link";
import { Video } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { LiveClock, LiveBadge } from "@/components/app/live";
import { Rise } from "@/components/ui/motion";
import { workroomView, workroomStatus, type WorkroomStatus } from "@/server/services/views";
import { formatDuration, formatDateTime, relativeTime, formatLongDate } from "@/lib/utils";

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
  const counts2 = { active: rows.filter((r) => r.status === "active").length, paused: rows.filter((r) => r.status === "paused").length, out: rows.filter((r) => r.status === "clocked_out").length, none: rows.filter((r) => r.status === "not_started").length };
  const q = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); const merged = { team: sp.team, show: sp.show, ...extra }; for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v); const s = p.toString(); return `${base}/workroom${s ? `?${s}` : ""}`; };
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader back={{ href: isOrg ? `${base}/dashboard` : base, label: isOrg ? "Dashboard" : "Back" }} overline={formatLongDate(data.today)} title="Who is working now"
        description={<>Everyone who has clocked in today and what they are on. Updates live; last sync {formatDateTime(data.serverNow, ctx.org.timezone)}. Click a person to see their whole day.</>} />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5"><Badge tone="success" dot>{counts2.active}</Badge> active</span>
        <span className="inline-flex items-center gap-1.5"><Badge tone="warning" dot>{counts2.paused}</Badge> paused</span>
        <span className="inline-flex items-center gap-1.5"><Badge tone="info">{counts2.out}</Badge> off the clock</span>
        <span className="inline-flex items-center gap-1.5"><Badge tone="neutral">{counts2.none}</Badge> not started</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {data.teams.length > 1 ? <><Link href={q({ team: undefined })} className={`rounded-full border px-3 py-1 ${!sp.team ? "border-accent text-fg" : "border-border text-fg-muted hover:border-border-strong"}`}>All teams</Link>{data.teams.map((t) => <Link key={t.id} href={q({ team: t.id })} className={`rounded-full border px-3 py-1 ${sp.team === t.id ? "border-accent text-fg" : "border-border text-fg-muted hover:border-border-strong"}`}>{t.name}</Link>)}</> : null}
          <Link href={q({ show: sp.show === "all" ? undefined : "all" })} className="text-sm underline">{sp.show === "all" ? "Hide people who have not started" : "Show everyone"}</Link>
        </span>
      </div>
      {shown.length === 0 ? <EmptyState title={rows.length === 0 ? "Nobody to show" : "Nobody has clocked in yet today"} description={rows.length === 0 ? "Team leads see the people on their teams; the organisation account sees everyone who holds tasks." : "As soon as someone presses Start on My Day they appear here."} action={rows.length ? <Link href={q({ show: "all" })} className="underline">Show everyone</Link> : undefined} /> : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => {
            const st = STATUS[r.status];
            return (
              <Rise as="li" key={r.membership_id}>
                <Link href={`${base}/workroom/${r.membership_id}`} className={`tile tile-link block h-full p-4 ${r.status === "active" ? "tile-active" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.display_name}</p>
                      <p className="truncate text-xs text-fg-subtle">{r.teams.join(", ") || "No team"}, {r.role === "manager" ? "team lead" : "staff"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {r.recording_live ? <LiveBadge /> : null}
                      <Badge tone={st.tone} dot={st.dot}>{st.label}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 min-h-12">
                    {r.task_title ? (
                      <>
                        <p className="text-xs text-fg-subtle">{r.status === "active" ? "Working on" : "Paused on"}</p>
                        <p className="truncate font-medium">{r.task_title}</p>
                        <p className="mt-0.5 text-sm text-fg-muted">On this task: <LiveClock seconds={r.session_seconds} serverNow={data.serverNow} running={r.status === "active"} className="text-fg" />{r.started_at ? <span className="text-fg-subtle"> since {formatDateTime(r.started_at, ctx.org.timezone)}</span> : null}</p>
                      </>
                    ) : r.status === "clocked_out" ? (
                      <p className="text-sm text-fg-muted">Last active {r.last_activity_at ? relativeTime(r.last_activity_at, now) : "earlier today"}. Started at {r.first_start_today ? formatDateTime(r.first_start_today, ctx.org.timezone) : "—"}.</p>
                    ) : <p className="text-sm text-fg-subtle">No session today yet.</p>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft pt-3 text-xs text-fg-subtle tabular-nums">
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
