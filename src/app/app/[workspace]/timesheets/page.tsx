import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge, REPORT_STATUS_TONE, label } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { reportForDate } from "@/server/services/reports";
import { withUser } from "@/server/db";
import { todayLocal, addDays } from "@/server/lib/time";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { SubmitReportForm, AdjustmentForm, ExportForm, MemberDatePicker } from "@/components/app/timesheet-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheets" };

export default async function TimesheetsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ member?: string; date?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/timesheets`);
  const tz = ctx.org.timezone;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayLocal(tz);
  const membershipId = sp.member ?? ctx.membership.id;
  const members = ctx.membership.role === "employee" ? [] : await withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' AND app_can_view_records($1, m.id) ORDER BY pr.display_name`, [ctx.org.id]));
  let data: Awaited<ReturnType<typeof reportForDate>> | null = null;
  let denied = false;
  try { data = await reportForDate(ctx, membershipId, date); } catch { denied = true; }
  const own = membershipId === ctx.membership.id;
  const memberName = own ? "You" : members.find((m) => m.id === membershipId)?.display_name ?? "Member";
  const recent = await withUser(ctx.user.profileId, (db) => db.query<{ local_date: string; status: string; total_seconds: number | null }>(`SELECT r.local_date, r.status, v.total_seconds FROM daily_reports r LEFT JOIN report_versions v ON v.report_id = r.id AND v.version = r.current_version WHERE r.membership_id = $1 ORDER BY r.local_date DESC LIMIT 14`, [membershipId]));
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `/app/${ctx.org.slug}`, label: "Home" }} overline="Records" title={ctx.membership.role === "employee" ? "My timesheet" : "Timesheets"} description="Daily reports are generated from work sessions and split at local midnight. Submitting creates an immutable versioned snapshot; corrections create a new version that needs fresh approval." actions={["owner", "hr", "manager"].includes(ctx.membership.role) ? <ExportForm orgSlug={ctx.org.slug} members={members} /> : null} />
      <MemberDatePicker orgSlug={ctx.org.slug} members={members} membershipId={membershipId} date={date} prev={addDays(date, -1)} next={addDays(date, 1)} />
      {denied || !data ? <Alert tone="danger">You cannot view that member&apos;s records.</Alert> : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg">{memberName} · {date}</h2>
                <span className="flex items-center gap-2">{data.report ? <Badge tone={REPORT_STATUS_TONE[data.report.status]}>{label(data.report.status)}{data.report.approved_version ? ` (v${data.report.approved_version} approved)` : ""}</Badge> : <Badge>not started</Badge>}<Badge tone="neutral">live total {formatDuration(data.live.totalSeconds)}</Badge></span>
              </div>
              {data.openSessionId ? <Alert tone="warning" className="mt-3">An open work session overlaps this day; stop it before submitting.</Alert> : null}
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-fg-subtle">Live entries (current ledger)</h3>
              {data.live.entries.length === 0 && data.live.uncertain.length === 0 ? <p className="mt-2 text-sm text-fg-muted">No tracked time on this day.</p> : (
                <DataTable className="mt-2" caption="Intervals">
                  <thead><tr><th>Task</th><th>From</th><th>To</th><th>Duration</th><th>Status</th></tr></thead>
                  <tbody>
                    {[...data.live.entries, ...data.live.uncertain].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((e, i) => (
                      <tr key={`${e.intervalId}-${i}`}><td>{e.taskTitle}<p className="text-xs text-fg-subtle">{e.projectName} · {e.category}</p></td><td>{formatDateTime(e.startedAt, tz)}</td><td>{formatDateTime(e.endedAt, tz)}</td><td>{formatDuration(e.seconds)}</td><td><Badge tone={e.status === "confirmed" ? "success" : "warning"}>{e.status}{e.source !== "timer" ? ` · ${e.source}` : ""}</Badge></td></tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {data.live.uncertain.length ? <p className="mt-2 text-xs text-warning">Uncertain time is never credited automatically. Use a correction to claim it.</p> : null}
              {data.live.notes.length ? <div className="mt-4"><h3 className="text-sm font-semibold uppercase tracking-wider text-fg-subtle">Progress notes</h3><ul className="mt-1 space-y-1 text-sm text-fg-muted">{data.live.notes.map((n) => <li key={n.sessionId}>{formatDateTime(n.endedAt, tz)} · {n.outcome ? label(n.outcome) : ""} — {n.note}</li>)}</ul></div> : null}
              <div className="mt-4"><h3 className="text-sm font-semibold uppercase tracking-wider text-fg-subtle">Totals by task</h3><ul className="mt-1 text-sm">{data.live.totalsByTask.map((t) => <li key={t.taskId}>{t.taskTitle} <span className="text-fg-subtle">({t.projectName})</span>: <strong>{formatDuration(t.seconds)}</strong></li>)}</ul></div>
            </Card>

            {own && (!data.report || ["draft", "changes_requested"].includes(data.report.status)) ? <SubmitReportForm orgSlug={ctx.org.slug} localDate={date} blockers={data.report?.blockers ?? ""} nextPriorities={data.report?.next_priorities ?? ""} disabled={!!data.openSessionId} /> : null}
            {own ? <AdjustmentForm orgSlug={ctx.org.slug} localDate={date} entries={[...data.live.entries, ...data.live.uncertain]} /> : null}

            <section>
              <h2 className="mb-3 font-display text-lg">Versions</h2>
              {data.versions.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No submitted versions yet.</p> : data.versions.map((v) => (
                <details key={v.id} className="tile mb-2 p-4" open={v.version === data.report?.current_version}>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><span className="font-semibold">Version {v.version} <Badge tone={REPORT_STATUS_TONE[v.status]}>{label(v.status)}</Badge></span><span className="text-sm text-fg-subtle">{formatDuration(v.total_seconds)} · submitted {formatDateTime(v.submitted_at, tz)} · zone {v.timezone_snapshot}{v.reviewer_name ? ` · reviewed by ${v.reviewer_name} ${formatDateTime(v.reviewed_at, tz)}` : ""}</span></summary>
                  {v.review_note ? <p className="mt-2 text-sm"><strong>Review note:</strong> {v.review_note}</p> : null}
                  {v.blockers ? <p className="mt-1 text-sm"><strong>Blockers:</strong> {v.blockers}</p> : null}{v.next_priorities ? <p className="text-sm"><strong>Next:</strong> {v.next_priorities}</p> : null}
                  <ul className="mt-2 text-sm text-fg-muted">{v.snapshot.totalsByTask.map((t) => <li key={t.taskId}>{t.taskTitle}: {formatDuration(t.seconds)}</li>)}</ul>
                </details>
              ))}
            </section>
          </div>
          <aside className="space-y-4">
            <Card>
              <h2 className="font-display text-lg">Recent days</h2>
              <ul className="mt-2 space-y-1 text-sm">{recent.length === 0 ? <li className="text-fg-subtle">No reports yet.</li> : recent.map((r) => <li key={r.local_date} className="flex justify-between"><Link href={`?member=${membershipId}&date=${r.local_date}`} className="hover:underline">{r.local_date}</Link><span><Badge tone={REPORT_STATUS_TONE[r.status]}>{label(r.status)}</Badge> {r.total_seconds != null ? formatDuration(r.total_seconds) : ""}</span></li>)}</ul>
            </Card>
            {data.adjustments.length ? <Card><h2 className="font-display text-lg">Corrections on this report</h2><ul className="mt-2 space-y-2 text-sm">{data.adjustments.map((a) => <li key={a.id}><Badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning"}>{a.status}</Badge> {a.task_title}: {a.reason}{a.review_note ? <p className="text-fg-muted">Note: {a.review_note}</p> : null}</li>)}</ul></Card> : null}
          </aside>
        </div>
      )}
    </AppShell>
  );
}
