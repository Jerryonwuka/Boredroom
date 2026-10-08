"use client";

/**
 * A routine's runs (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"): every time a routine of
 * the person's ran, newest first, as a list (J.2 "History"): when it was due, its status as a badge with a word
 * (Sent / Held for quiet hours / Nothing to send / Skipped: it missed its time / Failed; lib/routines `runBadge`, never
 * orange), the run's one-line summary, and Open, which goes to the run's own page (/home/routines/{runId}) with what it
 * sent and its links. A held run says when it arrives (when the person's quiet hours end). "Load more" fetches the next
 * 20. One routine's runs in its Settings sheet (GET …/routines/{id}/runs), or every routine's on /home/routines
 * (GET …/routine-runs, each row then named after its routine). Times are in the person's own time zone. Only the
 * person reads their runs (row-level security); nothing here changes anything.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { ROUTINE_WORDS, runBadge, type RoutineRunView } from "@/lib/routines";
import { cn } from "@/lib/utils";

const H = ROUTINE_WORDS.history;
const OFFLINE = "Cannot reach the server. Check your connection and try again.";

/** What the runs routes answer (20 a page; `nextBefore` for the next page, null at the end). */
export type RunsPage = { ready: boolean; runs: RoutineRunView[]; nextBefore: string | null };

/** "Fri 9 Oct, 16:00" in the given zone (the browser's own when the zone is not one it knows). */
export function routineWhen(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try { return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(at); } catch { return new Intl.DateTimeFormat("en-GB", opts).format(at); }
}

/** "16:00" in the given zone. */
export function routineTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try { return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(at); } catch { return new Intl.DateTimeFormat("en-GB", opts).format(at); }
}

/**
 * The runs, as a list with "Load more". `routineId`: one routine's (its Settings sheet), else every routine's (each row
 * named after its routine). `initial`: the first page as the server read it (the /home/routines page); without it the
 * first page is fetched here. `timeZone`: the person's own (the routine's effective zone).
 */
export function RoutineHistory({ orgSlug, routineId, timeZone, initial, className }: {
  orgSlug: string; routineId?: string; timeZone: string; initial?: RunsPage; className?: string;
}) {
  const [runs, setRuns] = useState<RoutineRunView[]>(initial?.runs ?? []);
  const [next, setNext] = useState<string | null>(initial?.nextBefore ?? null);
  const [ready, setReady] = useState(initial?.ready ?? true);
  const [state, setState] = useState<"idle" | "loading" | "more" | "error">(initial ? "idle" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const base = routineId ? `/api/orgs/${orgSlug}/brenda/routines/${routineId}/runs` : `/api/orgs/${orgSlug}/brenda/routine-runs`;
  const all = !routineId;

  const fetchPage = useCallback((before: string | null, append: boolean) => api<RunsPage>(before ? `${base}?before=${encodeURIComponent(before)}` : base).then(
    (page) => {
      setReady(page.ready);
      setRuns((cur) => (append ? [...cur, ...page.runs.filter((r) => !cur.some((c) => c.id === r.id))] : page.runs));
      setNext(page.nextBefore);
      setState("idle");
      if (append) setSaid(`${page.runs.length} more ${page.runs.length === 1 ? "run" : "runs"} shown.`);
    },
    (err: unknown) => {
      setError(isApiFailure(err) && err.error.status < 500 ? err.error.message : OFFLINE);
      setState("error");
    },
  ), [base]);

  // The first page, when the server did not bring it.
  useEffect(() => { if (!initial) void fetchPage(null, false); }, [initial, fetchPage]);

  const more = () => { if (!next || state === "more") return; setError(null); setState("more"); void fetchPage(next, true); };
  const retry = () => { setError(null); setState(runs.length ? "more" : "loading"); void fetchPage(runs.length ? next : null, runs.length > 0); };

  if (!ready) return <Alert tone="info" className={className}>{ROUTINE_WORDS.settings.notReady}</Alert>;
  if (state === "loading") {
    return (
      <div className={cn("space-y-3", className)} role="status" aria-label="Getting the runs">
        {[0, 1, 2].map((i) => <div key={i} className="space-y-1.5 px-2 py-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-3.5 w-2/3" /></div>)}
      </div>
    );
  }
  return (
    <div className={className}>
      {runs.length === 0 && state !== "error" ? <p className="px-2 py-3 text-sm font-normal text-secondary">{H.empty}</p> : (
        <ul className="space-y-0.5">
          {runs.map((r) => <RunRow key={r.id} run={r} timeZone={timeZone} named={all} />)}
        </ul>
      )}
      {error ? <Alert tone="danger" className="mt-3" action={<Button size="xs" variant="secondary" onClick={retry}>Try again</Button>}>{error}</Alert> : null}
      {next && state !== "error" ? (
        <div className="mt-3 flex justify-center">
          <Button size="sm" variant="secondary" loading={state === "more"} onClick={more}>{state === "more" ? "Loading…" : H.loadMore}</Button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}

/**
 * One run: its routine (across routines) or when it was due, the status badge, then the time and the summary in grey,
 * and Open. Stacks at 400px: the badge wraps under the title rather than squeezing it.
 */
function RunRow({ run, timeZone, named }: { run: RoutineRunView; timeZone: string; named: boolean }) {
  const badge = runBadge(run);
  const when = routineWhen(run.dueAt, timeZone);
  const held = run.delivery === "held" && run.heldUntil ? `Arrives at ${routineTime(run.heldUntil, timeZone)}` : null;
  const meta = [named ? when : null, held].filter(Boolean).join(", ");
  return (
    <li className="flex items-start gap-3 rounded-xl px-2 py-3 transition-colors duration-75 hover:bg-fill-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-medium text-foreground">{named ? run.routineName : when}</span>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </p>
        {meta ? <p className="mt-0.5 text-meta font-normal tabular-nums text-secondary">{meta}</p> : null}
        {run.summary ? <p className="mt-0.5 line-clamp-2 break-words text-meta font-normal text-secondary">{run.summary}</p> : null}
      </div>
      <Link href={run.href} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "shrink-0")} aria-label={`${H.open}: ${named ? `${run.routineName}, ` : ""}${when}`}>
        {H.open}<AnimatedArrowUpRight aria-hidden />
      </Link>
    </li>
  );
}
