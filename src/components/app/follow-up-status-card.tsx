"use client";

/**
 * The live card under her reply in the chat once a follow-up is confirmed (owner decision, 8 October 2026: personal
 * assistants, phase 4). It follows the follow-up from asking to answered in place, without the person refreshing:
 *
 * - one person: the person's own assistant's face and the other assistant's, overlapping; "Follow-up with Ben, about
 *   “Landing page”" and its badge; then where it stands ("Asking Ben's Brenda…", "Ben's Brenda asked Ben. Reply due by
 *   19:41.", "Writing the answer…"), and once answered the answer itself (three lines, "Show all" opens the whole
 *   exchange here);
 * - a group or a team: "Follow-up with 6 people on Design", an orange bar with "4 of 6 in" beside it, then one compact
 *   row per person (six at most, then "And 2 more" to the batch's page).
 *
 * It reads `GET /api/orgs/{org}/follow-ups/batches/{id}`, again (300 ms after the last one) whenever the workspace's
 * change stream names this batch or one of its follow-ups (`CHANGE_EVENT`, components/app/realtime); before the first
 * read lands it does not know its follow-ups' ids yet, so any follow-up change then reads again (the fast path often
 * answers within a second of the Confirm). While something is still starting or being written it also reads every
 * 2.5 s, a dozen times at most, then every 30 s while anything is open and the tab is on screen (visual review,
 * 8 October 2026: with no change stream the card sat on "Starting" for 30 s); it stops once the batch is complete. A failed read keeps the last
 * state and says so quietly, with Retry. Only the status line is a live region. Saved chats keep the card (the action's
 * `followUpBatchId` is saved with the conversation), so a past chat shows the follow-up as it is now.
 *
 * Times are in the organisation's time zone where the caller knows it (her page), else this browser's (the drawer).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatedArrowUpRight, AnimatedRefreshCw } from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-arc";
import { Skeleton } from "@/components/ui/states";
import { AssistantFace, FollowUpBadge, FollowUpExchange, browserTimeZone, progressWords } from "@/components/app/follow-up-exchange";
import { useAssistant } from "@/components/app/assistant-context";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { api, isApiFailure } from "@/lib/api-client";
import { badgeOf, OPEN_STATUSES, type FollowUpBatchView } from "@/lib/follow-ups";
import { cn } from "@/lib/utils";

/** Rows a group's card lists before "And N more". */
const ROWS = 6;
const POLL_MS = 30_000;
/** While something is starting or being written: a quick read this often, at most FAST_MAX times. */
const FAST_MS = 2_500;
const FAST_MAX = 12;
const DEBOUNCE_MS = 300;

