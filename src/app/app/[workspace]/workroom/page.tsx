import Link from "next/link";
import { Hourglass, Phone, SquareCheckBig, Timer } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar, FilterSelect } from "@/components/ui/filter-control";
import { ListRow } from "@/components/ui/rows";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { LiveClock, LiveBadge, LiveSync, LiveRefresh, StatusDot } from "@/components/app/live";
import { workroomView, workroomStatus, type WorkroomStatus } from "@/server/services/views";
import { uuid } from "@/server/lib/api";
import { formatDuration, formatDateTime, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workroom" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

// Active is a running timer: live, so orange (accent rules, 6 October 2026); paused keeps amber.
const STATUS: Record<WorkroomStatus, { label: string; tone: "live" | "warning" | "neutral" }> = {
  active: { label: "Active", tone: "live" },
  paused: { label: "Paused", tone: "warning" },
  clocked_out: { label: "Off the clock", tone: "neutral" },
  not_started: { label: "Not started today", tone: "neutral" },
};
const TABS = ["today", "now", "all"] as const;
type Tab = (typeof TABS)[number];

/**
 * Who is working right now, v4: the page title with underline tabs (Started today, Working now, Everyone), a Team
 * filter, four stat cards, then one 64px row per person: their face, what they are on, an orange dot while they work
 * (still: the "Live" line under the title is the one that breathes, so a full room stays calm), and the session clock
 * on the right in the foreground. Someone on a call has an orange "On a call" badge (owner decision, 8 October 2026:
 * phase 8; who is in a call, never which call). A row opens that person's whole day.
 * What the statuses mean is a page note at the bottom (owner request, 7 October 2026).
 */
export default async function WorkroomPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string; show?: string; tab?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/workroom`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={navTeams}><PageHeader title="Workroom" divider /><PermissionDenied description="The Workroom is for team leads and the organisation account. Your own day is on My Day." /></AppShell>;
  // A team id from the address bar is checked before it reaches a uuid column: a mistyped link shows everyone.
  const teamId = sp.team && uuid.safeParse(sp.team).success ? sp.team : null;
  const data = await workroomView(ctx, { teamId });
  const now = new Date(data.serverNow).getTime();
  const base = `/app/${ctx.org.slug}`;
  const isOrg = ctx.membership.role !== "manager";
  const tz = ctx.org.timezone;
  // `?show=all` is the old link for Everyone; it still works.
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : sp.show === "all" ? "all" : "today";
  const rows = data.rows.map((r) => ({ ...r, status: workroomStatus(r, data.staleAfterSeconds, now) }));
  const started = rows.filter((r) => r.status !== "not_started");
  const working = rows.filter((r) => r.status === "active" || r.status === "paused");
  const shown = tab === "all" ? rows : tab === "now" ? working : started;
  const c = { active: rows.filter((r) => r.status === "active").length, paused: rows.filter((r) => r.status === "paused").length };
  const totalToday = rows.reduce((a, r) => a + r.today_seconds, 0);
  const onCall = rows.filter((r) => r.on_call).length;
  const href = (t: Tab) => { const p = new URLSearchParams(); if (t !== "today") p.set("tab", t); if (teamId) p.set("team", teamId); const s = p.toString(); return `${base}/workroom${s ? `?${s}` : ""}`; };
  // Today's times read as a time; anything from an earlier day keeps its date.
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const at = (iso: string) => (dayOf(iso) === data.today ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : formatDateTime(iso, tz));
  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader title="Workroom" description="Everyone who has started work today, what they are on and for how long. Open a person to see their whole day."
        meta={<LiveSync at={at(data.serverNow)} />}
        actions={<Link href={`${base}/attendance`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Attendance</Link>}
        tabsLabel="Who to show" tabValue={tab}
        tabs={[
          { label: "Started today", value: "today", href: href("today"), count: started.length },
          { label: "Working now", value: "now", href: href("now"), count: working.length },
          { label: "Everyone", value: "all", href: href("all"), count: rows.length },
        ]} />
      <LiveRefresh seconds={Math.max(30, data.staleAfterSeconds)} />

      {data.teams.length > 1 ? (
        <form action={`${base}/workroom`} className="mb-5">
          {tab !== "today" ? <input type="hidden" name="tab" value={tab} /> : null}
          <FilterBar>
            <FilterSelect label="Team" name="team" defaultValue={teamId ?? ""} autoSubmit options={[{ value: "", label: "All teams" }, ...data.teams.map((t) => ({ value: t.id, label: t.name }))]} />
          </FilterBar>
        </form>
      ) : null}

      <div className="@container mb-10">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <StatCard label="Working now" value={c.active} icon={<Timer />} hint={<><span className="tabular-nums">{c.paused}</span> paused</>} />
          <StatCard label="Time today" value={hours(totalToday)} icon={<Hourglass />} hint={<><span className="tabular-nums">{started.length}</span> {started.length === 1 ? "person" : "people"} started</>} />
          <StatCard label="Done today" value={rows.reduce((a, r) => a + r.done_today, 0)} icon={<SquareCheckBig />} hint={<><span className="tabular-nums">{rows.reduce((a, r) => a + r.tasks_today, 0)}</span> tasks worked on</>} />
          <StatCard label="On a call" value={onCall} icon={<Phone />} hint={onCall === 1 ? "person on a call now" : "people on a call now"} />
        </div>
      </div>

      {shown.length === 0 ? (
        rows.length === 0
          ? <EmptyState icon3d="person-laptop" title="Nobody to show" description={isOrg ? "The Workroom shows staff and team leads. Invite people, then they appear here as soon as they start work." : "Team leads see the people on their teams. Ask your organisation owner to add people to your team."} action={isOrg ? <Link href={`${base}/people`} className={buttonVariants({ size: "sm", variant: "secondary" })}>Invite people</Link> : undefined} />
          : <EmptyState icon3d="person-laptop" title={tab === "now" ? "Nobody is working right now" : "Nobody has started work yet today"} description="People appear here as soon as they press Start on one of their to-dos or tasks." action={<Link href={href("all")} className={buttonVariants({ size: "sm", variant: "secondary" })}>Show everyone</Link>} />
      ) : (
        <ul className="-mx-2" aria-label="People">
          {shown.map((r) => {
            const st = STATUS[r.status];
            const running = r.status === "active";
            const phrase = r.status === "active" ? `Active since ${r.started_at ? at(r.started_at) : "earlier"}`
              : r.status === "paused" ? `Paused, started ${r.started_at ? at(r.started_at) : "earlier"}`
              : r.status === "clocked_out" ? `Off the clock, started ${r.first_start_today ? at(r.first_start_today) : "earlier"}`
              : st.label;
            return (
              <ListRow key={r.membership_id} href={`${base}/workroom/${r.membership_id}`}
                leading={<Avatar profileId={r.membership_id} name={r.display_name} size={40} />}
                title={<span className="inline-flex max-w-full items-center gap-2"><span className="truncate">{r.display_name}</span>{r.on_call ? <LiveBadge /> : null}</span>}
                subtitle={r.task_title ?? (r.status === "clocked_out" ? `Last active ${r.last_activity_at ? relativeTime(r.last_activity_at, now) : "earlier today"}` : "No session today yet")}
                meta={<><StatusDot tone={st.tone} pulse={false} className="ml-1" /><span className="truncate">{phrase}, {r.teams.join(", ") || "no team"}, {r.role === "manager" ? "team lead" : "staff"}</span></>}
                trailing={
                  <span className="flex flex-col items-end">
                    {r.task_title ? <LiveClock seconds={r.session_seconds} serverNow={data.serverNow} running={running} quiet className="text-sm" /> : <span className="font-mono text-sm text-secondary">{formatDuration(r.today_seconds)}</span>}
                    <span className="text-xs text-subtle">{r.task_title ? <><span className="tabular-nums">{formatDuration(r.today_seconds)}</span> today</> : "today"}</span>
                  </span>
                } />
            );
          })}
        </ul>
      )}

      <PageNotes>
        <PageNote>Status comes from timers only: Active means a running timer with a live connection, Paused means paused, interrupted or no heartbeat for <span className="tabular-nums">{data.staleAfterSeconds}</span>s, Off the clock means they worked today but nothing is running.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
