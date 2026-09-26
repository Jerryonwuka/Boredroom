import Link from "next/link";
import { redirect } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { ClockButtons } from "@/components/app/clock";
import { myClock } from "@/server/services/attendance";
import { formatDuration, formatLongDate, formatDateTime } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clock in" };

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);

/** Everyone's clock: clock in before work, clock out when done, and see the last two weeks. */
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };

export default async function ClockPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ month?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/clock`);
  // The organisation account supervises; it does not clock in. Its view of the clock is Attendance.
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") redirect(`/app/${ctx.org.slug}/attendance`);
  const c = await myClock(ctx, { month: sp.month });
  const thisMonth = c.today.slice(0, 7);
  const monthHref = (m: string) => `/app/${ctx.org.slug}/clock${m === thisMonth ? "" : `?month=${m}`}`;
  const tz = c.schedule.timezone;
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  const lateNow = c.status === "not_in" && Date.parse(c.serverNow) > Date.parse(c.scheduledStartAt) + c.schedule.clock_grace_minutes * 60_000;
  const r = c.record;
  const onPremises = r ? Math.round((Date.parse(r.clock_out_at ?? c.serverNow) - Date.parse(r.clock_in_at)) / 1000) : 0;
  const supervisor = ctx.membership.role !== "employee";
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="clock-in" overline={formatLongDate(c.today)} title="Your clock"
        description={`Work starts at ${hhmm(c.schedule.start_local)} and ends at ${hhmm(c.schedule.end_local)} ${zone}${c.schedule.clock_grace_minutes ? `, with ${c.schedule.clock_grace_minutes} minutes' grace` : ""}. Clock in on or before the start to be on time; clock out when you are done for the day.`}
        actions={supervisor ? <Link href={`/app/${ctx.org.slug}/attendance`}><Button variant="outline" size="sm">Who has clocked in</Button></Link> : undefined} />

      <div className="mb-8 grid gap-4 md:grid-cols-[1fr_20rem]">
        <Card className={c.status === "in" ? "tile-active" : ""}>
          <p className="eyebrow">{c.workingDay ? "Today" : "Not a scheduled working day"}</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              {c.status === "not_in" ? <><p className="font-display text-3xl">Not clocked in</p><p className="mt-1 text-sm text-fg-muted">{lateNow ? `The day started at ${hhmm(c.schedule.start_local)}. Clocking in now counts as late.` : `Clock in by ${hhmm(c.schedule.start_local)} to be on time.`}</p></> : null}
              {c.status === "in" && r ? <><p className="font-display text-3xl">Clocked in {timeOf(r.clock_in_at, tz)}</p><p className="mt-1 flex items-center gap-2 text-sm text-fg-muted">{r.late_seconds > 0 ? <Badge tone="warning">Late by {formatDuration(r.late_seconds)}</Badge> : <Badge tone="success">On time</Badge>}<span>{formatDuration(onPremises)} on the clock so far</span></p></> : null}
              {c.status === "out" && r ? <><p className="font-display text-3xl">{timeOf(r.clock_in_at, tz)} to {timeOf(r.clock_out_at!, tz)}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">{r.late_seconds > 0 ? <Badge tone="warning">Late by {formatDuration(r.late_seconds)}</Badge> : <Badge tone="success">On time</Badge>}{(r.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left {formatDuration(r.left_early_seconds!)} early</Badge> : null}<span>{formatDuration(onPremises)} on the clock</span></p></> : null}
            </div>
            <ClockButtons orgSlug={ctx.org.slug} status={c.status} timerOpen={c.timerOpen} />
          </div>
          {c.timerOpen && c.status === "in" ? <p className="mt-3 text-xs text-fg-subtle">A task timer is running; stop it on My Day before clocking out.</p> : null}
        </Card>
        <Card>
          <p className="eyebrow">How it is judged</p>
          <ul className="mt-2 space-y-1.5 text-sm text-fg-muted">
            <li><span className="font-semibold text-fg">On time</span>: clocked in at or before {hhmm(c.schedule.start_local)}{c.schedule.clock_grace_minutes ? ` (plus ${c.schedule.clock_grace_minutes} min grace)` : ""}.</li>
            <li><span className="font-semibold text-fg">Late</span>: clocked in after that; the record shows by how much.</li>
            <li><span className="font-semibold text-fg">Clock out</span> when you leave; leaving before {hhmm(c.schedule.end_local)} is noted, not penalised.</li>
            <li>Times use the organisation&apos;s zone ({zone}); the schedule in force when you clock in is what counts.</li>
          </ul>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">{c.month === thisMonth ? "Earlier this month" : monthLabel(c.month)}</h2>
          <form className="flex items-center gap-2 text-sm" action={`/app/${ctx.org.slug}/clock`}>
            <Link href={monthHref(shiftMonth(c.month, -1))} className="link-action">Previous month</Link>
            <label htmlFor="month" className="sr-only">Month</label>
            <DatePicker mode="month" id="month" name="month" defaultValue={c.month} max={thisMonth} size="sm" />
            <Button type="submit" size="sm" variant="subtle">Show</Button>
            {c.month < thisMonth ? <><Link href={monthHref(shiftMonth(c.month, 1))} className="link-action">Next month</Link><Link href={monthHref(thisMonth)} className="link-action">This month</Link></> : null}
          </form>
        </div>
        <p className="mb-3 text-sm text-fg-muted">{c.summary.present} day{c.summary.present === 1 ? "" : "s"} clocked in{c.summary.late ? `, ${c.summary.late} late` : ""}{c.summary.missed ? `, ${c.summary.missed} working day${c.summary.missed === 1 ? "" : "s"} with no clock-in` : ""}{c.month === thisMonth ? " (not counting today)" : ""}.</p>
        {c.history.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">{c.month === thisMonth ? "No earlier days this month yet. Each day you clock in appears here." : `No clock-ins in ${monthLabel(c.month)}.`}</p> : (
          <DataTable caption={`Your attendance, ${monthLabel(c.month)}`}>
            <thead><tr><th>Day</th><th>Clocked in</th><th>Clocked out</th><th>Status</th><th>On the clock</th></tr></thead>
            <tbody>{c.history.map((h) => (
              <tr key={h.id}>
                <td className="font-medium">{formatLongDate(h.local_date)}</td>
                <td>{timeOf(h.clock_in_at, h.timezone)}</td>
                <td>{h.clock_out_at ? timeOf(h.clock_out_at, h.timezone) : <span className="text-fg-subtle">not clocked out</span>}</td>
                <td className="flex flex-wrap gap-1">{h.late_seconds > 0 ? <Badge tone="warning">Late by {formatDuration(h.late_seconds)}</Badge> : <Badge tone="success">On time</Badge>}{(h.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left early</Badge> : null}</td>
                <td className="tabular-nums">{h.clock_out_at ? formatDuration(Math.round((Date.parse(h.clock_out_at) - Date.parse(h.clock_in_at)) / 1000)) : "—"}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <p className="eyebrow mt-3">{formatDateTime(c.serverNow, tz)} now in {zone}</p>
      </section>
    </AppShell>
  );
}
