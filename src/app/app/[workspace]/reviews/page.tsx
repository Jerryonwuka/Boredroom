import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { reviewQueue } from "@/server/services/views";
import { formatDateTime, formatDuration, formatLongDate } from "@/lib/utils";
import { RowList, Row, RowEmpty } from "@/components/ui/rows";
import { Person } from "@/components/ui/person";
import { DecisionForm } from "@/components/app/small-actions";
import { SubmissionRow } from "@/components/app/review-sheet";
import { TaskRow } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/reviews`);
  const q = await reviewQueue(ctx);
  const tz = ctx.org.timezone;
  const base = `/app/${ctx.org.slug}`;
  const viewer = taskViewer(ctx);
  // Organisation accounts see the whole queue; team leads give the decisions.
  const decides = ctx.membership.role === "manager";
  const leadDecides = <p className="mt-2 text-xs text-fg-subtle">Waiting for the team lead&apos;s decision.</p>;
  const total = q.submissions.length + q.reports.length + q.adjustments.length + q.exceptions.length + q.incidents.length;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="eye-checklist" back={{ href: `/app/${ctx.org.slug}`, label: "Home" }} title="Reviews" description={decides ? "Submitted work, daily reports, time corrections, capture exceptions and privacy incidents waiting for a decision. You never see your own submissions here." : "Everything waiting for a decision across the organisation. Team leads give the decisions; you can see where each one stands."} />
      {total === 0 && q.overdue.length === 0 && q.missing.length === 0 ? <EmptyState icon3d="shield-check" title="Queue is clear" description={decides ? "Nothing is waiting for your decision." : "Nothing of yours is waiting on a decision."} /> : (
      <div className="space-y-6">
        <Section title="Task submissions" count={q.submissions.length} rows>
          {q.submissions.map((s) => (
            <SubmissionRow key={s.submission_id} orgSlug={ctx.org.slug} submissionId={s.submission_id} timezone={tz} leading={<Person orgSlug={ctx.org.slug} membershipId={s.assignee_membership_id} name={s.assignee_name} showName={false} size={32} />}
              title={s.title} meta={`${s.assignee_name} · revision ${s.revision}${s.note ? ` · ${s.note}` : ""}${s.reviewer_is_me ? "" : " · manager scope"}`}
              trailing={<><span className="eyebrow block">Submitted</span>{formatDateTime(s.submitted_at, tz)}</>} />
          ))}
        </Section>
        <Section title="Daily reports" count={q.reports.length}>
          {q.reports.map((r) => (
            <li key={r.id} className="tile p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.display_name}, {r.local_date}</span><span className="text-sm text-fg-subtle">version {r.current_version}, {formatDuration(r.total_seconds)}, submitted {formatDateTime(r.submitted_at, tz)}{r.has_adjustment ? ", includes a correction" : ""}</span></div>
              {r.blockers ? <p className="mt-1 text-sm"><strong>Blockers:</strong> {r.blockers}</p> : null}{r.next_priorities ? <p className="text-sm"><strong>Next:</strong> {r.next_priorities}</p> : null}
              <Link href={`${base}/timesheets?member=${r.membership_id}&date=${r.local_date}`} className="link-action mt-1">Open full report</Link>
              {!decides ? leadDecides : r.has_adjustment ? <p className="mt-1 text-xs text-fg-subtle">Decide this one under Time corrections; approving the correction approves this version.</p> : <DecisionForm path={`/api/orgs/${ctx.org.slug}/reports/${r.id}/review`} extra={{ version: r.current_version }} options={[{ value: "approved", label: "Approve" }, { value: "changes_requested", label: "Request changes" }]} />}
            </li>
          ))}
        </Section>
        <Section title="Time corrections" count={q.adjustments.length}>
          {q.adjustments.map((a) => (
            <li key={a.id} className="tile p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{a.display_name}, {a.task_title}</span><span className="text-sm text-fg-subtle">{formatDateTime(a.created_at, tz)}</span></div>
              <p className="mt-1 text-sm">{a.reason}</p>{a.evidence_note ? <p className="text-sm text-fg-muted">Evidence: {a.evidence_note}</p> : null}
              <p className="mt-1 text-sm text-fg-muted">Replaces {a.original_count} interval(s) with: {a.proposed_intervals.map((p, i) => <span key={i} className="mr-2">{formatDateTime(p.startedAt, tz)} → {formatDateTime(p.endedAt, tz)}</span>)}</p>
              {decides ? <DecisionForm path={`/api/orgs/${ctx.org.slug}/time-adjustments/${a.id}/review`} options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject" }]} /> : leadDecides}
            </li>
          ))}
        </Section>
        <Section title="Capture exceptions" count={q.exceptions.length}>
          {q.exceptions.map((c) => (
            <li key={c.id} className="tile p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{c.display_name}{c.task_title ? `, ${c.task_title}` : ""}</span><span className="text-sm text-fg-subtle"><Badge tone="warning">{c.reason_code.replace(/_/g, " ")}</Badge> {formatDateTime(c.created_at, tz)}</span></div><p className="mt-1 text-sm">{c.reason}</p>{decides ? <DecisionForm path={`/api/orgs/${ctx.org.slug}/capture-exceptions/${c.id}/review`} options={[{ value: "accepted", label: "Accept" }, { value: "rejected", label: "Reject" }]} /> : leadDecides}</li>
          ))}
        </Section>
        {q.incidents.length ? (
          <Section title="Privacy incidents (restricted footage)" count={q.incidents.length}>
            {q.incidents.map((i) => (
              <li key={i.id} className="tile border-danger/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Flagged by {i.reporter_name}</span><span className="text-sm text-fg-subtle">{formatDateTime(i.restricted_at, tz)}</span></div><p className="mt-1 text-sm">{i.reason}</p><p className="text-xs text-fg-subtle">Ordinary playback is denied while open. Deletion removes chunks and derivatives and is logged.</p><DecisionForm path={`/api/orgs/${ctx.org.slug}/incidents/${i.id}/resolve`} options={[{ value: "deleted", label: "Delete recording" }, { value: "released", label: "Release for normal access" }]} noteLabel="Decision note (required)" /></li>
            ))}
          </Section>
        ) : null}
        {q.overdue.length || q.missing.length || ctx.membership.role !== "employee" ? <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="font-display text-lg">Overdue commitments ({q.overdue.length})</h2>
            <RowList className="mt-3">{q.overdue.length === 0 ? <RowEmpty icon3d="card-check" title="No overdue commitments" /> : q.overdue.map((t) => <TaskRow key={t.id} orgSlug={ctx.org.slug} viewer={viewer} task={{ id: t.id, title: t.title, status: t.status, due_at: t.due_at, assignee_membership_id: t.assignee_membership_id, assignee_name: t.assignee_name, overdue: true }} leading={<Person orgSlug={ctx.org.slug} membershipId={t.assignee_membership_id} name={t.assignee_name} profileId={t.assignee_profile_id} avatarKey={t.assignee_avatar_key} showName={false} size={32} />} meta={t.assignee_name} trailing={<><span className="eyebrow block">Due</span><span className="text-danger">{formatDateTime(t.due_at, tz)}</span></>} />)}</RowList>
          </Card>
          <Card>
            <h2 className="font-display text-lg">Missing reports, last 7 working days ({q.missing.length})</h2>
            <p className="text-xs text-fg-subtle">Days with tracked time but no submitted report. A missing report is a prompt for clarification, not a penalty.</p>
            <RowList className="mt-3">{q.missing.length === 0 ? <RowEmpty icon3d="doc-link-check" title="No missing reports" /> : q.missing.map((m) => <Row key={`${m.membership_id}${m.local_date}`} href={`${base}/timesheets?member=${m.membership_id}&date=${m.local_date}`} leading={<Person orgSlug={ctx.org.slug} membershipId={m.membership_id} name={m.display_name} showName={false} size={32} />} title={m.display_name} meta="No report for a day with tracked time" trailing={<><span className="eyebrow block">Day</span>{formatLongDate(m.local_date)}</>} />)}</RowList>
          </Card>
        </div> : null}
      </div>)}
    </AppShell>
  );
}

function Section({ title, count, children, rows = false }: { title: string; count: number; children: React.ReactNode; rows?: boolean }) {
  if (count === 0) return null;
  return <section><h2 className="mb-3 flex items-center gap-2 font-display text-lg">{title} <Badge tone="accent">{count}</Badge></h2>{rows ? <RowList className="tile px-3 py-1">{children}</RowList> : <ul className="space-y-3">{children}</ul>}</section>;
}
