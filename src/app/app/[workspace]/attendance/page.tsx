import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Ledger } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { SlidingMarker } from "@/components/ui/motion";
import { attendanceBoard, type ClockStatus } from "@/server/services/attendance";
import { addDays } from "@/server/lib/time";
import { formatDuration, formatLongDate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attendance" };

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);
type Tab = "in" | "not_in" | "out" | "all";

/** Who has clocked in, who has not, who has left: today by default, any day by date. */
export default async function AttendancePage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string; date?: string; team?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/attendance`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="Attendance is for team leads and organisation accounts. Your own clock is under Clock in." /></AppShell>;
  const b = await attendanceBoard(ctx, { date: sp.date, teamId: sp.team || null });
  const tab: Tab = (["in", "not_in", "out", "all"] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : "in";
  const base = `/app/${ctx.org.slug}`;
  const q = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams(); const merged = { tab, date: b.date === b.today ? undefined : b.date, team: sp.team || undefined, ...patch }; for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v); const s = p.toString(); return `${base}/attendance${s ? `?${s}` : ""}`; };
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
      <PageHeader back={{ href: ctx.membership.role === "manager" ? `${base}/my-day` : `${base}/dashboard`, label: ctx.membership.role === "manager" ? "My Day" : "Dashboard" }} overline={formatLongDate(b.date)} title="Attendance"
        description={`Work starts at ${hhmm(b.schedule.start_local)} and ends at ${hhmm(b.schedule.end_local)} ${zone}${b.schedule.clock_grace_minutes ? `, ${b.schedule.clock_grace_minutes} minutes' grace` : ""}. Anyone clocking in after that is flagged late.${b.workingDay ? "" : " This is not a scheduled working day."}`}
        actions={<span className="flex items-center gap-2 text-sm"><Link href={q({ date: addDays(b.date, -1) })} className="underline">Previous day</Link>{b.date !== b.today ? <Link href={q({ date: undefined })} className="underline">Today</Link> : null}{b.date < b.today ? <Link href={q({ date: addDays(b.date, 1) })} className="underline">Next day</Link> : null}</span>} />

      <Ledger className="mb-6" items={[
        { label: "Clocked in", value: b.counts.in + b.counts.out, note: `of ${b.people.length} people`, tone: "accent" },
        { label: "Late", value: b.counts.late, note: b.counts.late ? `after ${hhmm(b.schedule.start_local)}` : "everyone on time", tone: b.counts.late ? "danger" : "default" },
        { label: "Not clocked in", value: b.counts.not_in, note: b.date === b.today ? "so far today" : "that day" },
        { label: "Clocked out", value: b.counts.out, note: "done for the day" },
      ]} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border-soft">
        <nav aria-label="Attendance status" className="flex gap-1">
          {tabs.map((t) => (
            <Link key={t.key} href={q({ tab: t.key })} aria-current={tab === t.key ? "page" : undefined} className={cn("relative px-3 py-2 text-sm font-medium transition-[color] duration-[var(--duration-fast)]", tab === t.key ? "text-fg" : "text-fg-muted hover:text-fg")}>
              {t.label} <span className={cn("ml-1 text-xs tabular-nums", tab === t.key ? "text-accent" : "text-fg-subtle")}>{t.n}</span>
              {tab === t.key ? <SlidingMarker layoutId="attendance-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
            </Link>
          ))}
        </nav>
        {b.teams.length > 1 ? (
          <form className="flex items-center gap-2 pb-2 text-sm" action={`${base}/attendance`}>
            <input type="hidden" name="tab" value={tab} />{b.date !== b.today ? <input type="hidden" name="date" value={b.date} /> : null}
            <label htmlFor="team" className="text-fg-muted">Team</label>
            <select id="team" name="team" defaultValue={sp.team ?? ""} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-inset px-2 text-sm"><option value="">All teams</option>{b.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <button type="submit" className="text-sm underline">Show</button>
          </form>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={tab === "in" ? "Nobody is clocked in" : tab === "not_in" ? "Everyone has clocked in" : tab === "out" ? "Nobody has clocked out yet" : "Nobody to show"} description={tab === "in" && b.date === b.today ? "People appear here the moment they press Clock in." : "Change the tab or the day."} />
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
