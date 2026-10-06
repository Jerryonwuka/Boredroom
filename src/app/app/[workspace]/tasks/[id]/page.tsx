import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card, SectionTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, SESSION_STATE_TONE, label, taskStatusLabel } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { Alert } from "@/components/ui/states";
import { Person } from "@/components/ui/person";
import { taskDetail } from "@/server/services/views";
import { listSessionRecordings } from "@/server/services/recording";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { TaskActions, SubmissionForm, ReviewForm, DeliverableList, ReopenForm } from "@/components/app/task-forms";
import { TaskPanels } from "@/components/app/task-panels";
import { SessionRecordings } from "@/components/app/recording-panel";
import { DetailList, DetailRow } from "@/components/app/detail-list";
import { DueDate } from "@/components/app/due";
import { ProgressBar } from "@/components/ui/progress-arc";

export const dynamic = "force-dynamic";

/** A malformed id in the address is a missing page, not a database error. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** One read per request for the tab's title and the page (React's cache; orgContext is cached the same way). */
const loadTask = cache(async (slug: string, id: string) => (isId(id) ? taskDetail(await orgContext(slug), id) : null));

export async function generateMetadata({ params }: { params: Promise<{ workspace: string; id: string }> }): Promise<Metadata> {
  const { workspace, id } = await params;
  try {
    return { title: (await loadTask(workspace, id))?.task.title ?? "Task" };
  } catch {
    return { title: "Task" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

const statusLabel = taskStatusLabel;

/**
 * The full task, v4: two columns on a wide screen, the work on the left (what a finished result looks like, the
 * submission and review forms, the evidence, the work sessions) and a details panel on the right (time tracked against
 * the estimate, then label and value rows). Its discussion and status history open as sheets from two buttons in the
 * header (owner decision, 5 October 2026), and `?panel=comments` or `?panel=history` opens one on arrival.
 * Accent rules (6 October 2026): the time against the estimate is an orange progress bar, a running session is live
 * (orange), an overdue date is a red dot beside the "Overdue" label, and links in running text underline in orange.
 */
export default async function TaskPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ submit?: string; panel?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/tasks/${id}`);
  const data = await loadTask(workspace, id);
  if (!data) notFound();
  const { task, sessions, submissions, deliverables, reviews, comments, history, members, canManage } = data;
  const tz = ctx.org.timezone;
  const isAssignee = task.assignee_membership_id === ctx.membership.id;
  const isReviewer = task.reviewer_membership_id === ctx.membership.id;
  const latest = submissions[0];
  const latestDecided = latest ? reviews.some((r) => r.submission_id === latest.id && r.decision !== "question") : false;
  // Organisation accounts see the review; the team lead gives the decision.
  const isOrgAccount = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  const canReview = task.status === "in_review" && latest && !latestDecided && !isAssignee && (isReviewer || canManage) && !isOrgAccount;
  const recordingsBySession = Object.fromEntries(await Promise.all(sessions.slice(0, 10).map(async (s) => [s.id, await listSessionRecordings(ctx, s.id)] as const)));
  const base = `/app/${ctx.org.slug}`;
  const first = (name: string | null | undefined) => name?.split(" ")[0];
  // Who a new comment notifies: the assignee and the reviewer, never the person writing it (services/tasks.ts addComment).
  const notify = [...new Set([[task.assignee_membership_id, task.assignee_name], [task.reviewer_membership_id, task.reviewer_name]]
    .filter(([id, name]) => id && name && id !== ctx.membership.id).map(([, name]) => first(name)!))];
  const estimate = task.estimate_minutes ? task.estimate_minutes * 60 : 0;
  const share = estimate ? Math.min(1, task.tracked_seconds / estimate) : 0;
  const overdue = !!task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed";
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      {/* "Back" goes to wherever the task was opened from (BackLink follows history); with no history, to Tasks. */}
      <PageHeader back={{ href: `${base}/tasks`, label: "Back" }} title={task.title}
        description={<span className="flex flex-wrap items-center gap-2">
          <Badge tone={TASK_STATUS_TONE[task.status]}>{statusLabel(task.status)}</Badge>
          {task.priority !== "normal" ? <Badge tone={task.priority === "urgent" ? "danger" : task.priority === "high" ? "warning" : "neutral"}>{label(task.priority)} priority</Badge> : null}
          {overdue ? <Badge tone="danger">Overdue</Badge> : null}
          {task.capture_requirement !== "none" ? <Badge tone="warning">Screen capture {task.capture_requirement}</Badge> : null}
          {task.archived_at ? <Badge tone="danger">Deleted</Badge> : null}
        </span>}
        actions={<>
          <TaskPanels key={task.id} orgSlug={ctx.org.slug} taskId={task.id} taskTitle={task.title} comments={comments} history={history} timezone={tz} notify={notify} initialPanel={sp.panel} />
          {!isAssignee ? <Link href={`${base}/messages?to=${task.assignee_membership_id}&task=${task.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Ask {first(task.assignee_name)} for an update</Link>
            : task.reviewer_membership_id ? <Link href={`${base}/messages?to=${task.reviewer_membership_id}&task=${task.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Message {first(task.reviewer_name) ?? "your reviewer"}</Link> : null}
          <TaskActions orgSlug={ctx.org.slug} task={{ id: task.id, version: task.version, status: task.status, archived: !!task.archived_at, blockedReason: task.blocked_reason }} isAssignee={isAssignee} canManage={canManage} members={members}
            current={{ reviewerId: task.reviewer_membership_id, assigneeId: task.assignee_membership_id, estimateMinutes: task.estimate_minutes, dueAt: task.due_at, priority: task.priority, captureRequirement: task.capture_requirement }} />
        </>} />

      <div className="grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* The details panel: first in the reading order (it says who holds the task and when it is due), drawn on the right from lg. */}
        <aside aria-labelledby="details-heading" className="lg:order-last">
          <Card>
            <h2 id="details-heading" className="sr-only">Details</h2>
            <p className="text-sm font-medium text-secondary">Tracked, confirmed</p>
            <p className="type-stat mt-1">{formatDuration(task.tracked_seconds)}</p>
            <p className="mt-1 text-meta font-normal text-secondary">{estimate ? `of ${formatDuration(estimate)} estimated` : "No estimate set"}</p>
            {estimate ? (
              // Passing the estimate is not a success, so a full bar stays orange.
              <ProgressBar className="mt-3" size="sm" value={task.tracked_seconds} max={estimate} doneTone="accent" label="Time tracked against the estimate" valueText={`${Math.round(share * 100)}% of the estimate tracked`} />
            ) : null}
            <DetailList className="mt-5">
              <DetailRow label="Held by"><Person orgSlug={ctx.org.slug} membershipId={task.assignee_membership_id} name={task.assignee_name} size={20} you={isAssignee} /></DetailRow>
              <DetailRow label="Checked by">{task.reviewer_membership_id && task.reviewer_name ? <Person orgSlug={ctx.org.slug} membershipId={task.reviewer_membership_id} name={task.reviewer_name} size={20} you={isReviewer} /> : <span className="text-secondary">Nobody yet</span>}</DetailRow>
              <DetailRow label="Created by">{task.created_by_name}</DetailRow>
              <DetailRow label="Project"><Link href={`${base}/projects/${task.project_id}`} className="link-inline">{task.project_name}</Link></DetailRow>
              <DetailRow label={overdue ? "Overdue" : "Due"}>{task.due_at ? <DueDate iso={task.due_at} timeZone={tz} overdue={overdue} srLabel={false} /> : <span className="text-secondary">No date</span>}</DetailRow>
              <DetailRow label="Completed">{task.completed_at ? <span className="tabular-nums">{formatDateTime(task.completed_at, tz)}</span> : <span className="text-secondary">Not yet</span>}</DetailRow>
              <DetailRow label="Priority">{label(task.priority)}</DetailRow>
              <DetailRow label="Category">{label(task.category)}</DetailRow>
              <DetailRow label="Screen capture">{task.capture_requirement === "none" ? <span className="text-secondary">Not requested</span> : label(task.capture_requirement)}</DetailRow>
            </DetailList>
          </Card>
        </aside>

        <div className="min-w-0 space-y-10">
          <section aria-labelledby="output-heading">
            <SectionTitle id="output-heading" title="Expected output" />
            <p className="max-w-3xl whitespace-pre-wrap text-pretty text-sm font-normal text-secondary">{task.expected_output}</p>
            {task.blocked_reason ? <Alert tone="danger" title="Blocked" className="mt-4">{task.blocked_reason}</Alert> : null}
          </section>

          {isAssignee && !task.archived_at && ["todo", "in_progress", "blocked"].includes(task.status) ? (
            <SubmissionForm orgSlug={ctx.org.slug} taskId={task.id} hasReviewer={!!task.reviewer_membership_id} autoOpen={!!sp.submit} nextRevision={(latest?.revision ?? 0) + 1} />
          ) : null}
          {canReview ? <ReviewForm orgSlug={ctx.org.slug} submissionId={latest.id} revision={latest.revision} /> : null}
          {task.status === "completed" && (isReviewer || canManage) ? <ReopenForm orgSlug={ctx.org.slug} taskId={task.id} version={task.version} /> : null}

          <section aria-labelledby="evidence-heading">
            <SectionTitle id="evidence-heading" title="Evidence and review history" />
            {submissions.length === 0 ? (
              <p className="rounded-2xl border border-border px-5 py-8 text-center text-sm font-normal text-secondary">{isAssignee && !task.archived_at ? "Nothing submitted yet. When the work is ready, press Submit for review above." : `Nothing submitted yet. Revisions appear here when ${isAssignee ? "you send" : `${first(task.assignee_name)} sends`} the work for review.`}</p>
            ) : (
              <div className="space-y-3">
                {submissions.map((s) => (
                  <Card key={s.id}>
                    <article>
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-foreground">Revision {s.revision}</h3><span className="text-meta font-normal text-secondary">{s.submitted_by_name}, <span className="tabular-nums">{formatDateTime(s.submitted_at, tz)}</span></span></div>
                      {s.note ? <p className="mt-2 whitespace-pre-wrap text-sm font-normal text-secondary">{s.note}</p> : null}
                      <DeliverableList orgSlug={ctx.org.slug} items={deliverables.filter((d) => d.submission_id === s.id)} />
                      {reviews.some((r) => r.submission_id === s.id) ? (
                        <ul className="mt-4 space-y-3">
                          {reviews.filter((r) => r.submission_id === s.id).map((r) => (
                            <li key={r.id} className="text-sm">
                              <p className="flex flex-wrap items-center gap-2"><Badge tone={r.decision === "approved" ? "success" : r.decision === "changes_requested" ? "warning" : "info"}>{label(r.decision)}</Badge><span className="text-meta font-normal text-secondary">{r.reviewer_name}, <span className="tabular-nums">{formatDateTime(r.reviewed_at, tz)}</span></span></p>
                              {r.note ? <p className="mt-1.5 whitespace-pre-wrap font-normal text-foreground">{r.note}</p> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="sessions-heading">
            <SectionTitle id="sessions-heading" title="Work sessions" />
            {sessions.length === 0 ? <p className="rounded-2xl border border-border px-5 py-8 text-center text-sm font-normal text-secondary">{isAssignee && !isOrgAccount && !task.archived_at && ["todo", "in_progress", "blocked"].includes(task.status) ? <>No work sessions yet. Start this task from <Link href={`${base}/my-day`} className="link-inline">My Day</Link> and the clock runs on it.</> : "No work sessions yet."}</p> : (
              <DataTable caption="Sessions on this task">
                <thead><tr><th>Started</th><th>Ended</th><th>State</th><th className="text-right">Confirmed</th><th className="text-right">Uncertain</th><th>Outcome</th></tr></thead>
                <tbody>{sessions.map((s) => (
                  <tr key={s.id}>
                    <td><span className="tabular-nums">{formatDateTime(s.started_at, tz)}</span><p className="text-meta text-secondary">{s.member_name}</p></td>
                    <td className="tabular-nums">{s.ended_at ? formatDateTime(s.ended_at, tz) : <span className="text-subtle">Open</span>}</td>
                    <td>{s.state === "running" ? <Badge tone="accent" dot>Running</Badge> : <Badge tone={SESSION_STATE_TONE[s.state]}>{label(s.state)}</Badge>}</td>
                    <td className="text-right tabular-nums">{formatDuration(s.confirmed_seconds)}</td>
                    <td className="text-right tabular-nums">{s.uncertain_seconds ? <span className="text-warning">{formatDuration(s.uncertain_seconds)}</span> : <span className="text-subtle">None</span>}</td>
                    <td className="wrap">{s.stop_outcome ? label(s.stop_outcome) : <span className="text-subtle">Not stopped</span>}{recordingsBySession[s.id]?.length ? <SessionRecordings orgSlug={ctx.org.slug} recordings={recordingsBySession[s.id]} own={isAssignee} timeZone={ctx.org.timezone} /> : null}</td>
                  </tr>
                ))}</tbody>
              </DataTable>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
