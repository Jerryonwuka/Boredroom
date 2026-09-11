import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PermissionDenied } from "@/components/ui/states";
import { teamStatus } from "@/server/services/views";
import { formatDuration, relativeTime, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function TeamPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/team`);
  if (ctx.membership.role === "employee") return <AppShell ctx={ctx} counts={counts} teams={teams}><PermissionDenied description="The team view is available to managers, HR and owners. Your own records are under Timesheets." /></AppShell>;
  const data = await teamStatus(ctx, { teamId: sp.team ?? null });
  const now = new Date(data.serverNow).getTime();
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline={`Reported activity · ${data.today}`} title="Team" description={<>What people report working on right now. Status turns stale after {data.staleAfterSeconds}s without a heartbeat. Last sync: {formatDateTime(data.serverNow, ctx.org.timezone)}. Heartbeats show connection, not productivity.</>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">Team:</span>
        <Link href="?" className={`rounded-full border px-3 py-1 ${!sp.team ? "border-accent" : "border-border text-fg-muted"}`}>All</Link>
        {data.teams.map((t) => <Link key={t.id} href={`?team=${t.id}`} className={`rounded-full border px-3 py-1 ${sp.team === t.id ? "border-accent" : "border-border text-fg-muted"}`}>{t.name}</Link>)}
      </div>
      {data.rows.length === 0 ? <EmptyState title="No members in scope" description="Managers see the members of their teams; HR and owners see everyone." /> : (
        <DataTable caption="Team status">
          <thead><tr><th>Member</th><th>Now</th><th>Sync</th><th>Today (confirmed)</th><th>Blocked</th><th>Open / in review</th><th>Last activity</th></tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const stale = r.session_state === "running" && r.last_heartbeat_at && now - new Date(r.last_heartbeat_at).getTime() > data.staleAfterSeconds * 1000;
              return (
                <tr key={r.membership_id}>
                  <td><Link href={`/app/${ctx.org.slug}/timesheets?member=${r.membership_id}`} className="font-semibold hover:underline">{r.display_name}</Link><p className="text-xs text-fg-subtle">{r.employee_code} · {r.role}{r.teams.length ? ` · ${r.teams.join(", ")}` : ""}</p></td>
                  <td>{r.session_id ? <><Badge tone={stale ? "danger" : SESSION_STATE_TONE[r.session_state!]} dot>{stale ? "stale" : label(r.session_state!)}</Badge> <Link href={`/app/${ctx.org.slug}/tasks/${r.task_id}`} className="ml-1 hover:underline">{r.task_title}</Link><p className="text-xs text-fg-subtle">since {formatDateTime(r.started_at, ctx.org.timezone)}</p></> : <span className="text-fg-subtle">No session</span>}</td>
                  <td className="text-sm text-fg-muted">{r.session_state === "running" ? relativeTime(r.last_heartbeat_at, now) : "—"}</td>
                  <td>{formatDuration(r.today_seconds)}</td>
                  <td>{r.blocked_tasks ? <Badge tone="danger">{r.blocked_tasks}</Badge> : "0"}</td>
                  <td>{r.open_tasks} / {r.in_review_tasks}</td>
                  <td className="text-sm text-fg-muted">{r.last_activity_at ? relativeTime(r.last_activity_at, now) : "never"}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </AppShell>
  );
}
