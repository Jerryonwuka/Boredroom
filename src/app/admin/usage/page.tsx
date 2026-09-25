import Link from "next/link";
import { requireAdmin } from "@/server/admin/auth";
import { usageOverview, liveActivity, storageOverview } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Filters, CsvLink } from "@/components/admin/actions";
import { F, inputCls } from "@/components/admin/fields";
import { bytes, num, hours } from "@/lib/format";
import { relativeTime, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Usage and activity" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("usage.view");
  const sp = await searchParams;
  const tab = ["overview", "live", "storage"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const tabs = [["overview", "Overview"], ["live", "Live activity"], ["storage", "Storage"]].map(([v, l]) => ({ label: l, href: `/admin/usage${v === "overview" ? "" : `?tab=${v}`}`, value: v }));
  return (
    <>
      <PageHeader icon="focus-target" title="Usage and activity" description="What the platform is doing: sessions, clock-ins, tasks, recordings and storage, globally, by organisation and by plan." actions={<CsvLink href="/api/admin/export?kind=usage" />} />
      <Tabs tabs={tabs} value={tab} className="mb-6" label="Usage sections" />

      {tab === "overview" ? await (async () => {
        const u = await usageOverview(days);
        const max = Math.max(1, ...u.byDay.map((d) => d.sessions));
        return (
          <>
            <Filters><F label="Period"><select name="days" defaultValue={String(days)} className={inputCls}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></F></Filters>
            <Card className="mb-6"><Ledger items={[{ label: "Active today", value: num(u.totals.active_users), note: `${num(u.totals.mau)} in 30 days` }, { label: `Sessions, ${days} days`, value: num(u.totals.sessions), tone: "accent" }, { label: "Hours", value: hours(u.totals.hours) }, { label: "Clock-ins", value: num(u.totals.clock_ins), note: `${num(u.totals.clock_outs)} clocked out` }]} /><p className="eyebrow mt-3">Tasks created {num(u.totals.tasks_created)} · completed {num(u.totals.tasks_completed)} · recordings {num(u.totals.videos)}</p></Card>
            <Card className="mb-6"><CardHeader title="Sessions per day" />
              <div className="flex h-32 items-end gap-px">{u.byDay.map((d) => <div key={d.day} title={`${d.day}: ${d.sessions} sessions, ${d.clock_ins} clock-ins, ${d.tasks_completed} tasks done`} className="flex-1 rounded-t-sm bg-accent/70" style={{ height: `${Math.max(2, (d.sessions / max) * 100)}%` }} />)}</div>
              <p className="eyebrow mt-2">{u.byDay[0]?.day} to {u.byDay[u.byDay.length - 1]?.day}</p>
            </Card>
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card><CardHeader title="By organisation" />
                <DataTable caption="Usage by organisation"><thead><tr><th>Organisation</th><th>Plan</th><th>People</th><th>Sessions</th><th>Hours</th><th>Clock-ins</th><th>Storage</th></tr></thead><tbody>{u.byOrg.map((o) => <tr key={o.id}><td><Link href={`/admin/organisations/${o.id}?tab=usage`} className="font-semibold hover:underline">{o.name}</Link></td><td className="text-sm">{o.plan ?? "—"}</td><td className="tabular-nums">{num(o.users)}</td><td className="tabular-nums">{num(o.sessions)}</td><td className="tabular-nums">{hours(o.hours)}</td><td className="tabular-nums">{num(o.clock_ins)}</td><td className="tabular-nums">{bytes(o.storage)}</td></tr>)}</tbody></DataTable>
              </Card>
              <Card><CardHeader title="By plan" /><ul className="divide-y divide-border-soft text-sm">{u.byPlan.map((p) => <li key={p.plan} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{p.plan}</span><span className="text-xs text-fg-subtle">{num(p.orgs)} orgs · {num(p.users)} people · {num(p.sessions)} sessions</span></li>)}</ul></Card>
            </div>
          </>
        );
      })() : null}

      {tab === "live" ? await (async () => {
        const state = (["all", "working", "paused", "clocked_in"].includes(sp.state ?? "") ? sp.state : "all") as "all" | "working" | "paused" | "clocked_in";
        const l = await liveActivity({ org: sp.org, state });
        return (
          <>
            <Filters><input type="hidden" name="tab" value="live" /><F label="Show"><select name="state" defaultValue={state} className={inputCls}><option value="all">Everyone active</option><option value="working">Working</option><option value="paused">Paused or idle</option><option value="clocked_in">Clocked in</option></select></F></Filters>
            <p className="eyebrow mb-4">Live now: {num(l.counts.working)} working · {num(l.counts.paused)} paused or idle · {num(l.counts.clockedIn)} clocked in · as of {formatDateTime(new Date())}</p>
            {l.groups.length === 0 ? <EmptyState icon3d="stopwatch" title="Nobody is active right now" description="People appear here the moment they clock in or start a timer." /> : (
              <div className="grid gap-4 md:grid-cols-2">{l.groups.map((g) => (
                <Card key={g.id}><CardHeader title={<Link href={`/admin/organisations/${g.id}?tab=activity`} className="hover:underline">{g.name}</Link>} description={`${g.people.length} active`} className="mb-2" />
                  <ul className="divide-y divide-border-soft text-sm">{g.people.map((p, i) => <li key={i} className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium">{p.display_name}</span>{p.task_title ? <span className="text-fg-subtle"> · {p.task_title}</span> : null}</span><span className="flex items-center gap-2 text-xs text-fg-subtle"><Badge tone={p.state === "running" ? (p.stale ? "danger" : "success") : p.state === "clocked_in" ? "info" : "warning"} dot>{p.state === "running" ? (p.stale ? "stale" : "working") : p.state === "clocked_in" ? "clocked in" : p.state}</Badge>{p.last_heartbeat_at ? relativeTime(p.last_heartbeat_at) : p.clocked_in_at ? `in ${relativeTime(p.clocked_in_at)}` : ""}</span></li>)}</ul>
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
            <Card className="mb-6"><Ledger items={[{ label: "Recordings", value: bytes(s.totals.recordings), tone: "accent" }, { label: "Deliverables", value: bytes(s.totals.deliverables) }, { label: "Avatars", value: num(s.totals.avatars) }, { label: "Voice notes", value: num(s.totals.voice) }]} />{s.growth.length ? <p className="eyebrow mt-3">Recording growth: {s.growth.map((g) => `${g.month} ${bytes(g.bytes)}`).join(" · ")}</p> : null}</Card>
            <DataTable caption="Storage by organisation"><thead><tr><th>Organisation</th><th>Plan</th><th>Recordings</th><th>Deliverables</th><th>Total</th><th>Quota</th></tr></thead><tbody>{s.byOrg.map((o) => { const pct = o.quota ? Math.round((Number(o.total) / Number(o.quota)) * 100) : null; return <tr key={o.id}><td><Link href={`/admin/organisations/${o.id}?tab=storage`} className="font-semibold hover:underline">{o.name}</Link></td><td className="text-sm">{o.plan ?? "—"}</td><td className="tabular-nums">{bytes(o.recordings)}</td><td className="tabular-nums">{bytes(o.deliverables)}</td><td className="tabular-nums">{bytes(o.total)}</td><td>{pct === null ? <span className="text-fg-subtle">unlimited</span> : <Badge tone={pct >= 100 ? "danger" : pct >= 80 ? "warning" : "neutral"}>{pct}% of {bytes(o.quota)}</Badge>}</td></tr>; })}</tbody></DataTable>
          </>
        );
      })() : null}
    </>
  );
}
