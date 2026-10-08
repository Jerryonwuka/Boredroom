"use client";

/**
 * The lists on Follow-ups (owner decision, 8 October 2026: personal assistants, phase 4).
 *
 * - "You asked" (`MyFollowUpsList`): the person's follow-ups, newest first. A follow-up with one person is the whole
 *   exchange between the two assistants (`FollowUpExchange`); a group or a team is one card with the question, how many
 *   are in (or the summary once they all are) and a compact row per person that opens into the exchange.
 * - "Asked about you" (`AboutYouList`): every follow-up about the person, newest first, as they see it: who asked, the
 *   question, exactly what their assistant shared, their reply and the times, including those answered from their work
 *   without asking them. `?f=` marks one and scrolls to it.
 *
 * The page renders the first page on the server and refreshes it as follow-ups change (the workspace's change stream
 * refreshes server pages); "Show older" appends older pages from `GET /api/orgs/{org}/follow-ups` by their `before`
 * cursor. Rows from the server always win over the same rows fetched earlier, so a follow-up answered while the page is
 * open shows its answer.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-arc";
import { Alert } from "@/components/ui/states";
import { AssistantFace, FollowUpExchange } from "@/components/app/follow-up-exchange";
import { useAssistant } from "@/components/app/assistant-context";
import { api, isApiFailure } from "@/lib/api-client";
import { whenLabel, type FollowUpBatchView, type FollowUpView } from "@/lib/follow-ups";

const LOAD_FAILED = "Could not load more. Check your connection and try again.";
const PAGE = 20;

/** The server's first page, then the older pages fetched here, without repeats (the server's copy wins). */
function merged<T extends { id: string }>(first: T[], older: T[]): T[] {
  const seen = new Set(first.map((x) => x.id));
  return [...first, ...older.filter((x) => !seen.has(x.id))];
}

/** "Show older": fetches the next page by its cursor; keeps the focus on the button, says how many show. */
function useOlder<T extends { id: string }>(fetchPage: (before: string) => Promise<{ rows: T[]; nextBefore: string | null }>, initialCursor: string | null) {
  const [older, setOlder] = useState<T[]>([]);
  // Undefined until a page has been fetched here: until then the server's own cursor (which moves on refresh) is the one.
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const next = cursor === undefined ? initialCursor : cursor;
  async function load() {
    if (!next || loading) return;
    setLoading(true); setFailure(null);
    try {
      const page = await fetchPage(next);
      setOlder((cur) => merged(cur, page.rows));
      setCursor(page.nextBefore);
    } catch (err) {
      setFailure(isApiFailure(err) && err.error.status < 500 ? err.error.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }
  return { older, next, loading, failure, load };
}

/** The person's own follow-ups ("You asked"). */
export function MyFollowUpsList({ orgSlug, timeZone, now, status, initial }: {
  orgSlug: string; timeZone: string; now: number; status: "open" | "done" | "all";
  initial: { batches: FollowUpBatchView[]; nextBefore: string | null };
}) {
  const more = useOlder<FollowUpBatchView>(async (before) => {
    const q = new URLSearchParams({ view: "mine", status, before, limit: String(PAGE) });
    const r = await api<{ batches: FollowUpBatchView[]; nextBefore: string | null }>(`/api/orgs/${orgSlug}/follow-ups?${q}`, { retries: 1 });
    return { rows: r.batches, nextBefore: r.nextBefore };
  }, initial.nextBefore);
  const batches = merged(initial.batches, more.older);
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {batches.map((b) => (
          <li key={b.id}>
            {b.kind === "person" && b.items.length === 1
              ? <FollowUpExchange view={b.items[0]} timeZone={timeZone} now={now} />
              : <FollowUpBatchCard batch={b} timeZone={timeZone} now={now} />}
          </li>
        ))}
      </ul>
      <MoreButton more={more} shown={batches.length} />
    </div>
  );
}

/** Everything asked about the person ("Asked about you"), as they see it. */
export function AboutYouList({ orgSlug, timeZone, now, initial, highlight }: {
  orgSlug: string; timeZone: string; now: number;
  initial: { items: FollowUpView[]; nextBefore: string | null };
  /** `?f=`: the follow-up to mark and scroll to. */ highlight?: string | null;
}) {
  const more = useOlder<FollowUpView>(async (before) => {
    const q = new URLSearchParams({ view: "about-me", before, limit: String(PAGE) });
    const r = await api<{ items: FollowUpView[]; nextBefore: string | null }>(`/api/orgs/${orgSlug}/follow-ups?${q}`, { retries: 1 });
    return { rows: r.items, nextBefore: r.nextBefore };
  }, initial.nextBefore);
  const items = merged(initial.items, more.older);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!highlight || scrolled.current) return;
    const el = document.getElementById(`follow-up-${highlight}`);
    if (!el) return;
    scrolled.current = true;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight]);
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {items.map((v) => (
          <li key={v.id}><FollowUpExchange view={v} timeZone={timeZone} now={now} id={`follow-up-${v.id}`} highlight={highlight === v.id} /></li>
        ))}
      </ul>
      <MoreButton more={more} shown={items.length} />
    </div>
  );
}

