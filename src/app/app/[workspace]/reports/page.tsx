import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { metrics } from "@/server/services/reports";
import { withUser } from "@/server/db";
import { todayLocal, addDays } from "@/server/lib/time";
import { formatDuration, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ from?: string; to?: string; member?: string; project?: string; team?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/reports`);
  const today = todayLocal(ctx.org.timezone);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -13);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const isEmployee = ctx.membership.role === "employee";
  const member = isEmployee ? ctx.membership.id : sp.member || null;
  const [m, projects, teams, members] = await Promise.all([
    metrics(ctx, { from, to, membershipId: member, projectId: sp.project || null, teamId: sp.team || null }),
    withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE organisation_id = $1 ORDER BY name`, [ctx.org.id])),
    withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id])),
    isEmployee ? Promise.resolve([]) : withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND app_can_view_records($1, m.id) ORDER BY pr.display_name`, [ctx.org.id])),
  ]);
  const provisionalBy = new Map(m.provisional.map((p) => [p.membership_id, p.seconds]));
  const onTime = m.delivery.with_due ? Math.round((m.delivery.on_time / m.delivery.with_due) * 100) : null;
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline={`${from} → ${to}`} title="Reports" description="Transparent measures at employee, team and project scope. No composite score, no ranking by hours. Approved and provisional data are shown separately." />
      <form className="mb-6 flex flex-wrap items-end gap-2 text-sm">
        <label><span className="block text-xs text-fg-subtle">From</span><Input name="from" type="date" defaultValue={from} /></label>
        <label><span className="block text-xs text-fg-subtle">To</span><Input name="to" type="date" defaultValue={to} /></label>
        {!isEmployee ? <label><span className="block text-xs text-fg-subtle">Member</span><Select name="member" defaultValue={sp.member ?? ""}><option value="">All in scope</option>{members.map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}</Select></label> : null}
        {!isEmployee ? <label><span className="block text-xs text-fg-subtle">Team</span><Select name="team" defaultValue={sp.team ?? ""}><option value="">All</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label> : null}
        <label><span className="block text-xs text-fg-subtle">Project</span><Select name="project" defaultValue={sp.project ?? ""}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label="Delivery count" value={String(m.delivery.approved)} note="tasks approved in period (by approval date)" />
        <Stat label="On-time delivery" value={onTime == null ? "n/a" : `${onTime}%`} note={`${m.delivery.on_time} of ${m.delivery.with_due} dated tasks; undated excluded`} />
        <Stat label="Estimate variance" value={m.delivery.est_count ? `${m.delivery.est_variance >= 0 ? "+" : "−"}${formatDuration(Math.abs(m.delivery.est_variance))}` : "n/a"} note={`${m.delivery.est_count} approved tasks with estimates; tasks without estimates excluded`} />
        <Stat label="Capture coverage" value={m.capture.tracked ? `${Math.min(100, Math.round((m.capture.recorded / m.capture.tracked) * 100))}%` : "n/a"} note={`recording-required sessions only${m.capture.pending ? ` · ${m.capture.pending} recording(s) pending, so provisional` : ""}. Not a productivity measure.`} />
      </div>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg">Time allocation</h2>
        <DataTable caption="Approved and provisional time per member">
          <thead><tr><th>Member</th><th>Approved tracked time</th><th>Approved days</th><th>Provisional (unapproved confirmed intervals)</th></tr></thead>
          <tbody>{m.approvedTime.map((r) => <tr key={r.membership_id}><td>{r.display_name}</td><td className="font-semibold">{formatDuration(r.seconds)}</td><td>{r.days}</td><td className="text-fg-muted">{formatDuration(provisionalBy.get(r.membership_id) ?? 0)}</td></tr>)}</tbody>
        </DataTable>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg">Open blockers ({m.blockers.length})</h2>
          <p className="text-xs text-fg-subtle">Age is elapsed wall-clock time since the task was marked blocked, not labour hours.</p>
          <ul className="mt-2 space-y-1 text-sm">{m.blockers.length === 0 ? <li className="text-fg-subtle">None.</li> : m.blockers.map((b) => <li key={b.id}><strong>{b.title}</strong> · {b.display_name} · since {formatDateTime(b.since, ctx.org.timezone)}{b.blocked_reason ? <p className="text-fg-muted">{b.blocked_reason}</p> : null}</li>)}</ul>
        </Card>
        <Card>
          <h2 className="font-display text-lg">Report completeness</h2>
          <p className="text-xs text-fg-subtle">Submitted reports ÷ expected workdays ({m.expectedDays}) under the saved schedule, minus authorised exemptions.</p>
          <ul className="mt-2 space-y-1 text-sm">{m.completeness.map((c) => { const expected = Math.max(0, m.expectedDays - c.exempt); return <li key={c.membership_id} className="flex justify-between"><span>{c.display_name}</span><span>{c.submitted} / {expected}{expected ? ` (${Math.round((c.submitted / expected) * 100)}%)` : ""}</span></li>; })}</ul>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="tile p-4"><p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{label}</p><p className="mt-1 font-display text-3xl">{value}</p><p className="mt-1 text-xs text-fg-muted">{note}</p></div>;
}
