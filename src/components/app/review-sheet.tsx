"use client";

/**
 * A task submission in a pop-up (owner decision, 26 September 2026): opened from the Reviews list instead of a
 * page. Shows the task, the revision's note, its links and files, the decisions so far, and the decision form for
 * whoever may give it. Loads on open from /api/orgs/:org/submissions/:id.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { Person } from "@/components/ui/person";
import { ReviewForm, DeliverableList } from "@/components/app/task-forms";
import { api } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/utils";

type Detail = {
  submission: { id: string; revision: number; note: string; submitted_at: string; submitted_by: string; submitted_by_name: string; task_id: string; title: string; expected_output: string; status: string; project_name: string; assignee_membership_id: string; assignee_name: string; reviewer_membership_id: string | null; reviewer_name: string | null; due_at: string | null };
  deliverables: { id: string; kind: string; url: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null; scan_status: string; notes: string | null }[];
  reviews: { id: string; decision: string; note: string; reviewed_at: string; reviewer_name: string }[];
  canReview: boolean; isLatest: boolean;
};

export function SubmissionRow({ orgSlug, submissionId, timezone, leading, title, meta, trailing, className }: { orgSlug: string; submissionId: string; timezone: string; leading?: React.ReactNode; title: string; meta?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className={cn("relative -mx-2 flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 transition-colors duration-[var(--duration-fast)] hover:bg-wash", className)}>
        {leading ? <div className="relative z-[1] shrink-0">{leading}</div> : null}
        <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:content-['']" aria-haspopup="dialog">
          <p className="truncate text-sm font-medium text-fg">{title}</p>
          {meta ? <p className="truncate text-xs text-fg-subtle">{meta}</p> : null}
        </button>
        {trailing ? <div className="shrink-0 text-right text-xs text-fg-muted tabular-nums">{trailing}</div> : null}
      </div>
      {open ? <SubmissionSheet orgSlug={orgSlug} submissionId={submissionId} title={title} timezone={timezone} onClose={() => setOpen(false)} /> : null}
    </li>
  );
}

function SubmissionSheet({ orgSlug, submissionId, title, timezone, onClose }: { orgSlug: string; submissionId: string; title: string; timezone: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let alive = true;
    api<Detail>(`/api/orgs/${orgSlug}/submissions/${submissionId}`).then((r) => { if (alive) setD(r); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [orgSlug, submissionId]);
  const s = d?.submission;
  return (
    <dialog ref={ref} className="sheet !max-w-[min(92vw,40rem)]" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="grid gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{s ? `${s.project_name} · revision ${s.revision}` : "Submission"}</p>
            <h2 id={titleId} className="mt-1 font-display text-xl leading-tight">{s?.title ?? title}</h2>
            {s ? <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={TASK_STATUS_TONE[s.status]}>{s.status === "in_review" ? "Sent for check" : label(s.status)}</Badge>{!d?.isLatest ? <Badge tone="warning">An older revision</Badge> : null}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="size-4" aria-hidden /></Button>
        </div>
        {!d ? <p className={cn("text-sm", failed ? "text-danger" : "text-fg-subtle")}>{failed ? "Could not load the submission. Open the full task instead." : "Loading…"}</p> : (
          <>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Person orgSlug={orgSlug} membershipId={s!.submitted_by} name={s!.submitted_by_name} size={32} meta={`Submitted ${formatDateTime(s!.submitted_at, timezone)}`} />
              {s!.reviewer_membership_id && s!.reviewer_name ? <Person orgSlug={orgSlug} membershipId={s!.reviewer_membership_id} name={s!.reviewer_name} size={32} meta="Checks it" /> : null}
            </div>
            <div>
              <p className="eyebrow mb-1">What was asked for</p>
              <p className="whitespace-pre-wrap text-sm text-fg-muted">{s!.expected_output}</p>
            </div>
            <div>
              <p className="eyebrow mb-1">What they say was delivered</p>
              <p className="whitespace-pre-wrap text-sm">{s!.note || <span className="text-fg-subtle">No note with this revision.</span>}</p>
              <DeliverableList orgSlug={orgSlug} items={d.deliverables} />
            </div>
            {d.reviews.length ? (
              <div>
                <p className="eyebrow mb-1">Decisions so far</p>
                <ul className="space-y-2">{d.reviews.map((r) => <li key={r.id} className="chip px-3 py-2 text-sm"><Badge tone={r.decision === "approved" ? "success" : r.decision === "changes_requested" ? "warning" : "info"}>{label(r.decision)}</Badge> <span className="text-fg-subtle">{r.reviewer_name}, {formatDateTime(r.reviewed_at, timezone)}</span>{r.note ? <p className="mt-1 whitespace-pre-wrap text-fg-muted">{r.note}</p> : null}</li>)}</ul>
              </div>
            ) : null}
            {d.canReview ? <ReviewForm orgSlug={orgSlug} submissionId={s!.id} revision={s!.revision} onDone={() => { onClose(); router.refresh(); }} /> : <p className="text-xs text-fg-subtle">{s!.status !== "in_review" ? "This task is no longer waiting for a check." : "Waiting for the team lead's decision."}</p>}
            <div className="flex justify-end border-t border-border-soft pt-3"><Link href={`/app/${orgSlug}/tasks/${s!.task_id}`} className="link-action"><ExternalLink className="size-3.5" aria-hidden />Open the full task</Link></div>
          </>
        )}
      </div>
    </dialog>
  );
}