function MoreButton({ more, shown }: { more: { next: string | null; loading: boolean; failure: string | null; load: () => Promise<void>; older: unknown[] }; shown: number }) {
  return (
    <>
      {more.failure ? <Alert tone="danger">{more.failure}</Alert> : null}
      {more.next ? <Button variant="secondary" size="sm" loading={more.loading} onClick={() => void more.load()}>Show older</Button> : null}
      <p role="status" aria-live="polite" className="sr-only">{more.older.length ? `Showing ${shown}` : ""}</p>
    </>
  );
}

/**
 * A follow-up with several people (or a team, or the workspace's collection for the team report): the question, how many
 * are in (an orange bar while some are still open, the summary once all are), then a compact row each.
 */
export function FollowUpBatchCard({ batch, timeZone, now }: { batch: FollowUpBatchView; timeZone: string; now: number }) {
  const { personal, workspace } = useAssistant();
  const total = batch.counts.total || batch.items.length;
  const inNow = total - batch.counts.open;
  const people = `${total} ${total === 1 ? "person" : "people"}`;
  const first = batch.items[0];
  const workspaceRun = batch.kind === "workspace";
  const signer = workspaceRun ? first?.workspaceAssistant ?? workspace : first?.requester?.assistant ?? personal;
  const title = workspaceRun ? `${signer.name} collected today's updates for the team report`
    : batch.team ? `Follow-up with ${people} on ${batch.team.name}` : `Follow-up with ${people}`;
  return (
    <article aria-label={title} className="card-panel flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={signer} own={!workspaceRun && first?.viewer === "requester"} className="mt-px" />
        <div className="min-w-0 flex-1">
          <p className="min-w-0 text-sm font-medium text-foreground">
            {title}<span className="font-normal text-secondary">, <span className="tabular-nums">{whenLabel(batch.createdAt, timeZone, new Date(now))}</span></span>
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground">“{batch.question}”</p>
          {batch.task ? (
            <Link href={batch.task.href} className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-sm text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:size-3.5 [&_svg]:shrink-0">
              <span className="min-w-0 truncate">About {batch.task.title}</span><AnimatedArrowUpRight aria-hidden />
            </Link>
          ) : null}
          {batch.completedAt && batch.summary ? (
            <p className="mt-2 text-meta font-normal text-secondary">{batch.summary}</p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <ProgressBar value={inNow} max={total} label="Answers in" valueText={`${inNow} of ${total} in`} className="flex-1" />
              <p className="shrink-0 text-xs font-medium tabular-nums text-secondary">{inNow} of {total} in</p>
            </div>
          )}
        </div>
      </div>
      <ul className="-mx-1 space-y-0.5">
        {batch.items.map((v) => <li key={v.id}><FollowUpExchange view={v} timeZone={timeZone} now={now} compact /></li>)}
      </ul>
    </article>
  );
}
