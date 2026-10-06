import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { Card, PageHeader, SectionTitle } from "@/components/ui/card";
import { Badge, label } from "@/components/ui/badge";
import { Alert, EmptyState } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { MetricStrip } from "@/components/ui/analytics-card";
import { BarChart } from "@/components/ui/charts";
import { timesheetForDate, recentDays } from "@/server/services/reports";
import { withUser } from "@/server/db";
import { uuid } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { todayLocal, addDays } from "@/server/lib/time";
import { cn, formatDuration, formatLongDate } from "@/lib/utils";
import { AdjustmentForm, ExportForm, MemberDatePicker } from "@/components/app/timesheet-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets" };

/** A duration as a figure: "0h" when nothing is recorded yet, else "3h 05m" (formatDuration). */
const hours = (s: number) => (s > 0 ? formatDuration(s) : "0h");

/** A real calendar day in yyyy-mm-dd (the pattern alone lets 2026-13-45 through). */
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const shortDay = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const ADJUSTMENT_TONE: Record<string, "success" | "danger" | "warning"> = { approved: "success", rejected: "danger" };

/**
 * One person's confirmed time for a day, and corrections to it, v4: the filter bar (Person, Day), a metric strip over
 * the last 14 days as bars (the chosen day in orange), then the day's intervals as a calm table with the totals by task,
 * and the recent days and corrections beside them. There is no daily report to submit here (owner decision,
 * 6 October 2026): the time counts as it is confirmed, and Brenda's end-of-day report tells team leads what their teams did.
 */
