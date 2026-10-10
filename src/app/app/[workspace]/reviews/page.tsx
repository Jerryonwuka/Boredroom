import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, SectionTitle } from "@/components/ui/card";
import { CountPill } from "@/components/ui/badge";
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
import { DueDate } from "@/components/app/due";
import { taskViewer } from "@/server/lib/task-viewer";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

type Tab = "all" | "submissions" | "corrections" | "overdue";

/**
 * Reviews, v4: the queue as tables under underline tabs (All, then one per kind, each with its count). A submission
 * opens in a sheet with the decision form; a time correction opens a sheet with its details and the decision. No daily
 * reports, no Missing reports and no day exemptions here any more (owner decision, 6 October 2026): staff no longer
 * write a daily report, and Brenda's end-of-day report tells team leads what their teams did. Leads keep deciding on
 * submitted work and time corrections (the two screen-video queues went in phase 8: owner decision, 8 October 2026).
 *
 * Accent rules (6 October 2026): for the team lead who decides, each kind's tab count is orange (attention); for everyone
 * else they are plain totals. The "All" sum and the section-title counts repeat those numbers, so they stay neutral (the
 * orange budget: four orange 3s on one screen read as busy). Overdue dates are a small red dot beside the date, never
 * red text.
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
  const total = q.submissions.length + q.adjustments.length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const clear = total === 0 && q.overdue.length === 0;
  const showOverdue = q.overdue.length > 0 || !isEmployee;
  const tabs: { value: Tab; label: string; count?: number; attention?: boolean; href: string }[] = [
    { value: "all", label: "All", count: total, href: `${base}/reviews` },
    { value: "submissions", label: "Submissions", count: q.submissions.length, attention: decides, href: `${base}/reviews?tab=submissions` },
    { value: "corrections", label: "Time corrections", count: q.adjustments.length, attention: decides, href: `${base}/reviews?tab=corrections` },
    ...(showOverdue ? [{ value: "overdue" as const, label: "Overdue", count: q.overdue.length, href: `${base}/reviews?tab=overdue` }] : []),
  ];
  const tab: Tab = tabs.some((t) => t.value === sp.tab) ? (sp.tab as Tab) : "all";
  const show = (t: Tab) => tab === "all" || tab === t;
  const nothing = (what: string) => <p className="rounded-2xl border border-border px-5 py-8 text-center text-sm font-normal text-secondary">{what}</p>;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Reviews"
        description={decides ? "Submitted work and time corrections waiting for a decision." : "Everything waiting for a decision across the organisation."}
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
                        <p className="text-meta text-secondary md:hidden">Due <DueDate iso={t.due_at} timeZone={tz} overdue srLabel={false} /></p>
                      </td>
                      <td className="hidden text-secondary md:table-cell"><DueDate iso={t.due_at} timeZone={tz} overdue /></td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
            </section>
          ) : null}
        </div>
      )}

      {/* Page notes (owner request, 7 October 2026): explanations at the bottom of the screen, small and grey. */}
      <PageNotes>
        {decides ? <PageNote>You never see your own submissions here.</PageNote> : null}
        {!decides && !clear ? <PageNote>Team leads give the decisions{total > 0 ? "; open one to see where it stands" : ""}.</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}

function QueueTitle({ id, title, count }: { id: string; title: string; count: number }) {
  return <SectionTitle id={id} title={<span className="flex items-center gap-2">{title}<CountPill count={count} /></span>} />;
}
