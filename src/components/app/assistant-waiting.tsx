"use client";

/**
 * "Waiting for you" (owner decisions, 8 October 2026: personal assistants, phases 4 and 6): everything other people's
 * assistants are waiting on the person for, in one place. First the follow-up asks (someone's assistant wants an
 * update on their work; `FollowUpReplyCard`, the nearest deadline first), then the requests to accept or decline
 * (oldest first: the one about to expire first), then the messages and replies not yet seen (oldest first).
 *
 * On "Between assistants" every card shows whole. On her page (inside her panel, above the quick asks) at most two show,
 * asks first, the items as compact rows that keep their Accept/Decline or "Mark as seen"/"Reply" under the row, then
 * "See all {n}" to the inbox. The count beside the title is an orange attention count (it asks the person to act).
 *
 * A card answered here stays on screen after the page refreshes without it (an ask collapses to "Sent."; an item shows
 * what it became), so the person sees their answer went. With nothing waiting and nothing just answered it renders
 * `empty` (nothing on her page; the empty state on the inbox).
 *
 * Phase 7b (owner decision, 8 October 2026: "Brenda keeps the loops closed"; contract H.3): `loops` adds what the
 * workspace's assistant and blocked colleagues are waiting on the person for, which are not assistant items (contract,
 * decision 1): "Ben is blocked on you" (`block-card`), commitments the workspace assistant noted for them and open asks
 * (`commitment-card`). The order: follow-up asks, blocks on you, requests to accept, noted commitments and open asks,
 * then messages and replies, each oldest first. On her page they are compact rows with their buttons under the row, as
 * the items are.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { CountPill } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/card";
import { FollowUpReplyCard } from "@/components/app/follow-up-reply";
import { AssistantItemCard } from "@/components/app/assistant-item-card";
import { CommitmentCard, commitmentWaiting } from "@/components/app/commitment-card";
import { BlockCard, blockWaiting } from "@/components/app/block-card";
import type { AssistantItemView } from "@/lib/assistant-items";
import type { CommitmentView, LoopInboxItem, TaskBlockView } from "@/lib/commitments";
import type { FollowUpView } from "@/lib/follow-ups";
import { cn } from "@/lib/utils";

/** Requests first, then messages and replies; each oldest first. */
export function waitingOrder(items: AssistantItemView[]): AssistantItemView[] {
  const by = (a: AssistantItemView, b: AssistantItemView) => a.createdAt.localeCompare(b.createdAt);
  return [...items.filter((i) => i.kind === "request").sort(by), ...items.filter((i) => i.kind !== "request").sort(by)];
}

type Entry = { kind: "ask"; view: FollowUpView } | { kind: "item"; view: AssistantItemView }
  | { kind: "block"; view: TaskBlockView } | { kind: "commitment"; view: CommitmentView };

const oldestFirst = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);

