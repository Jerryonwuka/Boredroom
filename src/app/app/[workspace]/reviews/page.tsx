import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { Badge, CountPill, label } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Person } from "@/components/ui/person";
import { reviewQueue } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { DecisionForm } from "@/components/app/small-actions";
import { SubmissionButton, DecisionSheetButton } from "@/components/app/review-sheet";
import { TaskPeekLink } from "@/components/app/tasks-page";
import { taskViewer } from "@/server/lib/task-viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

type Tab = "all" | "submissions" | "corrections" | "exceptions" | "incidents" | "overdue";

/**
 * Reviews, v4: the queue as tables under underline tabs (All, then one per kind, each with its count). A submission
 * opens in a sheet with the decision form; a time correction, a capture exception or a privacy incident opens a sheet
 * with its details and the decision. No daily reports, no Missing reports and no day exemptions here any more (owner
 * decision, 6 October 2026): staff no longer write a daily report, and Brenda's end-of-day report tells team leads what
 * their teams did. Leads keep deciding on submitted work, time corrections and capture exceptions.
 */
export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/reviews`);
  const isEmployee = ctx.membership.role === "employee";
  const q = await reviewQueue(ctx);
  const tz = ctx.org.timezone;
  const base = `/app/${ctx.org.slug}`;
  const viewer = taskViewer(ctx);
  // Organisation accounts see the whole queue; team leads give the decisions.
  const decides = ctx.membership.role === "manager";
  const total = q.submissions.length + q.adjustments.length + q.exceptions.length + q.incidents.length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const clear = total === 0 && q.overdue.length === 0;
  const showOverdue = q.overdue.length > 0 || !isEmployee;
  const tabs: { value: Tab; label: string; count?: number; href: string }[] = [
    { value: "all", label: "All", count: total, href: `${base}/reviews` },
    { value: "submissions", label: "Submissions", count: q.submissions.length, href: `${base}/reviews?tab=submissions` },
    { value: "corrections", label: "Time corrections", count: q.adjustments.length, href: `${base}/reviews?tab=corrections` },
    { value: "exceptions", label: "Capture exceptions", count: q.exceptions.length, href: `${base}/reviews?tab=exceptions` },
    ...(q.incidents.length ? [{ value: "incidents" as const, label: "Privacy incidents", count: q.incidents.length, href: `${base}/reviews?tab=incidents` }] : []),
    ...(showOverdue ? [{ value: "overdue" as const, label: "Overdue", count: q.overdue.length, href: `${base}/reviews?tab=overdue` }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.value === sp.tab) ? (sp.tab as Tab) : "all";
  const show = (t: Tab) => tab === "all" || tab === t;
  const nothing = (what: string) => <p className="rounded-2xl border border-border px-5 py-8 text-center text-sm font-normal text-secondary">{what}</p>;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Reviews"
        description={decides ? "Submitted work, time corrections, capture exceptions and privacy incidents waiting for a decision. You never see your own submissions here." : "Everything waiting for a decision across the organisation. Team leads give the decisions; you can see where each one stands."}
        tabs={clear ? undefined : tabs} tabValue={tab} tabParam="tab" tabsLabel="Review queue" divider={clear} />
      {clear ? (
        <EmptyState icon={ShieldCheck} title="Queue is clear"
          description={decides ? "Nothing is waiting for your decision. Submitted work and time corrections from your team land here." : isEmployee ? "Nothing of yours is waiting on a decision. Your submitted work is checked by your team lead." : "Nothing is waiting for a decision anywhere in the organisation."}
          action={<Link href={`${base}/tasks`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open Tasks</Link>} />
      ) : (
        <div className="space-y-12">
          {show("submissions") && (tab !== "all" || q.submissions.length) ? (
            <section aria-labelledby="q-submissions">
              {tab === "all" ? <QueueTitle id="q-submissions" title="Task submissions" count={q.submissions.length} /> : <h2 id="q-submissions" className="sr-only">Task submissions</h2>}
              {q.submissions.length === 0 ? nothing("No submitted work is waiting for a check.") : (
                <DataTable caption="Task submissions waiting for a check" fit>
                  <thead><tr><th className="w-[30%]">Person</th><th>Task</th><th className="hidden w-[180px] md:table-cell">Submitted</th></tr></thead>
                  <tbody>{q.submissions.map((s) => (
                    <tr key={s.submission_id}>
                      <td><span className="flex min-w-0 items-center gap-2.5"><Person orgSlug={ctx.org.slug} membershipId={s.assignee_membership_id} name={s.assignee_name} showName={false} size={28} /><span className="truncate font-medium">{s.assignee_name}</span></span></td>
                      <td>
                        <SubmissionButton orgSlug={ctx.org.slug} submissionId={s.submission_id} taskId={s.task_id} timezone={tz} title={s.title} />
                        <p className="truncate text-meta text-secondary">Revision {s.revision}{s.reviewer_is_me ? "" : ", as their team lead"}{s.note ? `: ${s.note}` : ""}</p>
                        <p className="text-meta tabular-nums text-secondary md:hidden">{formatDateTime(s.submitted_at, tz)}</p>
                      </td>
                      <td className="hidden tabular-nums text-secondary md:table-cell">{formatDateTime(s.submitted_at, tz)}</td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
            </section>
          ) : null}

          {show("corrections") && (tab !== "all" || q.adjustments.length) ? (
            <section aria-labelledby="q-corrections">
              {tab === "all" ? <QueueTitle id="q-corrections" title="Time corrections" count={q.adjustments.length} /> : <h2 id="q-corrections" className="sr-only">Time corrections</h2>}
              {q.adjustments.length === 0 ? nothing("No time corrections are waiting.") : (
                <DataTable caption="Time corrections waiting for a decision" fit>
                  <thead><tr><th className="w-[30%]">Person</th><th>Correction</th><th className="hidden w-[180px] md:table-cell">Requested</th><th className="w-[96px] text-right"><span className="sr-only">Decision</span></th></tr></thead>
                  <tbody>{q.adjustments.map((a) => (
                    <tr key={a.id}>
                      <td><span className="flex min-w-0 items-center gap-2.5"><Avatar profileId={a.id} name={a.display_name} size={28} /><span className="truncate font-medium">{a.display_name}</span></span></td>
                      <td><p className="truncate font-medium">{a.task_title}</p><p className="truncate text-meta text-secondary">{a.reason}</p></td>
                      <td className="hidden tabular-nums text-secondary md:table-cell">{formatDateTime(a.created_at, tz)}</td>
                      <td className="text-right">
                        <DecisionSheetButton label={decides ? "Review" : "View"} aria-label={`${decides ? "Review" : "View"} the time correction from ${a.display_name}`} title="Time correction" description={`${a.display_name}, ${a.task_title}`}>
                          <div className="grid gap-5">
                            <section aria-label="Why">
                              <h3 className="mb-1.5 text-sm font-semibold text-foreground">Why</h3>
                              <p className="whitespace-pre-wrap text-sm font-normal text-foreground">{a.reason}</p>
                              {a.evidence_note ? <p className="mt-2 whitespace-pre-wrap text-sm font-normal text-secondary">Evidence: {a.evidence_note}</p> : null}
                            </section>
                            <section aria-label="The change">
                              <h3 className="mb-1.5 text-sm font-semibold text-foreground">Replaces {plural(a.original_count, "interval")} with</h3>
                              <ul className="space-y-1">{a.proposed_intervals.map((p, i) => <li key={i} className="flex min-h-9 items-center rounded-lg bg-fill-0 px-3 text-sm tabular-nums">{formatDateTime(p.startedAt, tz)} to {formatDateTime(p.endedAt, tz)}</li>)}</ul>
                            </section>
                            <p className="text-meta font-normal text-secondary">Requested {formatDateTime(a.created_at, tz)}</p>
                            {decides ? <DecisionForm path={`/api/orgs/${ctx.org.slug}/time-adjustments/${a.id}/review`} options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject", needsNote: true }]} /> : <p className="text-sm font-normal text-secondary">Waiting for the team lead&apos;s decision.</p>}
                          </div>
                        </DecisionSheetButton>
                      </td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
            </section>
          ) : null}

          {show("exceptions") && (tab !== "all" || q.exceptions.length) ? (
            <section aria-labelledby="q-exceptions">
              {tab === "all" ? <QueueTitle id="q-exceptions" title="Capture exceptions" count={q.exceptions.length} /> : <h2 id="q-exceptions" className="sr-only">Capture exceptions</h2>}
              {q.exceptions.length === 0 ? nothing("No capture exceptions are waiting.") : (
                <DataTable caption="Capture exceptions waiting for a decision" fit>
                  <thead><tr><th className="w-[30%]">Person</th><th>Exception</th><th className="hidden w-[180px] md:table-cell">Requested</th><th className="w-[96px] text-right"><span className="sr-only">Decision</span></th></tr></thead>
                  <tbody>{q.exceptions.map((c) => (
                    <tr key={c.id}>
                      <td><span className="flex min-w-0 items-center gap-2.5"><Avatar profileId={c.id} name={c.display_name} size={28} /><span className="truncate font-medium">{c.display_name}</span></span></td>
                      <td><p className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{c.task_title ?? "No task"}</span><Badge tone="warning">{label(c.reason_code)}</Badge></p><p className="truncate text-meta text-secondary">{c.reason}</p></td>
                      <td className="hidden tabular-nums text-secondary md:table-cell">{formatDateTime(c.created_at, tz)}</td>
                      <td className="text-right">
                        <DecisionSheetButton label={decides ? "Review" : "View"} aria-label={`${decides ? "Review" : "View"} the capture exception from ${c.display_name}`} title="Capture exception" description={`${c.display_name}${c.task_title ? `, ${c.task_title}` : ""}`}>
                          <div className="grid gap-5">
                            <p><Badge tone="warning">{label(c.reason_code)}</Badge></p>
                            <section aria-label="Why">
                              <h3 className="mb-1.5 text-sm font-semibold text-foreground">Why</h3>
                              <p className="whitespace-pre-wrap text-sm font-normal text-foreground">{c.reason}</p>
                            </section>
                            <p className="text-meta font-normal text-secondary">Requested {formatDateTime(c.created_at, tz)}</p>
                            {decides ? <DecisionForm path={`/api/orgs/${ctx.org.slug}/capture-exceptions/${c.id}/review`} options={[{ value: "accepted", label: "Accept" }, { value: "rejected", label: "Reject" }]} /> : <p className="text-sm font-normal text-secondary">Waiting for the team lead&apos;s decision.</p>}
                          </div>
                        </DecisionSheetButton>
                      </td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
            </section>
          ) : null}

          {show("incidents") && q.incidents.length ? (
            <section aria-labelledby="q-incidents">
              {tab === "all" ? <QueueTitle id="q-incidents" title="Privacy incidents" count={q.incidents.length} /> : <h2 id="q-incidents" className="sr-only">Privacy incidents</h2>}
              <DataTable caption="Privacy incidents on restricted footage" fit>
                <thead><tr><th className="w-[30%]">Flagged by</th><th>Reason</th><th className="hidden w-[180px] md:table-cell">Restricted</th><th className="w-[96px] text-right"><span className="sr-only">Decision</span></th></tr></thead>
                <tbody>{q.incidents.map((i) => (
                  <tr key={i.id}>
                    <td><span className="flex min-w-0 items-center gap-2.5"><Avatar profileId={i.id} name={i.reporter_name} size={28} /><span className="truncate font-medium">{i.reporter_name}</span></span></td>
                    <td><p className="truncate">{i.reason}</p><p className="truncate text-meta text-danger">Restricted footage</p></td>
                    <td className="hidden tabular-nums text-secondary md:table-cell">{formatDateTime(i.restricted_at, tz)}</td>
                    <td className="text-right">
                      <DecisionSheetButton label="Decide" aria-label={`Decide on the incident flagged by ${i.reporter_name}`} title="Privacy incident" description={`Flagged by ${i.reporter_name}, ${formatDateTime(i.restricted_at, tz)}`}>
                        <div className="grid gap-5">
                          <section aria-label="Why it was flagged">
                            <h3 className="mb-1.5 text-sm font-semibold text-foreground">Why it was flagged</h3>
                            <p className="whitespace-pre-wrap text-sm font-normal text-foreground">{i.reason}</p>
                          </section>
                          <p className="text-meta font-normal text-secondary">Ordinary playback is denied while open. Deletion removes chunks and derivatives and is logged.</p>
                          <DecisionForm path={`/api/orgs/${ctx.org.slug}/incidents/${i.id}/resolve`} options={[{ value: "released", label: "Release for normal access" }, { value: "deleted", label: "Delete recording", danger: true }]} noteLabel="Decision note" noteRequired />
                        </div>
                      </DecisionSheetButton>
                    </td>
                  </tr>
                ))}</tbody>
              </DataTable>
            </section>
          ) : null}

          {show("overdue") && showOverdue ? (
            <section aria-labelledby="q-overdue">
              {tab === "all" ? <QueueTitle id="q-overdue" title="Overdue commitments" count={q.overdue.length} /> : <h2 id="q-overdue" className="sr-only">Overdue commitments</h2>}
              {q.overdue.length === 0 ? nothing("No overdue commitments.") : (
                <DataTable caption="Overdue commitments" fit>
                  <thead><tr><th className="w-[30%]">Person</th><th>Task</th><th className="hidden w-[180px] md:table-cell">Due</th></tr></thead>
                  <tbody>{q.overdue.map((t) => (
                    <tr key={t.id}>
                      <td><span className="flex min-w-0 items-center gap-2.5"><Person orgSlug={ctx.org.slug} membershipId={t.assignee_membership_id} name={t.assignee_name} profileId={t.assignee_profile_id} avatarKey={t.assignee_avatar_key} showName={false} size={28} /><span className="truncate font-medium">{t.assignee_name}</span></span></td>
                      <td>
                        <TaskPeekLink orgSlug={ctx.org.slug} viewer={viewer} task={{ id: t.id, title: t.title, status: t.status, due_at: t.due_at, assignee_membership_id: t.assignee_membership_id, assignee_name: t.assignee_name, overdue: true }} className="block max-w-full truncate text-sm" />
                        <p className="text-meta tabular-nums text-danger md:hidden">Due {formatDateTime(t.due_at, tz)}</p>
                      </td>
                      <td className="hidden tabular-nums text-danger md:table-cell">{formatDateTime(t.due_at, tz)}</td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
            </section>
          ) : null}

          {!decides && total > 0 ? <p className="text-meta font-normal text-secondary">Team leads give the decisions; open one to see where it stands.</p> : null}
        </div>
      )}
    </AppShell>
  );
}

function QueueTitle({ id, title, count }: { id: string; title: string; count: number }) {
  return <SectionTitle id={id} title={<span className="flex items-center gap-2">{title}<CountPill count={count} /></span>} />;
}
