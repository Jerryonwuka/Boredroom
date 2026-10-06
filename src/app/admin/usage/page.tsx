import Link from "next/link";
import { Timer } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { usageOverview, liveActivity, storageOverview } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { BarChart } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { ProgressBar } from "@/components/ui/progress-arc";
import { Filters, CsvLink } from "@/components/admin/actions";
import { F, filterCls, linkCls, subCls, words } from "@/components/admin/fields";
import { bytes, num, hours } from "@/lib/format";
import { relativeTime, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Usage and activity" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("usage.view");
  const sp = await searchParams;
  const tab = ["overview", "live", "storage"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const tabs = [["overview", "Overview"], ["live", "Live activity"], ["storage", "Storage"]].map(([v, l]) => ({ label: l, href: `/admin/usage${v === "overview" ? "" : `?tab=${v}`}`, value: v }));
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <>
      <PageHeader title="Usage and activity" description="What the platform is doing: sessions, clock-ins, tasks, recordings and storage, globally, by organisation and by plan." actions={<CsvLink href="/api/admin/export?kind=usage" />}
        tabs={tabs} tabValue={tab} tabsLabel="Usage sections" />

      {tab === "overview" ? await (async () => {
        const u = await usageOverview(days);
        const labels = u.byDay.map((d) => dayLabel(d.day));
        const period = `Last ${days} days`;
        return (
          <>
            <Filters>
              <F label="Period"><select name="days" defaultValue={String(days)} className={filterCls}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></F>
            </Filters>
            <Ledger items={[{ label: "Active today", value: num(u.totals.active_users), note: `${num(u.totals.mau)} in 30 days` }, { label: "Hours", value: hours(u.totals.hours), note: period }, { label: "Tasks created", value: num(u.totals.tasks_created), note: period }, { label: "Recordings", value: num(u.totals.videos), note: period }]} />
            <AnalyticsCard className="my-6" label="Activity per day" metrics={[
              { key: "sessions", label: "Sessions", value: num(u.totals.sessions), hint: period, content: <BarChart title={`Sessions per day, ${period.toLowerCase()}`} labels={labels} values={u.byDay.map((d) => Number(d.sessions))} format={num} empty="No sessions in this period." /> },
              { key: "clock_ins", label: "Clock-ins", value: num(u.totals.clock_ins), hint: `${num(u.totals.clock_outs)} clocked out`, content: <BarChart title={`Clock-ins per day, ${period.toLowerCase()}`} labels={labels} values={u.byDay.map((d) => Number(d.clock_ins))} format={num} empty="No clock-ins in this period." /> },
              { key: "tasks", label: "Tasks done", value: num(u.totals.tasks_completed), hint: period, content: <BarChart title={`Tasks completed per day, ${period.toLowerCase()}`} labels={labels} values={u.byDay.map((d) => Number(d.tasks_completed))} format={num} empty="No tasks completed in this period." /> },
            ]} />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card className="min-w-0">
                <CardHeader title="By organisation" />
                {u.byOrg.length === 0 ? <p className="text-sm font-normal text-secondary">No organisations yet.</p> : (
                  <DataTable caption="Usage by organisation">
                    <thead><tr><th>Organisation</th><th>Plan</th><th>People</th><th>Sessions</th><th>Hours</th><th>Clock-ins</th><th>Storage</th></tr></thead>
                    <tbody>{u.byOrg.map((o) => <tr key={o.id}><td><Link href={`/admin/organisations/${o.id}?tab=usage`} className={linkCls}>{o.name}</Link></td><td>{o.plan ?? <span className="text-secondary">None</span>}</td><td className="tabular-nums">{num(o.users)}</td><td className="tabular-nums">{num(o.sessions)}</td><td className="tabular-nums">{hours(o.hours)}</td><td className="tabular-nums">{num(o.clock_ins)}</td><td className="tabular-nums">{bytes(o.storage)}</td></tr>)}</tbody>
                  </DataTable>
                )}
              </Card>
              <Card className="self-start">
                <CardHeader title="By plan" />
                <ul className="grid gap-2.5">{u.byPlan.map((p) => <li key={p.plan} className="min-w-0"><p className="text-sm font-medium text-foreground">{p.plan}</p><p className={subCls}><span className="tabular-nums">{num(p.orgs)}</span> organisations, <span className="tabular-nums">{num(p.users)}</span> people, <span className="tabular-nums">{num(p.sessions)}</span> sessions</p></li>)}</ul>
              </Card>
            </div>
          </>
        );
      })() : null}

      {tab === "live" ? await (async () => {
        const state = (["all", "working", "paused", "clocked_in"].includes(sp.state ?? "") ? sp.state : "all") as "all" | "working" | "paused" | "clocked_in";
        const l = await liveActivity({ org: sp.org, state });
        return (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Filters className="mb-0">
                <input type="hidden" name="tab" value="live" />
                <F label="Show"><select name="state" defaultValue={state} className={filterCls}><option value="all">Everyone active</option><option value="working">Working</option><option value="paused">Paused or idle</option><option value="clocked_in">Clocked in</option></select></F>
              </Filters>
              <p className="text-meta font-normal text-secondary">
                <span><span className="tabular-nums text-foreground">{num(l.counts.working)}</span> working, <span className="tabular-nums text-foreground">{num(l.counts.paused)}</span> paused or idle, <span className="tabular-nums text-foreground">{num(l.counts.clockedIn)}</span> clocked in, as of {formatDateTime(new Date())}</span>
              </p>
            </div>
            {l.groups.length === 0 ? <EmptyState icon={Timer} title="Nobody is active right now" description="People appear here the moment they clock in or start a timer." /> : (
              <div className="grid gap-3 md:grid-cols-2">{l.groups.map((g) => (
                <Card key={g.id}>
                  <CardHeader size="sm" className="mb-3" title={<Link href={`/admin/organisations/${g.id}?tab=activity`} className={linkCls}>{g.name}</Link>} description={`${g.people.length} active`} />
                  <ul className="grid gap-2">{g.people.map((p, i) => (
                    <li key={i} className="flex min-h-10 items-center justify-between gap-3">
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{p.display_name}</span>{p.task_title ? <span className={`${subCls} truncate`}>{p.task_title}</span> : null}</span>
                      <span className="flex shrink-0 items-center gap-2 text-meta font-normal text-secondary">
                        {p.state === "running" ? (p.stale ? <Badge tone="danger" dot>Stale</Badge> : <Badge><StatusDot tone="live" pulse={false} size={6} />Working</Badge>) : p.state === "clocked_in" ? <Badge tone="info" dot>Clocked in</Badge> : <Badge tone="warning" dot>{words(p.state)}</Badge>}
                        {p.last_heartbeat_at ? relativeTime(p.last_heartbeat_at) : p.clocked_in_at ? `in ${relativeTime(p.clocked_in_at)}` : ""}
                      </span>
                    </li>
                  ))}</ul>
                </Card>
              ))}</div>
            )}
          </>
        );
      })() : null}

      {tab === "storage" ? await (async () => {
        const s = await storageOverview();
        return (
          <>
            <Ledger items={[{ label: "Recordings", value: bytes(s.totals.recordings) }, { label: "Deliverables", value: bytes(s.totals.deliverables) }, { label: "Avatars", value: num(s.totals.avatars) }, { label: "Voice notes", value: num(s.totals.voice) }]} />
            {s.growth.length ? <p className="mt-3 text-meta font-normal text-secondary">Recording growth by month: {s.growth.map((g) => `${g.month} ${bytes(g.bytes)}`).join(", ")}.</p> : null}
            <h2 className="type-section-title mb-3.5 mt-8">By organisation</h2>
            {s.byOrg.length === 0 ? <p className="text-sm font-normal text-secondary">No organisations yet.</p> : (
              <DataTable caption="Storage by organisation">
                <thead><tr><th>Organisation</th><th>Plan</th><th>Recordings</th><th>Deliverables</th><th>Total</th><th>Quota</th></tr></thead>
                <tbody>{s.byOrg.map((o) => {
                  const pct = o.quota ? Math.round((Number(o.total) / Number(o.quota)) * 100) : null;
                  return (
                    <tr key={o.id}>
                      <td><Link href={`/admin/organisations/${o.id}?tab=storage`} className={linkCls}>{o.name}</Link></td>
                      <td>{o.plan ?? <span className="text-secondary">None</span>}</td>
                      <td className="tabular-nums">{bytes(o.recordings)}</td>
                      <td className="tabular-nums">{bytes(o.deliverables)}</td>
                      <td className="tabular-nums">{bytes(o.total)}</td>
                      <td>{pct === null ? <span className="text-secondary">Unlimited</span> : (
                        <span className="flex min-w-40 items-center gap-2">
                          <ProgressBar value={Number(o.total)} max={Number(o.quota)} label={`${o.name}: storage used of the quota`} valueText={`${pct}% of ${bytes(o.quota)}`} size="sm" tone="neutral" doneTone="accent" className="w-20" />
                          <span className={pct >= 100 ? "text-danger" : pct >= 80 ? "text-warning" : "text-secondary"}><span className="tabular-nums">{pct}%</span> of {bytes(o.quota)}</span>
                        </span>
                      )}</td>
                    </tr>
                  );
                })}</tbody>
              </DataTable>
            )}
          </>
        );
      })() : null}
    </>
  );
}