export default async function TimesheetsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ member?: string; date?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/timesheets`);
  const tz = ctx.org.timezone;
  const today = todayLocal(tz);
  const date = isDay(sp.date) ? sp.date : today;
  // A member id that is not an id is refused like one the caller may not see, instead of reaching the database.
  const badMember = !!sp.member && !uuid.safeParse(sp.member).success;
  const membershipId = sp.member && !badMember ? sp.member : ctx.membership.id;
  const own = membershipId === ctx.membership.id;
  const isEmployee = ctx.membership.role === "employee";
  const [members, data, recent, ownTasks] = await Promise.all([
    isEmployee ? Promise.resolve([]) : withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND app_can_view_records($1, m.id) ORDER BY pr.display_name`, [ctx.org.id])),
    badMember ? Promise.resolve(null) : timesheetForDate(ctx, membershipId, date).catch((err) => { if (err instanceof AppError && err.status === 403) return null; throw err; }),
    badMember ? Promise.resolve([]) : recentDays(ctx, membershipId, today),
    // The person's own tasks, so a correction can claim time on a day the timer never ran.
    own ? withUser(ctx.user.profileId, (db) => db.query<{ id: string; title: string }>(`SELECT id, title FROM tasks WHERE organisation_id = $1 AND assignee_membership_id = $2 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100`, [ctx.org.id, ctx.membership.id])) : Promise.resolve([]),
  ]);
  const memberName = own ? "You" : members.find((m) => m.id === membershipId)?.display_name ?? "This member";
  const dayLabel = date === today ? "today" : formatLongDate(date);
  const base = `/app/${ctx.org.slug}`;
  const day = data?.day;
  const entries = day ? [...day.entries, ...day.uncertain].sort((a, b) => a.startedAt.localeCompare(b.startedAt)) : [];
  // The last 14 days ending today, a bar each (days with no time read 0); the chosen day is the orange one.
  const fortnight = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const secondsOn = new Map(recent.map((r) => [r.local_date, r.seconds]));
  const totalFortnight = recent.reduce((a, r) => a + r.seconds, 0);
  const daysWorked = recent.filter((r) => r.seconds > 0).length;
  const uncertainSeconds = day ? day.uncertain.reduce((a, e) => a + e.seconds, 0) : 0;
  const canExport = ["owner", "hr", "manager"].includes(ctx.membership.role);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title={isEmployee ? "My timesheet" : "Timesheets"} divider
        description={<>{own ? "Your" : `${memberName}'s`} confirmed time for {date === today ? `today, ${formatLongDate(date)}` : formatLongDate(date)}, split at local midnight. A correction changes it once a team lead approves it.</>}
        actions={canExport || (own && day) ? <>
          {canExport ? <ExportForm canExport={ctx.plan.features.EXPORT_REPORTS} upgradeTo={ctx.plan.upgradeTo} orgSlug={ctx.org.slug} members={members} today={today} /> : null}
          {own && day ? <AdjustmentForm orgSlug={ctx.org.slug} localDate={date} dateLabel={dayLabel} entries={entries} tasks={ownTasks} timeZone={tz} /> : null}
        </> : undefined} />
      <MemberDatePicker orgSlug={ctx.org.slug} members={members} membershipId={membershipId} date={date} prev={addDays(date, -1)} next={addDays(date, 1)} today={today} />
      {!data || !day ? (
        <Alert tone="danger" title="You cannot view this person's timesheet">Timesheets are open to the person, their team lead, HR and the owner. <Link href={`${base}/timesheets`} className="font-medium text-foreground underline underline-offset-2">Open your own timesheet</Link>.</Alert>
      ) : (
        <>
          <section aria-label="Confirmed time" className="mb-10 overflow-hidden rounded-2xl border border-border bg-background shadow-chart">
            <MetricStrip label="Confirmed time" value="day"
              metrics={[
                { key: "day", label: date === today ? "Today" : shortDay(date), value: hours(day.totalSeconds), hint: `${day.totalsByTask.length} task${day.totalsByTask.length === 1 ? "" : "s"}` },
                { key: "fortnight", label: "Last 14 days", value: hours(totalFortnight), hint: `${daysWorked} day${daysWorked === 1 ? "" : "s"} with time` },
                { key: "average", label: "Daily average", value: hours(daysWorked ? Math.round(totalFortnight / daysWorked) : 0), hint: "On days with time" },
                ...(uncertainSeconds ? [{ key: "uncertain", label: "Uncertain", value: formatDuration(uncertainSeconds), hint: "Not credited until corrected" }] : []),
              ]} />
            <div className="p-5">
              <BarChart title="Confirmed hours, last 14 days" labels={fortnight.map((d) => String(Number(d.slice(8))))} values={fortnight.map((d) => Math.round((secondsOn.get(d) ?? 0) / 360) / 10)} highlight={fortnight.indexOf(date)} format={(n) => `${Math.round(n * 10) / 10}h`} empty="No confirmed time in the last two weeks." />
            </div>
          </section>

          <div className="@container">
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,1fr)_18rem] @4xl:gap-8">
              <div className="min-w-0 space-y-10">
                <section aria-labelledby="ts-intervals">
                  <SectionTitle id="ts-intervals" title={own ? "Your tracked time" : `${memberName}'s tracked time`} />
                  {entries.length === 0 ? <EmptyState compact icon3d="chart-ring" title={`No tracked time ${date === today ? "today" : "on this day"}`} description={own ? "Start the timer on a task and the time shows here. Forgot to? Request a time correction." : undefined} /> : (
                    <DataTable caption={`Intervals for ${formatLongDate(date)}`}>
                      <thead><tr><th>Task</th><th>From</th><th>To</th><th className="!text-right">Duration</th><th>Status</th></tr></thead>
                      <tbody>
                        {entries.map((e, i) => (
                          <tr key={`${e.intervalId}-${i}`}>
                            <td><span className="font-medium">{e.taskTitle}</span><p className="text-meta text-secondary">{e.projectName}, {label(e.category).toLowerCase()}</p></td>
                            <td className="nowrap tabular-nums">{timeOf(e.startedAt, tz)}</td>
                            <td className="nowrap tabular-nums">{timeOf(e.endedAt, tz)}</td>
                            <td className="nowrap text-right tabular-nums">{formatDuration(e.seconds)}</td>
                            <td><Badge tone={e.status === "confirmed" ? "success" : "warning"} dot>{label(e.status)}{e.source !== "timer" ? `, ${e.source}` : ""}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                  {day.uncertain.length ? <p className="mt-3 flex items-start gap-2 text-meta font-normal text-secondary"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />Uncertain time is never credited on its own. Request a correction to claim it.</p> : null}
                </section>

                {day.totalsByTask.length ? (
                  <section aria-labelledby="ts-by-task">
                    <SectionTitle id="ts-by-task" title="By task" />
                    <DataTable caption="Time by task">
                      <thead><tr><th>Task</th><th>Project</th><th className="!text-right">Time</th><th className="!text-right">Share</th></tr></thead>
                      <tbody>{day.totalsByTask.map((t) => (
                        <tr key={t.taskId}>
                          <td className="font-medium">{t.taskTitle}</td>
                          <td className="text-secondary">{t.projectName}</td>
                          <td className="text-right tabular-nums">{formatDuration(t.seconds)}</td>
                          <td className="text-right tabular-nums text-secondary">{day.totalSeconds ? `${Math.round((t.seconds / day.totalSeconds) * 100)}%` : "0%"}</td>
                        </tr>
                      ))}</tbody>
                    </DataTable>
                  </section>
                ) : null}

                {day.notes.length ? (
                  <section aria-labelledby="ts-notes">
                    <SectionTitle id="ts-notes" title="Progress notes" />
                    <ul className="space-y-3">{day.notes.map((n) => (
                      <li key={n.sessionId} className="flex gap-3 text-sm">
                        <span className="w-12 shrink-0 pt-px text-meta font-normal tabular-nums text-secondary">{timeOf(n.endedAt, tz)}</span>
                        <div className="min-w-0 flex-1">
                          {n.outcome ? <Badge className="mb-1">{label(n.outcome)}</Badge> : null}
                          <p className="font-normal text-foreground">{n.note}</p>
                        </div>
                      </li>
                    ))}</ul>
                  </section>
                ) : null}
              </div>

              <aside className="min-w-0 space-y-3" aria-label="More about this timesheet">
                <Card className="p-3">
                  <h2 className="px-2 pb-2 pt-1 text-sm font-semibold text-foreground">Recent days</h2>
                  {recent.length === 0 ? <p className="px-2 pb-1 text-meta font-normal text-secondary">No confirmed time in the last two weeks.</p> : (
                    <ul>{recent.map((r) => (
                      <li key={r.local_date}>
                        <Link href={`${base}/timesheets?member=${membershipId}&date=${r.local_date}`} aria-current={r.local_date === date ? "date" : undefined}
                          className={cn("flex h-8 items-center justify-between gap-3 rounded-lg px-2 text-sm font-medium transition-colors duration-75 hover:bg-fill-1 hover:text-foreground pointer-coarse:h-10", r.local_date === date ? "bg-fill-1 text-foreground" : "text-secondary")}>
                          <span>{shortDay(r.local_date)}</span>
                          <span className="tabular-nums">{formatDuration(r.seconds)}</span>
                        </Link>
                      </li>
                    ))}</ul>
                  )}
                </Card>
                {data.adjustments.length ? (
                  <Card>
                    <h2 className="mb-3 text-sm font-semibold text-foreground">Corrections on this day</h2>
                    <ul className="space-y-4 text-sm">{data.adjustments.map((a) => (
                      <li key={a.id}>
                        <p className="flex flex-wrap items-center gap-2"><Badge tone={ADJUSTMENT_TONE[a.status] ?? "warning"} dot>{label(a.status)}</Badge><span className="font-medium text-foreground">{a.task_title}</span></p>
                        <p className="mt-1 font-normal text-secondary">{a.reason}</p>
                        {a.review_note ? <p className="mt-1 text-meta font-normal text-subtle">Review note: {a.review_note}</p> : null}
                      </li>
                    ))}</ul>
                  </Card>
                ) : null}
              </aside>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
