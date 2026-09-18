import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { ClockButtons } from "@/components/app/clock";
import { myClock } from "@/server/services/attendance";
import { formatDuration, formatLongDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clock in" };

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);

/** Everyone's clock: clock in before work, clock out when done, and see the last two weeks. */
export default async function ClockPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/clock`);
  const c = await myClock(ctx);
  const tz = c.schedule.timezone;
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  const lateNow = c.status === "not_in" && Date.parse(c.serverNow) > Date.parse(c.scheduledStartAt) + c.schedule.clock_grace_minutes * 60_000;
  const r = c.record;
  const onPremises = r ? Math.round((Date.parse(r.clock_out_at ?? c.serverNow) - Date.parse(r.clock_in_at)) / 1000) : 0;
  const supervisor = ctx.membership.role !== "employee";
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline={formatLongDate(c.today)} title="Your clock"
        description={`Work starts at ${hhmm(c.schedule.start_local)} and ends at ${hhmm(c.schedule.end_local)} ${zone}${c.schedule.clock_grace_minutes ? `, with ${c.schedule.clock_grace_minutes} minutes' grace` : ""}. Clock in on or before the start to be on time; clock out when you are done for the day.`}
        actions={supervisor ? <Link href={`/app/${ctx.org.slug}/attendance`} className="text-sm underline">Who has clocked in</Link> : undefined} />

      <div className="mb-8 grid gap-4 md:grid-cols-[1fr_20rem]">
        <Card className={c.status === "in" ? "tile-active" : ""}>
          <p className="text-xs text-fg-subtle">{c.workingDay ? "Today" : "Today is not a scheduled working day"}</p>
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
          <p className="text-xs text-fg-subtle">How it is judged</p>
          <ul className="mt-2 space-y-1.5 text-sm text-fg-muted">
            <li><span className="font-semibold text-fg">On time</span>: clocked in at or before {hhmm(c.schedule.start_local)}{c.schedule.clock_grace_minutes ? ` (plus ${c.schedule.clock_grace_minutes} min grace)` : ""}.</li>
            <li><span className="font-semibold text-fg">Late</span>: clocked in after that; the record shows by how much.</li>
            <li><span className="font-semibold text-fg">Clock out</span> when you leave; leaving before {hhmm(c.schedule.end_local)} is noted, not penalised.</li>
            <li>Times use the organisation&apos;s zone ({zone}); the schedule in force when you clock in is what counts.</li>
          </ul>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg">Last two weeks</h2>
        {c.history.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No earlier days yet. Each day you clock in appears here.</p> : (
          <DataTable caption="Your attendance">
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
        <p className="mt-2 text-xs text-fg-subtle">{formatDateTime(c.serverNow, tz)} now in {zone}.</p>
      </section>
    </AppShell>
  );
}