export function FollowUpStatusCard({ orgSlug, batchId, onLeave, timeZone, action, className }: {
  orgSlug: string; batchId: string;
  /** Called before a link here opens a page (the drawer closes first). */ onLeave?: () => void;
  /** The organisation's time zone; this browser's when not given. */ timeZone?: string;
  /** Beside the title: the action row's Open button. */ action?: React.ReactNode;
  className?: string;
}) {
  const { personal } = useAssistant();
  const [batch, setBatch] = useState<FollowUpBatchView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const zone = timeZone ?? browserTimeZone();
  const bodyId = useId();
  // The newest read wins: an older answer arriving late does not overwrite a newer one.
  const seq = useRef(0);
  const known = useRef<{ ids: Set<string>; complete: boolean; loaded: boolean }>({ ids: new Set(), complete: false, loaded: false });
  const fastReads = useRef(0);

  // `loading` is true until the first read lands, and while a Retry runs; reads the change stream starts stay silent.
  const load = useCallback(() => {
    const mine = ++seq.current;
    return api<{ batch: FollowUpBatchView | null }>(`/api/orgs/${orgSlug}/follow-ups/batches/${batchId}`).then((r) => {
      if (mine !== seq.current) return;
      // Before migration 0039 the read answers `{ ready: false, batch: null }`: nothing to show (integration review,
      // 8 October 2026).
      if (!r.batch) { setFailed("gone"); setLoading(false); return; }
      known.current = { ids: new Set(r.batch.items.map((i) => i.id)), complete: !!r.batch.completedAt, loaded: true };
      setBatch(r.batch); setFailed(null); setNow(Date.now()); setLoading(false);
    }, (err: unknown) => {
      if (mine !== seq.current) return;
      // A follow-up that is not there (or no longer yours to see) says so; anything else keeps the last state.
      setFailed(isApiFailure(err) && err.error.status === 404 ? "gone" : "refresh"); setLoading(false);
    });
  }, [orgSlug, batchId]);

  useEffect(() => { void load(); }, [load]);

  // The change stream: this batch, or one of its follow-ups, changed. Several changes in a burst are one read.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChangeEvent>).detail;
      if (!d || known.current.complete) return;
      // Before the first read lands the ids are not known: any follow-up change may be ours.
      const ours = (d.table === "follow_up_batches" && d.id === batchId) || (d.table === "follow_ups" && (!known.current.loaded || known.current.ids.has(d.id)));
      if (!ours) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void load(); }, DEBOUNCE_MS);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { window.removeEventListener(CHANGE_EVENT, onChange); if (timer) clearTimeout(timer); };
  }, [batchId, load]);

  // Quick reads while Boredroom is starting or writing an answer (seconds, not hours: nobody is being waited for).
  const working = !!batch && !batch.completedAt && batch.items.some((i) => i.status === "pending" || i.status === "answering");
  useEffect(() => {
    if (!working || fastReads.current >= FAST_MAX) return;
    const t = setTimeout(() => { fastReads.current++; if (document.visibilityState === "visible") void load(); else setNow(Date.now()); }, FAST_MS);
    return () => clearTimeout(t);
  }, [working, batch, load]);

  // A slow poll while anything is open and the tab is on screen, in case a change was missed (a reconnect).
  const open = !!batch && !batch.completedAt && batch.items.some((i) => OPEN_STATUSES.includes(i.status));
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [open, load]);

  const retry = failed === "refresh" ? (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-normal text-subtle">
      Couldn&apos;t refresh.
      <button type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-my-1")}><AnimatedRefreshCw aria-hidden />Retry</button>
    </p>
  ) : null;

  if (!batch) {
    return (
      <div className={cn("rounded-xl border border-border p-3", className)}>
        {failed === "gone" ? <p className="text-sm font-normal text-secondary">This follow-up is no longer here.</p>
          : failed ? <><p className="text-sm font-normal text-secondary">Follow-up</p>{retry}</>
          : <div aria-hidden className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>}
        {!failed ? <span className="sr-only" role="status">Loading the follow-up…</span> : null}
      </div>
    );
  }

  const single = batch.kind !== "group" && batch.items.length === 1 ? batch.items[0] : null;
  const leave = () => onLeave?.();

  if (single) {
    const words = progressWords(single, zone, now, personal.name);
    const answered = single.status === "answered" || single.status === "expired" || single.status === "declined";
    const title = single.task ? <>Follow-up with {single.subject.firstName}, about “{single.task.title}”</> : <>Follow-up with {single.subject.firstName}</>;
    return (
      <div className={cn("min-w-0 rounded-xl border border-border-input p-3", className)}>
        <div className="flex items-start gap-2.5">
          {/* The person's own assistant and the one it asked, overlapping. */}
          <span className="mt-px flex shrink-0 -space-x-1.5" aria-hidden>
            <AssistantFace profile={single.requester?.assistant ?? personal} own={single.viewer === "requester"} />
            <AssistantFace profile={single.subject.assistant} own={false} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
              <p className="min-w-0 break-words text-sm font-medium text-foreground">{title}</p>
              <span className="flex shrink-0 items-center gap-1.5"><FollowUpBadge view={single} />{action}</span>
            </div>
            {/* The status line, the card's one live region (the same element throughout, so each change is heard): where
                it stands while open; once answered, only for screen readers (the badge's words), the answer under it. */}
            <p role="status" aria-live="polite" className={answered ? "sr-only" : cn("mt-1 text-sm font-normal text-secondary", words.shimmer && "brenda-shimmer")}>
              {answered ? badgeOf(single).label : words.text}
            </p>
            {answered ? (
              <>
                {/* Three lines here; "Show all" opens the whole exchange below in its place. */}
                {!expanded ? <p id={bodyId} className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm font-normal text-foreground">{single.answer}</p> : null}
                <button type="button" aria-expanded={expanded} aria-controls={`${bodyId}-all`} onClick={() => setExpanded((x) => !x)}
                  className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-ml-2 mt-1")}>{expanded ? "Show less" : "Show all"}</button>
              </>
            ) : null}
          </div>
        </div>
        {answered && expanded ? (
          <div id={`${bodyId}-all`} className="mt-3" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) leave(); }}>
            <FollowUpExchange view={single} timeZone={zone} now={now} embedded />
          </div>
        ) : null}
        {retry}
      </div>
    );
  }

  // A group or a team: how many are in, then a compact row each.
  const total = batch.counts.total || batch.items.length;
  const inNow = total - batch.counts.open;
  const who = batch.team ? `${total} ${total === 1 ? "person" : "people"} on ${batch.team.name}` : `${total} ${total === 1 ? "person" : "people"}`;
  const more = batch.items.length - ROWS;
  return (
    <div className={cn("min-w-0 rounded-xl border border-border-input p-3", className)}>
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={personal} own className="mt-px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 break-words text-sm font-medium text-foreground">Follow-up with {who}</p>
            {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <ProgressBar value={inNow} max={total} label="Answers in" valueText={`${inNow} of ${total} in`} className="flex-1" />
            <p role="status" aria-live="polite" className="shrink-0 text-xs font-medium tabular-nums text-secondary">{inNow} of {total} in</p>
          </div>
          {batch.completedAt && batch.summary ? <p className="mt-2 text-meta font-normal text-secondary">{batch.summary}</p> : null}
        </div>
      </div>
      <ul className="-mx-1 mt-2 space-y-0.5" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) leave(); }}>
        {batch.items.slice(0, ROWS).map((v) => <li key={v.id}><FollowUpExchange view={v} timeZone={zone} now={now} compact /></li>)}
      </ul>
      {more > 0 ? (
        <Link href={batch.href} onClick={leave} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "mt-1")}>And {more} more<AnimatedArrowUpRight aria-hidden /></Link>
      ) : null}
      {retry}
    </div>
  );
}