export function AssistantWaiting({ orgSlug, asks, items, loops = [], timeZone, now, max, seeAllHref, title = "Waiting for you", compact = false, cardClassName, highlight, empty = null, className }: {
  orgSlug: string;
  /** Follow-up asks waiting for the person's reply, the nearest deadline first. */ asks: FollowUpView[];
  /** Requests, unseen messages and replies brought to the person. */ items: AssistantItemView[];
  /** Phase 7b: blocks on the person, commitments noted for them and open asks (none before migration 0048). */ loops?: LoopInboxItem[];
  timeZone: string; now: number;
  /** Cards shown at most; the rest behind "See all {n}" (`seeAllHref`). */ max?: number; seeAllHref?: string;
  /** The section's title; null for none. */ title?: string | null;
  /** Items as compact rows (her page). */ compact?: boolean;
  cardClassName?: string;
  /** A card to mark and scroll to (a follow-up's `?f=` or an item's id). */ highlight?: string | null;
  /** What shows when nothing is waiting and nothing was just answered here (the inbox's empty state). */ empty?: React.ReactNode;
  className?: string;
}) {
  // Answered here: kept on screen once the refreshed page no longer lists them.
  const [answered, setAnswered] = useState<FollowUpView[]>([]);
  const [acted, setActed] = useState<AssistantItemView[]>([]);
  // Phase 7b: blocks and commitments answered here, kept on screen once the refreshed page no longer lists them.
  const [actedBlocks, setActedBlocks] = useState<TaskBlockView[]>([]);
  const [actedCommitments, setActedCommitments] = useState<CommitmentView[]>([]);
  const titleId = useId();
  const liveAsks = asks.map((a) => a.id);
  const liveItems = items.map((i) => i.id);
  const blocks = loops.flatMap((l) => (l.kind === "blocked_on" ? [l.block] : []));
  const noted = loops.flatMap((l) => (l.kind === "commitment" || l.kind === "open_ask" ? [l.commitment] : []));
  const liveBlocks = blocks.map((b) => b.id);
  const liveNoted = noted.map((c) => c.id);
  const itemsInOrder = waitingOrder([...items.map((i) => acted.find((x) => x.id === i.id && Date.parse(x.updatedAt) >= Date.parse(i.updatedAt)) ?? i), ...acted.filter((a) => !liveItems.includes(a.id))]);
  const entries: Entry[] = [
    ...asks.map((view) => ({ kind: "ask" as const, view })),
    ...answered.filter((a) => !liveAsks.includes(a.id)).map((view) => ({ kind: "ask" as const, view })),
    // Phase 7b: blocks on the person, after the follow-up asks.
    ...[...blocks, ...actedBlocks.filter((b) => !liveBlocks.includes(b.id))].sort(oldestFirst).map((view) => ({ kind: "block" as const, view })),
    ...itemsInOrder.filter((i) => i.kind === "request").map((view) => ({ kind: "item" as const, view })),
    // Phase 7b: noted commitments and open asks, after the requests and before the messages.
    ...[...noted, ...actedCommitments.filter((c) => !liveNoted.includes(c.id))].sort(oldestFirst).map((view) => ({ kind: "commitment" as const, view })),
    ...itemsInOrder.filter((i) => i.kind !== "request").map((view) => ({ kind: "item" as const, view })),
  ];
  // Still waiting for the person (as the inbox's WAITING_SQL): an ask not answered here, an open request, an unseen
  // message or reply, an open block on them, a commitment or ask still to answer. What was answered here stays on
  // screen but never takes one of the `max` places, so the next one waiting moves up (visual review, 8 October 2026).
  const stillWaiting = (e: Entry) => e.kind === "ask"
    ? !answered.some((a) => a.id === e.view.id)
    : e.kind === "block" ? blockWaiting(actedBlocks.find((x) => x.id === e.view.id) ?? e.view)
    : e.kind === "commitment" ? commitmentWaiting(actedCommitments.find((x) => x.id === e.view.id) ?? e.view)
    : e.view.kind === "request" ? e.view.status === "delivered" || e.view.status === "seen" : e.view.status === "delivered";
  const waiting = entries.filter(stillWaiting).length;
  const shownOpen = new Set((max ? entries.filter(stillWaiting).slice(0, max) : entries.filter(stillWaiting)).map((e) => `${e.kind}-${e.view.id}`));
  const visible = entries.filter((e) => !stillWaiting(e) || shownOpen.has(`${e.kind}-${e.view.id}`));

  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`follow-up-${highlight}`) ?? document.getElementById(`assistant-item-${highlight}`)
      ?? document.getElementById(`commitment-${highlight}`) ?? document.getElementById(`task-block-${highlight}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight]);

  if (!entries.length) return <>{empty}</>;
  return (
    <section aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Waiting for you"} className={cn("min-w-0", className)}>
      {title ? (
        <SectionTitle id={titleId} title={<span className="inline-flex items-center gap-2">{title}<CountPill count={waiting} tone="attention" /></span>}
          action={max && waiting > max && seeAllHref ? <Link href={seeAllHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>See all {waiting}</Link> : undefined} />
      ) : null}
      <ul className={compact ? "space-y-2" : "space-y-3"}>
        {visible.map((e) => (
          <li key={`${e.kind}-${e.view.id}`}>
            {e.kind === "ask" ? (
              <FollowUpReplyCard orgSlug={orgSlug} view={e.view} timeZone={timeZone} now={now} className={cardClassName} id={`follow-up-${e.view.id}`} highlight={highlight === e.view.id}
                onDone={() => setAnswered((cur) => (cur.some((x) => x.id === e.view.id) ? cur : [...cur, e.view]))} />
            ) : e.kind === "block" ? (
              <BlockCard orgSlug={orgSlug} block={e.view} timeZone={timeZone} now={now} compact={compact} id={`task-block-${e.view.id}`} highlight={highlight === e.view.id}
                className={compact ? cn("card-panel px-2 pt-1", cardClassName) : cardClassName}
                onChange={(v) => setActedBlocks((cur) => [...cur.filter((x) => x.id !== v.id), v])} />
            ) : e.kind === "commitment" ? (
              <CommitmentCard orgSlug={orgSlug} view={e.view} timeZone={timeZone} now={now} compact={compact} id={`commitment-${e.view.id}`} highlight={highlight === e.view.id}
                className={compact ? cn("card-panel px-2 pt-1", cardClassName) : cardClassName}
                onChange={(v) => setActedCommitments((cur) => [...cur.filter((x) => x.id !== v.id), v])} />
            ) : (
              <AssistantItemCard orgSlug={orgSlug} item={e.view} timeZone={timeZone} now={now} compact={compact} id={`assistant-item-${e.view.id}`} highlight={highlight === e.view.id}
                className={compact ? cn("card-panel px-2 pt-1", cardClassName) : cardClassName}
                onChange={(v) => setActed((cur) => [...cur.filter((x) => x.id !== v.id), v])} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
