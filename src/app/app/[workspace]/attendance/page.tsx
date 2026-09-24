import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { attendanceBoard, attendanceMonth, type ClockStatus } from "@/server/services/attendance";
import { addDays } from "@/server/lib/time";
import { formatDuration, formatLongDate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance" };

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return d.toISOString().slice(0, 7); };
type Tab = "in" | "not_in" | "out" | "all";

/** Who has clocked in, who has not, who has left: any day, or a whole month at a glance. */
export default async function AttendancePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string; date?: string; team?: string; view?: string; month?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/attendance`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="Attendance is for team leads and organisation accounts. Your own clock is under Clock in." /></AppShell>;
  const base = `/app/${ctx.org.slug}`;
  const back = { href: ctx.membership.role === "manager" ? `${base}/my-day` : `${base}/dashboard`, label: ctx.membership.role === "manager" ? "My Day" : "Dashboard" };
  const teamId = sp.team || null;
  const viewSwitch = (view: "day" | "month", active: boolean) => (
    <Link href={`${base}/attendance?view=${view}${teamId ? `&team=${teamId}` : ""}`} aria-current={active ? "page" : undefined} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)]", active ? "bg-wash-active text-fg" : "text-fg-muted hover:text-fg")}>{view === "day" ? "Day" : "Month"}</Link>
  );

  // ---- Month view --------------------------------------------------------
  if (sp.view === "month") {
    const m = await attendanceMonth(ctx, { month: sp.month, teamId });
    const tz = m.schedule.timezone;
    const nav = (month: string) => `${base}/attendance?view=month&month=${month}${teamId ? `&team=${teamId}` : ""}`;
    const totals = { present: m.rows.reduce((a, r) => a + r.present, 0), late: m.rows.reduce((a, r) => a + r.late, 0), missed: m.rows.reduce((a, r) => a + r.missed, 0) };
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <PageHeader icon="calendar-clock" back={back} overline={monthLabel(m.month)} title="Attendance"
          description={`A cell per day for everyone you supervise: green is on time, amber is late, empty is no clock-in. Work starts at ${hhmm(m.schedule.start_local)}.`}
          actions={<span className="inline-flex items-center gap-1 rounded-full border border-border bg-wash-soft p-1">{viewSwitch("day", false)}{viewSwitch("month", true)}</span>} />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <form className="flex items-center gap-2 text-sm" action={`${base}/attendance`}>
            <input type="hidden" name="view" value="month" />{teamId ? <input type="hidden" name="team" value={teamId} /> : null}
            <Link href={nav(shiftMonth(m.month, -1))} className="text-fg-muted hover:text-fg">Previous month</Link>
            <label htmlFor="month" className="sr-only">Month</label>
            <input id="month" type="month" name="month" defaultValue={m.month} max={m.today.slice(0, 7)} className="h-9 rounded-full border border-border-strong bg-inset px-3 text-sm" />
            <Button type="submit" size="sm" variant="subtle">Show</Button>
            {m.month < m.today.slice(0, 7) ? <Link href={nav(shiftMonth(m.month, 1))} className="text-fg-muted hover:text-fg">Next month</Link> : null}
          </form>
          {m.teams.length > 1 ? (
            <form className="flex items-center gap-2 text-sm" action={`${base}/attendance`}>
              <input type="hidden" name="view" value="month" /><input type="hidden" name="month" value={m.month} />
              <label htmlFor="team" className="text-fg-muted">Team</label>
              <select id="team" name="team" defaultValue={teamId ?? ""} className="h-9 rounded-full border border-border-strong bg-inset px-3 text-sm"><option value="">All teams</option>{m.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <Button type="submit" size="sm" variant="subtle">Show</Button>
            </form>
          ) : null}
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <StatCard label="Days in" verdict={totals.present} rows={[{ label: "Working days this month", value: m.workingDays.length, tone: "neutral" }, { label: "People", value: m.rows.length, tone: "info" }]} />
          <StatCard label="Late arrivals" verdict={totals.late ? `${totals.late} late` : "None"} tone={totals.late ? "warning" : "default"} rows={[{ label: `After ${hhmm(m.schedule.start_local)}`, value: totals.late, tone: "warning" }]} />
          <StatCard label="Missed days" verdict={totals.missed ? `${totals.missed} missed` : "None"} tone={totals.missed ? "danger" : "default"} rows={[{ label: "Working days with no clock-in", value: totals.missed, tone: "danger" }]} />
        </div>

        {m.rows.length === 0 ? <EmptyState icon3d="calendar-clock" title="Nobody to show" description="Change the team or the month." /> : (
          <DataTable caption={`Attendance for ${monthLabel(m.month)}`}>
            <thead><tr><th className="sticky left-0 bg-bg-elevated">Person</th>{m.days.map((d) => <th key={d} className={cn("day text-[11px] font-normal", !m.workingDays.includes(d) && "text-fg-faint", d === m.today && "text-accent")}>{Number(d.slice(8))}</th>)}<th className="text-right">In</th><th className="text-right">Late</th><th className="text-right">Missed</th><th className="hidden text-right lg:table-cell">Hours</th></tr></thead>
            <tbody>{m.rows.map((r) => (
              <tr key={r.membership_id}>
                <td className="sticky left-0 bg-bg-elevated"><Link href={`${base}/workroom/${r.membership_id}`} className="whitespace-nowrap font-semibold hover:underline">{r.display_name}</Link><p className="text-xs text-fg-subtle">{r.teams.join(", ") || (r.role === "owner" ? "owner" : r.role === "hr" ? "HR" : "—")}</p></td>
                {m.days.map((d) => { const c = r.days[d]; const working = m.workingDays.includes(d); const before = d < r.joined; return (
                  <td key={d} className="day">
                    {c ? <span title={`${formatLongDate(d)}: in ${timeOf(c.in, tz)}${c.out ? `, out ${timeOf(c.out, tz)}` : ""}${c.late ? `, late by ${formatDuration(c.late)}` : ", on time"}`} className={cn("inline-block size-2.5 rounded-full", c.late ? "bg-warning" : "bg-success")} aria-label={`${d}: ${c.late ? "late" : "on time"}`} />
                       : before || d > m.today ? null : <span title={working ? `${formatLongDate(d)}: no clock-in` : formatLongDate(d)} className={cn("inline-block size-2.5 rounded-full", working ? "border border-border-strong" : "bg-border-soft")} aria-hidden />}
                  </td>
                ); })}
                <td className="text-right tabular-nums">{r.present}</td>
                <td className={cn("text-right tabular-nums", r.late && "text-warning")}>{r.late}</td>
                <td className={cn("text-right tabular-nums", r.missed && "text-danger")}>{r.missed}</td>
                <td className="hidden text-right tabular-nums lg:table-cell">{r.total_seconds ? formatDuration(r.total_seconds) : "—"}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <p className="mt-3 text-xs text-fg-subtle">Hours count clock-in to clock-out; days without a clock-out add nothing. Missed days stop at yesterday and skip days before someone joined.</p>
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
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "in", label: "Clocked in", n: b.counts.in },
    { key: "not_in", label: "Not clocked in", n: b.counts.not_in },
    { key: "out", label: "Clocked out", n: b.counts.out },
    { key: "all", label: "Everyone", n: b.people.length },
  ];
  const STATUS: Record<ClockStatus, { label: string; tone: "success" | "neutral" | "info" }> = { in: { label: "Clocked in", tone: "success" }, not_in: { label: "Not clocked in", tone: "neutral" }, out: { label: "Clocked out", tone: "info" } };
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="calendar-clock" back={back} overline={b.date === b.today ? `Today, ${formatLongDate(b.date)}` : formatLongDate(b.date)} title="Attendance"
        description={`Work starts at ${hhmm(b.schedule.start_local)} and ends at ${hhmm(b.schedule.end_local)} ${zone}${b.schedule.clock_grace_minutes ? `, ${b.schedule.clock_grace_minutes} minutes' grace` : ""}. Anyone clocking in after that is flagged late. The board starts empty every day.${b.workingDay ? "" : " This is not a scheduled working day."}`}
        actions={<span className="inline-flex items-center gap-1 rounded-full border border-border bg-wash-soft p-1">{viewSwitch("day", true)}{viewSwitch("month", false)}</span>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form className="flex flex-wrap items-center gap-2 text-sm" action={`${base}/attendance`}>
          <input type="hidden" name="tab" value={tab} />{teamId ? <input type="hidden" name="team" value={teamId} /> : null}
          <Link href={q({ date: addDays(b.date, -1) })} className="text-fg-muted hover:text-fg">Previous day</Link>
          <label htmlFor="date" className="sr-only">Day</label>
          <input id="date" type="date" name="date" defaultValue={b.date} max={b.today} className="h-9 rounded-full border border-border-strong bg-inset px-3 text-sm" />
          <Button type="submit" size="sm" variant="subtle">Show</Button>
          {b.date < b.today ? <><Link href={q({ date: addDays(b.date, 1) })} className="text-fg-muted hover:text-fg">Next day</Link><Link href={q({ date: undefined })} className="text-fg-muted hover:text-fg">Today</Link></> : null}
        </form>
        {b.teams.length > 1 ? (
          <form className="flex items-center gap-2 text-sm" action={`${base}/attendance`}>
            <input type="hidden" name="tab" value={tab} />{b.date !== b.today ? <input type="hidden" name="date" value={b.date} /> : null}
            <label htmlFor="team" className="text-fg-muted">Team</label>
            <select id="team" name="team" defaultValue={teamId ?? ""} className="h-9 rounded-full border border-border-strong bg-inset px-3 text-sm"><option value="">All teams</option>{b.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <Button type="submit" size="sm" variant="subtle">Show</Button>
          </form>
        ) : null}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard label="Clocked in" verdict={b.counts.in + b.counts.out === 0 ? "Nobody yet" : b.counts.late ? `${b.counts.late} late` : "On time"} tone={b.counts.late ? "warning" : b.counts.in + b.counts.out ? "accent" : "default"} rows={[{ label: "Clocked in", value: b.counts.in + b.counts.out, tone: "success" }, { label: "Late", value: b.counts.late, tone: "warning" }]} />
        <StatCard label="Not clocked in" verdict={b.counts.not_in} tone={b.counts.not_in ? "warning" : "default"} rows={[{ label: b.date === b.today ? "So far today" : "That day", value: b.counts.not_in, tone: "neutral" }, { label: "People", value: b.people.length, tone: "info" }]} />
        <StatCard label="Clocked out" verdict={b.counts.out} rows={[{ label: "Done for the day", value: b.counts.out, tone: "info" }, { label: "Still in", value: b.counts.in, tone: "success" }]} />
      </div>

      <div className="mb-4"><Tabs label="Attendance status" value={tab} tabs={tabs.map((t) => ({ value: t.key, label: t.label, count: t.n, href: q({ tab: t.key }) }))} /></div>

      {shown.length === 0 ? (
        <EmptyState icon3d="clock-in" title={tab === "in" ? "Nobody is clocked in" : tab === "not_in" ? "Everyone has clocked in" : tab === "out" ? "Nobody has clocked out yet" : "Nobody to show"} description={tab === "in" && b.date === b.today ? "People appear here the moment they press Clock in." : "Change the tab or the day."} />
      ) : (
        <DataTable caption="Attendance">
          <thead><tr><th>Person</th><th className="hidden md:table-cell">Team</th><th>Clocked in</th><th>Status</th><th className="hidden md:table-cell">Clocked out</th><th className="hidden lg:table-cell">On the clock</th></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.membership_id}>
              <td><Link href={`${base}/workroom/${p.membership_id}`} className="font-semibold hover:underline">{p.display_name}</Link><p className="text-xs text-fg-subtle">{p.employee_code}{p.role === "manager" ? ", team lead" : p.role === "owner" ? ", organisation owner" : p.role === "hr" ? ", HR" : ""}<span className="md:hidden">{p.teams.length ? `, ${p.teams.join(", ")}` : ""}</span></p></td>
              <td className="hidden text-fg-muted md:table-cell">{p.teams.join(", ") || "—"}</td>
              <td className="tabular-nums">{p.clock_in_at ? timeOf(p.clock_in_at, tz) : <span className="text-fg-subtle">—</span>}</td>
              <td><span className="flex flex-wrap gap-1"><Badge tone={STATUS[p.status].tone} dot={p.status === "in"}>{STATUS[p.status].label}</Badge>{(p.late_seconds ?? 0) > 0 ? <Badge tone="warning">Late by {formatDuration(p.late_seconds!)}</Badge> : p.clock_in_at ? <Badge tone="success">On time</Badge> : null}{(p.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left early</Badge> : null}</span></td>
              <td className="hidden tabular-nums md:table-cell">{p.clock_out_at ? timeOf(p.clock_out_at, tz) : <span className="text-fg-subtle">—</span>}</td>
              <td className="hidden tabular-nums lg:table-cell">{p.clock_in_at ? formatDuration(Math.round((Date.parse(p.clock_out_at ?? b.serverNow) - Date.parse(p.clock_in_at)) / 1000)) : "—"}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
    </AppShell>
  );
}
