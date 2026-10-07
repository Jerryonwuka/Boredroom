"use client";

/**
 * The review queue's sheets (owner decision, 26 September 2026: a submission opens in a pop-up, not a page). v4: right-
 * hand sheets. `SubmissionButton` opens a task submission (the task, the revision's note, its links and files, the
 * decisions so far, and the decision form for whoever may give it; loaded on open from /api/orgs/:org/submissions/:id).
 * `DecisionSheetButton` opens anything else waiting for a decision (a time correction, a capture exception, a privacy
 * incident): the page renders the details and the DecisionForm, and the sheet closes itself once a decision is saved.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, label, taskStatusLabel } from "@/components/ui/badge";
import { Person } from "@/components/ui/person";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/states";
import { ReviewForm, DeliverableList } from "@/components/app/task-forms";
import { DecisionDone } from "@/components/app/small-actions";
import { api } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";

type Detail = {
  submission: { id: string; revision: number; note: string; submitted_at: string; submitted_by: string; submitted_by_name: string; task_id: string; title: string; expected_output: string; status: string; project_name: string; assignee_membership_id: string; assignee_name: string; reviewer_membership_id: string | null; reviewer_name: string | null; due_at: string | null };
  deliverables: { id: string; kind: string; url: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null; scan_status: string; notes: string | null }[];
  reviews: { id: string; decision: string; note: string; reviewed_at: string; reviewer_name: string }[];
  canReview: boolean; isLatest: boolean;
};

/** A submission's title as a button (a table cell): opens the submission's sheet. */
export function SubmissionButton({ orgSlug, submissionId, taskId, timezone, title, className }: { orgSlug: string; submissionId: string; /** Lets the sheet offer the task's page even when the submission fails to load. */ taskId?: string; timezone: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={cn("block max-w-full truncate text-left text-sm font-semibold text-foreground underline-offset-4 hover:underline", className)}>{title}</button>
      {open ? <SubmissionSheet orgSlug={orgSlug} submissionId={submissionId} taskId={taskId} title={title} timezone={timezone} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The v3 list row, kept for older callers: the whole row opens the submission's sheet. Put it in a <ul>. */
export function SubmissionRow({ orgSlug, submissionId, taskId, timezone, leading, title, meta, trailing, className }: { orgSlug: string; submissionId: string; taskId?: string; timezone: string; leading?: React.ReactNode; title: string; meta?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-none">
      <div className={cn("relative flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-75 hover:bg-fill-1", className)}>
        {leading ? <div className="relative z-[1] shrink-0">{leading}</div> : null}
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {meta ? <p className="truncate text-meta font-normal text-secondary">{meta}</p> : null}
        </button>
        {trailing ? <div className="shrink-0 text-right text-meta font-normal tabular-nums text-secondary">{trailing}</div> : null}
      </div>
      {open ? <SubmissionSheet orgSlug={orgSlug} submissionId={submissionId} taskId={taskId} title={title} timezone={timezone} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

function SubmissionSheet({ orgSlug, submissionId, taskId, title, timezone, onClose }: { orgSlug: string; submissionId: string; taskId?: string; title: string; timezone: string; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    api<Detail>(`/api/orgs/${orgSlug}/submissions/${submissionId}`).then((r) => { if (alive) setD(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [orgSlug, submissionId]);
  const s = d?.submission;
  const taskHref = s ? `/app/${orgSlug}/tasks/${s.task_id}` : taskId ? `/app/${orgSlug}/tasks/${taskId}` : null;
  return (
    <Sheet open onClose={onClose} size="lg" title={s?.title ?? title} description={s ? `${s.project_name}, revision ${s.revision}` : "Submission"}
      footer={taskHref ? <Link href={taskHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open the full task<AnimatedArrowUpRight aria-hidden /></Link> : undefined}>
      {!d ? (failed
        ? <p role="alert" className="text-sm font-normal text-danger">Could not load the submission. Open the full task instead.</p>
        : <div role="status" aria-label="Loading the submission" className="grid gap-3"><Skeleton className="h-8 w-56" /><Skeleton className="h-3.5 w-11/12" /><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-2/3" /></div>) : (
        <div className="grid gap-6">
          <p className="flex flex-wrap items-center gap-2"><Badge tone={TASK_STATUS_TONE[s!.status]}>{taskStatusLabel(s!.status)}</Badge>{!d.isLatest ? <Badge tone="warning">An older revision</Badge> : null}</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Person orgSlug={orgSlug} membershipId={s!.submitted_by} name={s!.submitted_by_name} size={32} meta={`Submitted ${formatDateTime(s!.submitted_at, timezone)}`} />
            {s!.reviewer_membership_id && s!.reviewer_name ? <Person orgSlug={orgSlug} membershipId={s!.reviewer_membership_id} name={s!.reviewer_name} size={32} meta="Checks it" /> : null}
          </div>
          <section aria-label="What was asked for">
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">What was asked for</h3>
            <p className="whitespace-pre-wrap text-sm font-normal text-secondary">{s!.expected_output}</p>
          </section>
          <section aria-label="What they say was delivered">
            <h3 className="mb-1.5 text-sm font-semibold text-foreground">What they say was delivered</h3>
            <p className="whitespace-pre-wrap text-sm font-normal text-foreground">{s!.note || <span className="text-secondary">No note with this revision.</span>}</p>
            <DeliverableList orgSlug={orgSlug} items={d.deliverables} />
          </section>
          {d.reviews.length ? (
            <section aria-label="Decisions so far">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Decisions so far</h3>
              <ul className="space-y-3">{d.reviews.map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="flex flex-wrap items-center gap-2"><Badge tone={r.decision === "approved" ? "success" : r.decision === "changes_requested" ? "warning" : "info"}>{label(r.decision)}</Badge><span className="text-meta font-normal text-secondary">{r.reviewer_name}, <span className="tabular-nums">{formatDateTime(r.reviewed_at, timezone)}</span></span></p>
                  {r.note ? <p className="mt-1.5 whitespace-pre-wrap font-normal text-foreground">{r.note}</p> : null}
                </li>
              ))}</ul>
            </section>
          ) : null}
          {d.canReview ? <ReviewForm bare orgSlug={orgSlug} submissionId={s!.id} revision={s!.revision} onDone={() => { onClose(); router.refresh(); }} />
            : <p className="text-meta font-normal text-secondary">{s!.status !== "in_review" ? "This task is no longer waiting for a check." : "Waiting for the team lead's decision."}</p>}
        </div>
      )}
    </Sheet>
  );
}

/**
 * A button that opens a right-hand sheet of details and, for whoever decides, a DecisionForm (rendered by the page).
 * The form closes the sheet once its decision is saved (through the DecisionDone context).
 */
export function DecisionSheetButton({ title, description, children, label: text = "Review", variant = "secondary", "aria-label": ariaLabel }: { title: string; description?: React.ReactNode; children: React.ReactNode; label?: string; variant?: ButtonProps["variant"]; "aria-label"?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant={variant} aria-haspopup="dialog" aria-label={ariaLabel} onClick={() => setOpen(true)}>{text}</Button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={title} description={description}>
          <DecisionDone.Provider value={() => setOpen(false)}>{children}</DecisionDone.Provider>
        </Sheet>
      ) : null}
    </>
  );
}
