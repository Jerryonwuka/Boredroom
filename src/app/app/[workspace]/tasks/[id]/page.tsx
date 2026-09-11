import Link from "next/link";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { taskDetail } from "@/server/services/views";
import { listSessionRecordings } from "@/server/services/recording";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { TaskActions, SubmissionForm, ReviewForm, CommentForm, DeliverableList, ReopenForm } from "@/components/app/task-forms";
import { SessionRecordings } from "@/components/app/recording-panel";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ submit?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/tasks/${id}`);
  const data = await taskDetail(ctx, id);
  if (!data) notFound();
  const { task, sessions, submissions, deliverables, reviews, comments, history, members, canManage } = data;
  const isAssignee = task.assignee_membership_id === ctx.membership.id;
  const isReviewer = task.reviewer_membership_id === ctx.membership.id;
  const latest = submissions[0];
  const latestDecided = latest ? reviews.some((r) => r.submission_id === latest.id && r.decision !== "question") : false;
  const canReview = task.status === "in_review" && latest && !latestDecided && !isAssignee && (isReviewer || canManage);
  const recordingsBySession = Object.fromEntries(await Promise.all(sessions.slice(0, 10).map(async (s) => [s.id, await listSessionRecordings(ctx, s.id)] as const)));
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline={task.project_name} title={task.title}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={TASK_STATUS_TONE[task.status]}>{label(task.status)}</Badge><Badge>{task.priority}</Badge><Badge>{task.category}</Badge>{task.capture_requirement !== "none" ? <Badge tone="warning">capture {task.capture_requirement}</Badge> : null}{task.archived_at ? <Badge tone="danger">archived</Badge> : null}<span className="text-sm">Assignee {task.assignee_name} · Reviewer {task.reviewer_name ?? "not set"}{task.due_at ? ` · Due ${formatDateTime(task.due_at, ctx.org.timezone)}` : ""}</span></span>}
        actions={<TaskActions orgSlug={ctx.org.slug} task={{ id: task.id, version: task.version, status: task.status, archived: !!task.archived_at, blockedReason: task.blocked_reason }} isAssignee={isAssignee} canManage={canManage} members={members} reviewerId={task.reviewer_membership_id} assigneeId={task.assignee_membership_id} />} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg">Expected output</h2>
            <p className="mt-2 whitespace-pre-wrap text-fg-muted">{task.expected_output}</p>
            {task.blocked_reason ? <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm"><strong>Blocked:</strong> {task.blocked_reason}</p> : null}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><dt className="text-fg-subtle">Tracked (confirmed)</dt><dd className="font-semibold">{formatDuration(task.tracked_seconds)}</dd></div>
              <div><dt className="text-fg-subtle">Estimate</dt><dd className="font-semibold">{task.estimate_minutes ? formatDuration(task.estimate_minutes * 60) : "—"}</dd></div>
              <div><dt className="text-fg-subtle">Created by</dt><dd className="font-semibold">{task.created_by_name}</dd></div>
              <div><dt className="text-fg-subtle">Completed</dt><dd className="font-semibold">{task.completed_at ? formatDateTime(task.completed_at, ctx.org.timezone) : "—"}</dd></div>
            </dl>
          </Card>

          {isAssignee && !task.archived_at && ["todo", "in_progress", "blocked"].includes(task.status) ? (
            <SubmissionForm orgSlug={ctx.org.slug} taskId={task.id} hasReviewer={!!task.reviewer_membership_id} autoOpen={!!sp.submit} nextRevision={(latest?.revision ?? 0) + 1} />
          ) : null}
          {canReview ? <ReviewForm orgSlug={ctx.org.slug} submissionId={latest.id} revision={latest.revision} /> : null}
          {task.status === "completed" && (isReviewer || canManage) ? <ReopenForm orgSlug={ctx.org.slug} taskId={task.id} version={task.version} /> : null}

          <section>
            <h2 className="mb-3 font-display text-lg">Evidence and review history</h2>
            {submissions.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No revisions submitted yet.</p> : submissions.map((s) => (
              <article key={s.id} className="tile mb-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Revision {s.revision}</h3><span className="text-sm text-fg-subtle">{s.submitted_by_name} · {formatDateTime(s.submitted_at, ctx.org.timezone)}</span></div>
                {s.note ? <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{s.note}</p> : null}
                <DeliverableList orgSlug={ctx.org.slug} items={deliverables.filter((d) => d.submission_id === s.id)} />
                <ul className="mt-3 space-y-2">
                  {reviews.filter((r) => r.submission_id === s.id).map((r) => (
                    <li key={r.id} className="rounded-lg border border-border bg-inset px-3 py-2 text-sm"><Badge tone={r.decision === "approved" ? "success" : r.decision === "changes_requested" ? "warning" : "info"}>{label(r.decision)}</Badge> <span className="text-fg-subtle">{r.reviewer_name} · {formatDateTime(r.reviewed_at, ctx.org.timezone)}</span>{r.note ? <p className="mt-1 whitespace-pre-wrap text-fg-muted">{r.note}</p> : null}</li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg">Work sessions</h2>
            {sessions.length === 0 ? <p className="tile p-4 text-sm text-fg-muted">No sessions yet.</p> : (
              <DataTable caption="Sessions on this task">
                <thead><tr><th>Started</th><th>Ended</th><th>State</th><th>Confirmed</th><th>Uncertain</th><th>Outcome</th></tr></thead>
                <tbody>{sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.started_at, ctx.org.timezone)}<p className="text-xs text-fg-subtle">{s.member_name}</p></td>
                    <td>{s.ended_at ? formatDateTime(s.ended_at, ctx.org.timezone) : "—"}</td>
                    <td><Badge tone={SESSION_STATE_TONE[s.state]}>{label(s.state)}</Badge></td>
                    <td>{formatDuration(s.confirmed_seconds)}</td>
                    <td>{s.uncertain_seconds ? <span className="text-warning">{formatDuration(s.uncertain_seconds)}</span> : "—"}</td>
                    <td>{s.stop_outcome ? label(s.stop_outcome) : "—"}{recordingsBySession[s.id]?.length ? <SessionRecordings orgSlug={ctx.org.slug} recordings={recordingsBySession[s.id]} own={isAssignee} /> : null}</td>
                  </tr>
                ))}</tbody>
              </DataTable>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card>
            <h2 className="font-display text-lg">Discussion</h2>
            <ul className="mt-3 space-y-3">
              {comments.length === 0 ? <li className="text-sm text-fg-subtle">No comments yet.</li> : comments.map((c) => <li key={c.id} className="text-sm"><p className="text-fg-subtle">{c.author_name} · {formatDateTime(c.created_at, ctx.org.timezone)}</p><p className="whitespace-pre-wrap">{c.body}</p></li>)}
            </ul>
            <CommentForm orgSlug={ctx.org.slug} taskId={task.id} />
          </Card>
          <Card>
            <h2 className="font-display text-lg">Status history</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {history.map((h, i) => <li key={i}><span className="text-fg-subtle">{formatDateTime(h.occurred_at, ctx.org.timezone)}</span> · {h.from_status ? `${label(h.from_status)} → ` : ""}{label(h.to_status)}{h.actor_name ? ` by ${h.actor_name}` : ""}{h.reason ? <p className="text-fg-muted">{h.reason}</p> : null}</li>)}
            </ol>
          </Card>
          <p className="text-sm"><Link href={`/app/${ctx.org.slug}/projects/${task.project_id}`} className="underline">Back to {task.project_name}</Link></p>
        </aside>
      </div>
    </AppShell>
  );
}
