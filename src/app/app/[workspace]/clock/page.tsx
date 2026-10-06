import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { Card, PageHeader, SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { MetricStrip } from "@/components/ui/analytics-card";
import { FilterBar, FilterControl } from "@/components/ui/filter-control";
import { ClockButtons } from "@/components/app/clock";
import { myClock } from "@/server/services/attendance";
import { formatDuration, formatLongDate, formatDateTime, cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { ICON_BUTTON } from "@/components/ui/icon-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clock in" };

const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const hhmm = (t: string) => t.slice(0, 5);
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };

type Event = { at: number; time: string; label: string; detail?: React.ReactNode; kind: "plan" | "in" | "now" | "out" };

/**
 * Your clock, v4: one focused card with where you stand today, the clock button (the white primary) and today's
 * timeline (work starts, you clocked in, now, you clocked out, work ends); the rules beside it; then the month's
 * history as a metric strip and a calm table. The organisation account supervises and does not clock in: its view of
 * the clock is Attendance.
 */
export default async function ClockPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ month?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/clock`);
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") redirect(`/app/${ctx.org.slug}/attendance`);
  const c = await myClock(ctx, { month: sp.month });
  const thisMonth = c.today.slice(0, 7);
  const monthHref = (m: string) => `/app/${ctx.org.slug}/clock${m === thisMonth ? "" : `?month=${m}`}`;
  const tz = c.schedule.timezone;
  const zone = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  const nowMs = Date.parse(c.serverNow);
  const startMs = Date.parse(c.scheduledStartAt);
  const endMs = Date.parse(c.scheduledEndAt);
  const graceMs = c.schedule.clock_grace_minutes * 60_000;
  const lateNow = c.status === "not_in" && nowMs > startMs + graceMs;
  const r = c.record;
  const onTheClock = r ? Math.round((Date.parse(r.clock_out_at ?? c.serverNow) - Date.parse(r.clock_in_at)) / 1000) : 0;
  const supervisor = ctx.membership.role !== "employee";
  const lateBadge = r ? (r.late_seconds > 0 ? <Badge tone="warning" dot>Late by {formatDuration(r.late_seconds)}</Badge> : <Badge tone="success" dot>On time</Badge>) : null;

  // Today's timeline, in time order: the schedule's ends, your clock-in and clock-out, and now while it matters.
  const events: Event[] = [
    { at: startMs, time: hhmm(c.schedule.start_local), label: "Work starts", kind: "plan", detail: c.schedule.clock_grace_minutes ? `${c.schedule.clock_grace_minutes} minutes' grace` : undefined },
    { at: endMs, time: hhmm(c.schedule.end_local), label: "Work ends", kind: "plan" },
  ];
  if (r) events.push({ at: Date.parse(r.clock_in_at), time: timeOf(r.clock_in_at, tz), label: "You clocked in", kind: "in", detail: lateBadge });
  if (r?.clock_out_at) events.push({ at: Date.parse(r.clock_out_at), time: timeOf(r.clock_out_at, tz), label: "You clocked out", kind: "out", detail: (r.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left {formatDuration(r.left_early_seconds!)} early</Badge> : undefined });
  if (c.status === "in") events.push({ at: nowMs, time: timeOf(c.serverNow, tz), label: "Now", kind: "now", detail: <><span className="tabular-nums">{formatDuration(onTheClock)}</span> on the clock so far</> });
  if (c.status === "not_in") events.push({ at: nowMs, time: timeOf(c.serverNow, tz), label: "Now", kind: "now", detail: lateNow ? "Clocking in now counts as late" : `Clock in by ${hhmm(c.schedule.start_local)} to be on time` });
  events.sort((a, b) => a.at - b.at);

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Your clock" divider
        description={<>Work starts at <span className="tabular-nums">{hhmm(c.schedule.start_local)}</span> and ends at <span className="tabular-nums">{hhmm(c.schedule.end_local)}</span> {zone}{c.schedule.clock_grace_minutes ? `, with ${c.schedule.clock_grace_minutes} minutes' grace` : ""}. Clock in on or before the start to be on time; clock out when you are done for the day.</>}
        actions={supervisor ? <Link href={`/app/${ctx.org.slug}/attendance`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Who has clocked in</Link> : undefined} />

      <div className="@container mb-12">
        <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className={cn("p-6", c.status === "in" && "border-border-input-hover")}>
            <p className="type-caption">{c.workingDay ? `Today, ${formatLongDate(c.today)}` : `${formatLongDate(c.today)}, not a scheduled working day`}</p>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
              <div className="min-w-0">
                {c.status === "not_in" ? <><p className="font-display text-3xl font-normal">Not clocked in</p><p className="mt-1 text-sm font-normal text-secondary">{lateNow ? <>The day started at <span className="tabular-nums">{hhmm(c.schedule.start_local)}</span>. Clocking in now counts as late.</> : <>Clock in by <span className="tabular-nums">{hhmm(c.schedule.start_local)}</span> to be on time.</>}</p></> : null}
                {c.status === "in" && r ? <><p className="font-display text-3xl font-normal">Clocked in <span className="tabular-nums">{timeOf(r.clock_in_at, tz)}</span></p><p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-normal text-secondary">{lateBadge}<span><span className="tabular-nums text-foreground">{formatDuration(onTheClock)}</span> on the clock so far</span></p></> : null}
                {c.status === "out" && r ? <><p className="font-display text-3xl font-normal"><span className="tabular-nums">{timeOf(r.clock_in_at, tz)}</span> to <span className="tabular-nums">{timeOf(r.clock_out_at!, tz)}</span></p><p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-normal text-secondary">{lateBadge}{(r.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left {formatDuration(r.left_early_seconds!)} early</Badge> : null}<span><span className="tabular-nums text-foreground">{formatDuration(onTheClock)}</span> on the clock</span></p></> : null}
              </div>
              <ClockButtons orgSlug={ctx.org.slug} status={c.status} timerOpen={c.timerOpen} timing={{ startAt: c.scheduledStartAt, endAt: c.scheduledEndAt, graceMinutes: c.schedule.clock_grace_minutes, timeZone: tz }} />
            </div>
            {c.timerOpen && c.status === "in" ? <p className="mt-4 text-meta font-normal text-secondary">A task timer is running; stop it on <Link href={`/app/${ctx.org.slug}/my-day`} className="font-medium text-foreground underline underline-offset-2">My Day</Link> before clocking out.</p> : null}

            <div className="mt-6 border-t border-border pt-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Today</h2>
              <ol className="relative" aria-label="Today's timeline">
                {events.map((e, i) => (
                  <li key={`${e.kind}-${e.label}`} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className="w-12 shrink-0 pt-px text-right text-meta font-normal tabular-nums text-secondary">{e.time}</span>
                    <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
                      {i < events.length - 1 ? <span className="absolute top-[14px] -bottom-4 w-px bg-border" /> : null}
                      <span className={cn("relative mt-[6px] size-2.5 rounded-full",
                        e.kind === "plan" && "border border-border-input-hover bg-background",
                        (e.kind === "in" || e.kind === "out") && "bg-foreground",
                        e.kind === "now" && "bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)]")} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium", e.kind === "plan" ? "text-secondary" : "text-foreground")}>{e.label}</p>
                      {e.detail ? <div className="mt-1 flex flex-wrap items-center gap-2 text-meta font-normal text-secondary">{e.detail}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </Card>

          <Card className="self-start">
            <h2 className="text-sm font-semibold text-foreground">How it is judged</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="font-medium text-foreground">On time</dt><dd className="font-normal text-secondary">Clocked in at or before <span className="tabular-nums">{hhmm(c.schedule.start_local)}</span>{c.schedule.clock_grace_minutes ? ` (plus ${c.schedule.clock_grace_minutes} minutes' grace)` : ""}.</dd></div>
              <div><dt className="font-medium text-foreground">Late</dt><dd className="font-normal text-secondary">Clocked in after that; the record shows by how much.</dd></div>
              <div><dt className="font-medium text-foreground">Clock out</dt><dd className="font-normal text-secondary">When you leave. Leaving before <span className="tabular-nums">{hhmm(c.schedule.end_local)}</span> is noted, not penalised.</dd></div>
              <div><dt className="font-medium text-foreground">Time zone</dt><dd className="font-normal text-secondary">The organisation&apos;s ({zone}); the schedule in force when you clock in is what counts.</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <section aria-labelledby="clock-history">
        <SectionTitle id="clock-history" title={c.month === thisMonth ? "Earlier this month" : monthLabel(c.month)}
          action={
            <form action={`/app/${ctx.org.slug}/clock`}>
              <FilterBar>
                <Link href={monthHref(shiftMonth(c.month, -1))} aria-label="Previous month" className={ICON_BUTTON}><ChevronLeft aria-hidden /></Link>
                <FilterControl label="Month" htmlFor="clock-month"><DatePicker mode="month" id="clock-month" name="month" defaultValue={c.month} max={thisMonth} size="xs" required submitOnChange /></FilterControl>
                {c.month < thisMonth ? <><Link href={monthHref(shiftMonth(c.month, 1))} aria-label="Next month" className={ICON_BUTTON}><ChevronRight aria-hidden /></Link><Link href={monthHref(thisMonth)} className={buttonVariants({ variant: "ghost", size: "xs" })}>This month</Link></> : null}
              </FilterBar>
            </form>
          } />
        <div className="mb-6 overflow-hidden rounded-2xl border border-border">
          <MetricStrip label={`${monthLabel(c.month)} at a glance`}
            metrics={[
              { key: "present", label: "Days clocked in", value: c.summary.present, hint: c.month === thisMonth ? "Not counting today" : undefined },
              { key: "late", label: "Late", value: c.summary.late },
              { key: "missed", label: "Working days missed", value: c.summary.missed },
            ]} />
        </div>
        {c.history.length === 0 ? <p className="py-6 text-sm font-normal text-secondary">{c.month === thisMonth ? "No earlier days this month yet. Each day you clock in appears here." : `No clock-ins in ${monthLabel(c.month)}.`}</p> : (
          <DataTable caption={`Your attendance, ${monthLabel(c.month)}`}>
            <thead><tr><th>Day</th><th>Clocked in</th><th>Clocked out</th><th>Status</th><th className="!text-right">On the clock</th></tr></thead>
            <tbody>{c.history.map((h) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap font-medium">{formatLongDate(h.local_date)}</td>
                <td className="tabular-nums">{timeOf(h.clock_in_at, h.timezone)}</td>
                <td>{h.clock_out_at ? <span className="tabular-nums">{timeOf(h.clock_out_at, h.timezone)}</span> : <span className="text-subtle">Not clocked out</span>}</td>
                {/* The badges wrap inside a span: a flex <td> stops being a table cell. */}
                <td><span className="flex flex-wrap gap-1">{h.late_seconds > 0 ? <Badge tone="warning" dot>Late by {formatDuration(h.late_seconds)}</Badge> : <Badge tone="success" dot>On time</Badge>}{(h.left_early_seconds ?? 0) > 0 ? <Badge tone="info">Left early</Badge> : null}</span></td>
                <td className="text-right tabular-nums">{h.clock_out_at ? formatDuration(Math.round((Date.parse(h.clock_out_at) - Date.parse(h.clock_in_at)) / 1000)) : <span className="text-subtle">None</span>}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <p className="mt-4 text-xs font-medium text-subtle">It is <span className="tabular-nums">{formatDateTime(c.serverNow, tz)}</span> in {zone}.</p>
      </section>
    </AppShell>
  );
}
