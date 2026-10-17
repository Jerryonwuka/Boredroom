"use client";

/**
 * The person's own Jobs list (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026: "a notch card with
 * progress and Stop, then a result card with Open / Show in Finder / Undo; a private Jobs list on the web (only the
 * person)"; contract N.1, S.9).
 *
 * One calm row per background job from the last 30 days, newest first, hairlines between them: the helper's icon (Files
 * helper, Mac operator), the title in medium, then a meta line in commas with the status word and when ("Running, 23 of
 * 64", "Paused while your Mac sleeps", "Done, today at 14:05", "Couldn't finish, 8 October", "Undone, today at 14:20"). A
 * running job shows the orange progress bar and the live dot; an ended one its summary and the new files' names; "You
 * asked: “…”" while the request is kept; "Undo is on the Mac where it ran." while Undo is available there; and Forget
 * (disabled while it runs or while someone else is signed in as the person). Status words are always beside a colour; no
 * orange beyond the progress bar, the live dot and the empty state's square.
 *
 * It reads `GET /api/orgs/{org}/brenda/jobs` again every 5 seconds while a job runs or is paused, for at most 10 minutes,
 * and never after the page goes. Before migration 0060 an info alert says the list needs a database update.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FolderCog, MousePointerClick } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm";
import { ProgressBar } from "@/components/ui/progress-arc";
import { StatusDot } from "@/components/ui/status-dot";
import { Alert, EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, isApiFailure } from "@/lib/api-client";
import { JOB_WORDS, jobLive, jobStatusWords, jobTone } from "@/lib/jobs";
import type { JobItem } from "@/lib/front";
import { cn } from "@/lib/utils";

const POLL_MS = 5_000;
const POLL_FOR_MS = 10 * 60_000;

export type JobsListProps = {
  orgSlug: string; timeZone: string; name: string;
  initial: { ready: boolean; jobs: JobItem[] };
  impersonated: boolean;
  /** The server's clock, so "today" and "yesterday" read the same on both sides. */
  now: number;
};

const TONE_DOT = { live: "live", paused: "warning", done: "success", failed: "danger", neutral: "neutral" } as const;

/** One job: icon, title, status line, progress or summary, new files, the words they asked, Undo's place, Forget. */
export function JobRow({ job, timeZone, now, orgSlug, impersonated, onForgotten }: { job: JobItem; timeZone: string; now: number; orgSlug: string; impersonated: boolean; onForgotten: (id: string) => void }) {
  const Icon = job.helper === "operator" ? MousePointerClick : FolderCog;
  const live = jobLive(job);
  const tone = jobTone(job);
  const status = jobStatusWords(job, timeZone, new Date(now));
  const title = job.title || JOB_WORDS.helper[job.helper];
  return (
    <li className="flex items-start gap-3 py-4">
      <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="break-words text-sm font-medium text-foreground">{title}</p>
        <p className="flex items-center gap-1.5 text-meta text-secondary">
          <StatusDot tone={TONE_DOT[tone]} pulse={tone === "live"} />
          <span className="tabular-nums">{status}</span>
          <span className="sr-only">, {JOB_WORDS.helper[job.helper]}</span>
        </p>
        {/* Orange is progress while it works; a paused job keeps its amber word (status colours win). */}
        {live && job.status !== "paused" && job.progress.of > 0 ? (
          <ProgressBar value={job.progress.done} max={job.progress.of} size="sm" label={`${title}: progress`} valueText={JOB_WORDS.of(job.progress.done, job.progress.of)} doneTone="accent" className="max-w-sm" />
        ) : null}
        {!live && job.summary ? <p className="break-words text-sm text-secondary">{job.summary}</p> : null}
        {job.outputs.length ? <p className="break-words text-meta text-secondary">{JOB_WORDS.newFiles(job.outputs.map((o) => o.name).join(", "))}</p> : null}
        {job.request ? <p className="truncate text-meta text-secondary">{JOB_WORDS.asked(job.request)}</p> : null}
        {job.undo.available && !live ? <p className="text-meta text-secondary">{JOB_WORDS.undoOnMac}</p> : null}
      </div>
      <ConfirmButton variant="ghost" size="xs" className="shrink-0" disabled={live || impersonated}
        title="Forget this job?" description="It goes from this list and your Activity now. What was done on your Mac stays done."
        confirmLabel={JOB_WORDS.forget} pendingLabel="Forgetting…" aria-label={JOB_WORDS.forgetLabel(title)}
        onConfirm={async () => {
          try {
            await api(`/api/orgs/${orgSlug}/brenda/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE", retries: 1 });
            notify(JOB_WORDS.forgotten, { tone: "success" });
            onForgotten(job.id);
          } catch (err) {
            notify(isApiFailure(err) && err.message ? err.message : JOB_WORDS.forgetFailed, { tone: "danger" });
          }
        }}>
        {JOB_WORDS.forget}
      </ConfirmButton>
    </li>
  );
}

export function JobsList({ orgSlug, timeZone, name, initial, impersonated, now }: JobsListProps) {
  const [data, setData] = useState(initial);
  const [clock, setClock] = useState(now);
  // When polling began: the page's own clock at render (the server's minute), so the limit counts from the page's arrival.
  const started = useRef(now);
  const anyLive = data.jobs.some(jobLive);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await api<{ ready: boolean; jobs: JobItem[] }>(`/api/orgs/${orgSlug}/brenda/jobs`, { signal });
      setData(next);
      setClock(Date.now());
    } catch { /* the next poll tries again; the list stays as it was */ }
  }, [orgSlug]);

  // While a job runs or is paused: again every 5 seconds, for at most 10 minutes, never after the page goes.
  useEffect(() => {
    if (!anyLive || clock - started.current > POLL_FOR_MS) return;
    const ctl = new AbortController();
    const t = setTimeout(() => { void refresh(ctl.signal); }, POLL_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [anyLive, clock, data, refresh]);

  if (!data.ready) return <Alert tone="info">{JOB_WORDS.notReady}</Alert>;
  if (!data.jobs.length) return <EmptyState title={JOB_WORDS.emptyTitle} description={JOB_WORDS.emptyBody(name)} />;
  return (
    <ul className={cn("divide-y divide-border")} aria-label={JOB_WORDS.title}>
      {data.jobs.map((j) => (
        <JobRow key={j.id} job={j} timeZone={timeZone} now={clock} orgSlug={orgSlug} impersonated={impersonated}
          onForgotten={(id) => setData((d) => ({ ...d, jobs: d.jobs.filter((x) => x.id !== id) }))} />
      ))}
    </ul>
  );
}

/** "See your jobs": the link the "{name} on your Mac" card shows. */
export function SeeJobsLink({ orgSlug }: { orgSlug: string }) {
  return <Link href={`/app/${orgSlug}/home/jobs`} className="link-inline text-sm">{JOB_WORDS.seeJobs}</Link>;
}
