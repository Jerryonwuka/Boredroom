import Link from "next/link";
import { CalendarX, Clock, Hourglass, LogIn, LogOut, TimerOff, UserX, CalendarCheck } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar, FilterControl, FilterSelect } from "@/components/ui/filter-control";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { attendanceBoard, attendanceMonth, type ClockStatus } from "@/server/services/attendance";
import { uuid } from "@/server/lib/api";
import { formatDuration, formatLongDate, cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { Person } from "@/components/ui/person";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const roleLabel = (r: string) => (r === "manager" ? "team lead" : r === "owner" ? "organisation owner" : r === "hr" ? "HR" : "staff");
type Tab = "in" | "not_in" | "out" | "all";

/**
 * Attendance, v4: who has clocked in, who has not, who has left, on any day, or a whole month as a grid. The filter
 * bar holds View (Day or Month), the day or month, and Team; each applies itself. Day view: four stat cards and a calm
 * table under the status tabs. Month view: the totals and one narrow cell per day, today's column in orange (accent
 * rules, 6 October 2026: the current day in a calendar). Green, amber and the ring keep their status meaning. The
 * schedule, its time zone and how the month's figures are counted are page notes at the bottom (owner request,
 * 7 October 2026); the colour key stays under the grid, which it labels.
 */
export default async function AttendancePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string; date?: string; team?: string; view?: string; month?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/attendance`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PageHeader title="Attendance" divider /><PermissionDenied description="Attendance is for team leads and organisation accounts. Your own clock is under Clock in." /></AppShell>;
  const base = `/app/${ctx.org.slug}`;
  // A team id from the address bar is checked before it reaches a uuid column: a mistyped link shows everyone.
  const teamId = sp.team && uuid.safeParse(sp.team).success ? sp.team : null;
  const viewOptions = [{ value: "day", label: "Day" }, { value: "month", label: "Month" }];
  const teamSelect = (list: { id: string; name: string }[]) => list.length > 1
    ? <FilterSelect label="Team" name="team" defaultValue={teamId ?? ""} autoSubmit options={[{ value: "", label: "All teams" }, ...list.map((t) => ({ value: t.id, label: t.name }))]} />
    : null;

  // ---- Month view --------------------------------------------------------
  if (sp.view === "month") {
    const m = await attendanceMonth(ctx, { month: sp.month, teamId });
    const tz = m.schedule.timezone;
    const thisMonth = m.today.slice(0, 7);
    const totals = { present: m.rows.reduce((a, r) => a + r.present, 0), late: m.rows.reduce((a, r) => a + r.late, 0), missed: m.rows.reduce((a, r) => a + r.missed, 0), seconds: m.rows.reduce((a, r) => a + r.total_seconds, 0) };
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <PageHeader title="Attendance" divider
          description={`${monthLabel(m.month)}, a cell per day for everyone you supervise.`} />

        <form action={`${base}/attendance`} className="mb-6">
          <FilterBar>
            <FilterSelect label="View" name="view" defaultValue="month" autoSubmit options={viewOptions} />
            <FilterControl label="Month" htmlFor="att-month"><DatePicker mode="month" id="att-month" name="month" defaultValue={m.month} max={thisMonth} size="xs" required submitOnChange /></FilterControl>
            {teamSelect(m.teams)}
            {m.month < thisMonth ? <Link href={`${base}/attendance?view=month${teamId ? `&team=${teamId}` : ""}`} className={buttonVariants({ variant: "ghost", size: "xs" })}>This month</Link> : null}
          </FilterBar>
        </form>

        <div className="@container mb-10">
          <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
            <StatCard label="Days clocked in" value={totals.present} icon={<CalendarCheck />} hint={<><span className="tabular-nums">{m.workingDays.length}</span> working days, <span className="tabular-nums">{m.rows.length}</span> people</>} />
            <StatCard label="Late arrivals" value={totals.late} tone={totals.late ? "warning" : "default"} icon={<Clock />} hint={`Clocked in after ${hhmm(m.schedule.start_local)}`} />
            <StatCard label="Missed days" value={totals.missed} tone={totals.missed ? "danger" : "default"} icon={<CalendarX />} hint="Working days with no clock-in" />
            <StatCard label="Hours on the clock" value={hours(totals.seconds)} icon={<Hourglass />} hint="Clock-in to clock-out" />
          </div>
        </div>

        {m.rows.length === 0 ? <EmptyState icon3d="calendar-clock" title="Nobody to show" description="Change the team or the month." /> : (
          <DataTable caption={`Attendance for ${monthLabel(m.month)}`}>
            {/* table.data's own th and td rules sit outside the cascade layers, so a utility on a header cell only wins with "!". */}
            <thead><tr>
              <th className="sticky left-0 z-[var(--z-raised)] !bg-background">Person</th>
              {m.days.map((d) => <th key={d} className={cn("day tabular-nums !text-xs !font-normal", !m.workingDays.includes(d) && "!text-faint", d === m.today && "!font-semibold !text-accent-text")}><span className="sr-only">{formatLongDate(d)}</span><span aria-hidden>{Number(d.slice(8))}</span></th>)}
              <th className="!text-right">In</th><th className="!text-right">Late</th><th className="!text-right">Missed</th><th className="!text-right">Hours</th>
            </tr></thead>
            <tbody>{m.rows.map((r) => (
              <tr key={r.membership_id}>
                <td className="sticky left-0 z-[var(--z-raised)] !bg-background"><Person orgSlug={ctx.org.slug} membershipId={r.membership_id} name={r.display_name} href={`${base}/workroom/${r.membership_id}`} meta={r.teams.join(", ") || roleLabel(r.role)} className="whitespace-nowrap" /></td>
                {m.days.map((d) => {
                  const c = r.days[d];
                  const working = m.workingDays.includes(d);
                  const before = d < r.joined;
                  return (
                    <td key={d} className="day">
                      {c ? <span role="img" title={`${formatLongDate(d)}: in ${timeOf(c.in, tz)}${c.out ? `, out ${timeOf(c.out, tz)}` : ""}${c.late ? `, late by ${formatDuration(c.late)}` : ", on time"}`} aria-label={`${formatLongDate(d)}: in ${timeOf(c.in, tz)}, ${c.late ? `late by ${formatDuration(c.late)}` : "on time"}`} className={cn("inline-block size-2.5 rounded-full", c.late ? "bg-warning" : "bg-success")} />
                        : before || d > m.today ? null
                        : working ? <span role="img" title={`${formatLongDate(d)}: no clock-in`} aria-label={`${formatLongDate(d)}: no clock-in`} className="inline-block size-2.5 rounded-full border border-border-input-hover" />
                        : <span title={formatLongDate(d)} className="inline-block size-2.5 rounded-full bg-fill-150" aria-hidden />}
                    </td>
                  );
                })}
                <td className="text-right tabular-nums">{r.present}</td>
                <td className={cn("text-right tabular-nums", r.late ? "text-warning" : "text-secondary")}>{r.late}</td>
                <td className={cn("text-right tabular-nums", r.missed ? "text-danger" : "text-secondary")}>{r.missed}</td>
                <td className="text-right tabular-nums">{r.total_seconds ? formatDuration(r.total_seconds) : <span className="text-subtle">None</span>}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-meta font-normal text-secondary" aria-label="Key">
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-success" aria-hidden />On time</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-warning" aria-hidden />Late</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-full border border-border-input-hover" aria-hidden />No clock-in</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-fill-150" aria-hidden />Not a working day</li>
        </ul>

        <PageNotes>
          <PageNote>Work starts at <span className="tabular-nums">{hhmm(m.schedule.start_local)}</span>: green is on time, amber is late, and a ring is a working day with no clock-in.</PageNote>
          <PageNote>Hours count clock-in to clock-out; days without a clock-out add nothing.</PageNote>
          <PageNote>Missed days stop at yesterday and skip days before someone joined.</PageNote>
        </PageNotes>
      </AppShell>
    );
  }

  // ---- Day view ----------------------------------------------------------
  const b = await attendanceBoard(ctx, { date: sp.date, teamId });
  const tab: Tab = (["in", "not_in", "out", "all"] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : "in";
  const q = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams(); const merged = { tab, date: b.date === b.today ? undefined : b.date, team: teamId ?? undefined, ...patch }; for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v); const s = p.toString(); return `${base}/attendance${s ? `?${s}` : ""}`; };
  const shown = b.people.filter((p) => tab === "all" || p.status === tab);
  const tz = b.schedule.timezone;
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  const isToday = b.date === b.today;
  const STATUS: Record<ClockStatus, { label: string; tone: "success" | "neutral" | "info" }> = { in: { label: "Clocked in", tone: "success" }, not_in: { label: "Not clocked in", tone: "neutral" }, out: { label: "Clocked out", tone: "info" } };
  // The one hand-off on this page: Brenda can message the people still missing (she drafts it; the lead presses Send).
  const askBrenda = ctx.plan.features.AI_ASSISTANT === true ? `${base}/home?ask=${encodeURIComponent("Message everyone who has not clocked in yet today and ask whether they are working today.")}` : null;
  const clockedIn = b.counts.in + b.counts.out;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Attendance"
        description={`${isToday ? "Today, " : ""}${formatLongDate(b.date)}.${b.workingDay ? "" : " This is not a scheduled working day."}`}
        actions={askBrenda && tab === "not_in" && isToday && shown.length ? <Link href={askBrenda} className={buttonVariants({ variant: "secondary", size: "sm" })}><BrendaGlyph aria-hidden />Ask Brenda to check in with them</Link> : undefined}
        tabsLabel="Attendance status" tabValue={tab}
        tabs={[
          { value: "in", label: "Clocked in", count: b.counts.in, href: q({ tab: "in" }) },
          { value: "not_in", label: "Not clocked in", count: b.counts.not_in, href: q({ tab: "not_in" }) },
          { value: "out", label: "Clocked out", count: b.counts.out, href: q({ tab: "out" }) },
          { value: "all", label: "Everyone", count: b.people.length, href: q({ tab: "all" }) },
        ]} />

      <form action={`${base}/attendance`} className="mb-6">
        <input type="hidden" name="tab" value={tab} />
        <FilterBar>
          <FilterSelect label="View" name="view" defaultValue="day" autoSubmit options={viewOptions} />
          <FilterControl label="Day" htmlFor="att-date"><DatePicker id="att-date" name="date" defaultValue={b.date} max={b.today} size="xs" required submitOnChange /></FilterControl>
          {teamSelect(b.teams)}
          {!isToday ? <Link href={q({ date: undefined })} className={buttonVariants({ variant: "ghost", size: "xs" })}>Today</Link> : null}
        </FilterBar>
      </form>

      <div className="@container mb-10">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <StatCard label="Clocked in" value={clockedIn} icon={<LogIn />} href={q({ tab: "in" })} hint={clockedIn ? <><span className="tabular-nums">{clockedIn - b.counts.late}</span> on time</> : isToday ? "Nobody yet" : "Nobody that day"} />
          <StatCard label="Late" value={b.counts.late} tone={b.counts.late ? "warning" : "default"} icon={<TimerOff />} hint={`After ${hhmm(b.schedule.start_local)}${b.schedule.clock_grace_minutes ? ` and ${b.schedule.clock_grace_minutes} minutes' grace` : ""}`} />
          <StatCard label="Not clocked in" value={b.counts.not_in} icon={<UserX />} href={q({ tab: "not_in" })} hint={<>of <span className="tabular-nums">{b.people.length}</span> {isToday ? "so far today" : "that day"}</>} />
          <StatCard label="Clocked out" value={b.counts.out} icon={<LogOut />} href={q({ tab: "out" })} hint={<><span className="tabular-nums">{b.counts.in}</span> still in</>} />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon3d="clock-in" title={tab === "in" ? "Nobody is clocked in" : tab === "not_in" ? "Everyone has clocked in" : tab === "out" ? "Nobody has clocked out yet" : "Nobody to show"} description={tab === "in" && isToday ? "People appear here the moment they press Clock in." : "Change the tab or the day."} />
      ) : (
        <DataTable caption="Attendance">
          <thead><tr><th>Person</th><th>Team</th><th>Clocked in</th><th>Status</th><th>Clocked out</th><th className="!text-right">On the clock</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.membership_id}>
              <td><Person orgSlug={ctx.org.slug} membershipId={p.membership_id} name={p.display_name} href={`${base}/workroom/${p.membership_id}`} meta={`${p.employee_code}, ${roleLabel(p.role)}`} /></td>
              <td className="text-secondary">{p.teams.join(", ") || "None"}</td>
              <td>{p.clock_in_at ? <span className="tabular-nums">{timeOf(p.clock_in_at, tz)}</span> : <span className="text-subtle">None</span>}</td>
              <td><span className="flex flex-wrap gap-1"><Badge tone={STATUS[p.status].tone} dot>{STATUS[p.status].label}</Badge>{(p.late_seconds ?? 0) > 0 ? <Badge tone="warning">Late by {formatDuration(p.late_seconds!)}</Badge> : p.clock_in_at ? <Badge tone="success">On time</Badge> : null}{(p.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left early</Badge> : null}</span></td>
              <td>{p.clock_out_at ? <span className="tabular-nums">{timeOf(p.clock_out_at, tz)}</span> : <span className="text-subtle">None</span>}</td>
              <td className="text-right tabular-nums">{p.clock_in_at ? formatDuration(Math.round((Date.parse(p.clock_out_at ?? b.serverNow) - Date.parse(p.clock_in_at)) / 1000)) : <span className="text-subtle">None</span>}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}

      <PageNotes>
        <PageNote>Work starts at <span className="tabular-nums">{hhmm(b.schedule.start_local)}</span> and ends at <span className="tabular-nums">{hhmm(b.schedule.end_local)}</span> {zone}{b.schedule.clock_grace_minutes ? `, with ${b.schedule.clock_grace_minutes} minutes' grace` : ""}; anyone clocking in after that is flagged late.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
