import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { reviewQueue } from "@/server/services/views";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { DecisionForm } from "@/components/app/small-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/reviews`);
  const q = await reviewQueue(ctx);
  const tz = ctx.org.timezone;
  const base = `/app/${ctx.org.slug}`;
  const total = q.submissions.length + q.reports.length + q.adjustments.length + q.exceptions.length + q.incidents.length;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `/app/${ctx.org.slug}`, label: "Home" }} overline="Attention queue" title="Reviews" description="Submitted work, daily reports, time corrections, capture exceptions and privacy incidents waiting for a decision. You never see your own submissions here." />
      {total === 0 && q.overdue.length === 0 && q.missing.length === 0 ? <EmptyState title="Queue is clear" description="Nothing is waiting for you." /> : null}
      <div className="space-y-8">
        <Section title="Task submissions" count={q.submissions.length}>
          {q.submissions.map((s) => (
            <li key={s.submission_id} className="tile p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`${base}/tasks/${s.task_id}`} className="font-semibold hover:underline">{s.title}</Link><span className="text-sm text-fg-subtle">{s.assignee_name} · revision {s.revision} · {formatDateTime(s.submitted_at, tz)}{s.reviewer_is_me ? "" : " · manager scope"}</span></div>{s.note ? <p className="mt-1 text-sm text-fg-muted">{s.note}</p> : null}<Link href={`${base}/tasks/${s.task_id}`} className="mt-2 inline-block text-sm text-accent underline">Open task to review evidence</Link></li>
          ))}
        </Section>
        <Section title="Daily reports" count={q.reports.length}>
          {q.reports.map((r) => (
            <li key={r.id} className="tile p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.display_name} · {r.local_date}</span><span className="text-sm text-fg-subtle">version {r.current_version} · {formatDuration(r.total_seconds)} · submitted {formatDateTime(r.submitted_at, tz)}{r.has_adjustment ? " · includes a correction" : ""}</span></div>
              {r.blockers ? <p className="mt-1 text-sm"><strong>Blockers:</strong> {r.blockers}</p> : null}{r.next_priorities ? <p className="text-sm"><strong>Next:</strong> {r.next_priorities}</p> : null}
              <Link href={`${base}/timesheets?member=${r.membership_id}&date=${r.local_date}`} className="mt-1 inline-block text-sm text-accent underline">Open full report</Link>
              {r.has_adjustment ? <p className="mt-1 text-xs text-fg-subtle">Decide this one under Time corrections; approving the correction approves this version.</p> : <DecisionForm path={`/api/orgs/${ctx.org.slug}/reports/${r.id}/review`} extra={{ version: r.current_version }} options={[{ value: "approved", label: "Approve" }, { value: "changes_requested", label: "Request changes" }]} />}
            </li>
          ))}
        </Section>
        <Section title="Time corrections" count={q.adjustments.length}>
          {q.adjustments.map((a) => (
            <li key={a.id} className="tile p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{a.display_name} · {a.task_title}</span><span className="text-sm text-fg-subtle">{formatDateTime(a.created_at, tz)}</span></div>
              <p className="mt-1 text-sm">{a.reason}</p>{a.evidence_note ? <p className="text-sm text-fg-muted">Evidence: {a.evidence_note}</p> : null}
              <p className="mt-1 text-sm text-fg-muted">Replaces {a.original_count} interval(s) with: {a.proposed_intervals.map((p, i) => <span key={i} className="mr-2">{formatDateTime(p.startedAt, tz)} → {formatDateTime(p.endedAt, tz)}</span>)}</p>
              <DecisionForm path={`/api/orgs/${ctx.org.slug}/time-adjustments/${a.id}/review`} options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject" }]} />
            </li>
          ))}
        </Section>
        <Section title="Capture exceptions" count={q.exceptions.length}>
          {q.exceptions.map((c) => (
            <li key={c.id} className="tile p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{c.display_name}{c.task_title ? ` · ${c.task_title}` : ""}</span><span className="text-sm text-fg-subtle"><Badge tone="warning">{c.reason_code.replace(/_/g, " ")}</Badge> {formatDateTime(c.created_at, tz)}</span></div><p className="mt-1 text-sm">{c.reason}</p><DecisionForm path={`/api/orgs/${ctx.org.slug}/capture-exceptions/${c.id}/review`} options={[{ value: "accepted", label: "Accept" }, { value: "rejected", label: "Reject" }]} /></li>
          ))}
        </Section>
        {q.incidents.length ? (
          <Section title="Privacy incidents (restricted footage)" count={q.incidents.length}>
            {q.incidents.map((i) => (
              <li key={i.id} className="tile border-danger/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">Flagged by {i.reporter_name}</span><span className="text-sm text-fg-subtle">{formatDateTime(i.restricted_at, tz)}</span></div><p className="mt-1 text-sm">{i.reason}</p><p className="text-xs text-fg-subtle">Ordinary playback is denied while open. Deletion removes chunks and derivatives and is logged.</p><DecisionForm path={`/api/orgs/${ctx.org.slug}/incidents/${i.id}/resolve`} options={[{ value: "deleted", label: "Delete recording" }, { value: "released", label: "Release for normal access" }]} noteLabel="Decision note (required)" /></li>
            ))}
          </Section>
        ) : null}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="font-display text-lg">Overdue commitments ({q.overdue.length})</h2>
            <ul className="mt-2 space-y-1 text-sm">{q.overdue.length === 0 ? <li className="text-fg-subtle">None.</li> : q.overdue.map((t) => <li key={t.id}><Link href={`${base}/tasks/${t.id}`} className="hover:underline">{t.title}</Link> <span className="text-fg-subtle">· {t.assignee_name} · due {formatDateTime(t.due_at, tz)}</span></li>)}</ul>
          </Card>
          <Card>
            <h2 className="font-display text-lg">Missing reports, last 7 working days ({q.missing.length})</h2>
            <p className="text-xs text-fg-subtle">Days with tracked time but no submitted report. A missing report is a prompt for clarification, not a penalty.</p>
            <ul className="mt-2 space-y-1 text-sm">{q.missing.length === 0 ? <li className="text-fg-subtle">None.</li> : q.missing.map((m) => <li key={`${m.membership_id}${m.local_date}`}><Link href={`${base}/timesheets?member=${m.membership_id}&date=${m.local_date}`} className="hover:underline">{m.display_name} · {m.local_date}</Link></li>)}</ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return <section><h2 className="mb-3 font-display text-lg">{title} <Badge tone="accent">{count}</Badge></h2><ul className="space-y-3">{children}</ul></section>;
}
