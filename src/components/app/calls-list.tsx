"use client";

/**
 * The Calls page's lists (owner decisions, 8 October 2026: phase 8, calls; contract D.8).
 *
 * - `HappeningNow`: calls running in conversations the person reads: the faces of who is in it, "#Design" or the person,
 *   "Started 14:05, 3 people" ("Started yesterday, 23:50, …"), the live mark and Join. It refetches on the calls
 *   tables' events. Times are in the organisation's time zone, as the history's (fix review, 10 October 2026: the
 *   server and the browser could draw different times).
 * - `CallsList`: the person's history, newest first, in 64px rows: the other person's face (a group call: the channel's
 *   sign and up to three small faces), the name or "#Design", "Today, 14:05, 12 min", an outcome badge (Missed in red;
 *   Declined and Not answered neutral; Joined none), "Notes" when a recap is written, and "Call back" (a missed one-to-one)
 *   or "Call again". The row opens the call's page; its button is separate (never a button inside a link). "Load more"
 *   pages back with `before`. Empty: "No calls yet" with a way to Messages (the plain phone; the crossed-out one only on
 *   the Missed tab), fix review, 10 October 2026.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Hash, Phone, PhoneMissed } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { LiveIndicator } from "@/components/ui/status-dot";
import { CallButton } from "@/components/app/call-button";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { CALL_WORDS, callDurationLabel, type CallHistoryItem, type CallHistoryList, type CallPerson, type LiveCallSummary } from "@/lib/calls";
import { CALL_EVENT_TABLES, assistantRingColour, callWhen, callsApi, startedWhen } from "@/lib/calls-client";
import { cn } from "@/lib/utils";

const ROW = "relative flex min-h-16 items-center gap-3 rounded-xl px-2 py-3 transition-colors duration-75 hover:bg-fill-1 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-[var(--ring)]";
// The row's link covers the row; the trailing button sits above it.
const COVER = "min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']";

function SmallFaces({ people }: { people: CallPerson[] }) {
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden>
      {people.slice(0, 3).map((p, i) => <Avatar key={p.membershipId} profileId={p.profileId} name={p.name} avatarKey={p.avatarKey} size={18} className={cn("ring-2 ring-background", i > 0 && "-ml-1.5")} />)}
    </span>
  );
}

function Lead({ item, me }: { item: { kind: "direct" | "group"; people: CallPerson[]; startedBy: CallPerson }; me: string }) {
  if (item.kind === "group") return <span className="grid size-10 place-items-center rounded-xl bg-fill-1 text-secondary"><Hash className="size-4" aria-hidden /></span>;
  const other = item.people.find((p) => p.membershipId !== me) ?? item.startedBy;
  return <Avatar profileId={other.profileId} name={other.name} avatarKey={other.avatarKey} size={36} ring={assistantRingColour(other.assistant)} />;
}

function nameOf(item: { kind: "direct" | "group"; where: { name: string | null }; people: CallPerson[]; startedBy: CallPerson }, me: string) {
  if (item.where.name) return item.where.name;
  if (item.kind === "direct") return (item.people.find((p) => p.membershipId !== me) ?? item.startedBy).name;
  return CALL_WORDS.history.deletedChannel;
}

export function HappeningNow({ orgSlug, initial, me, available, timeZone }: { orgSlug: string; initial: LiveCallSummary[]; me: string; available: boolean; timeZone?: string }) {
  const calls = useMemo(() => callsApi(orgSlug), [orgSlug]);
  const [live, setLive] = useState(initial);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const table = (e as CustomEvent<ChangeEvent>).detail?.table;
      if (!table || !CALL_EVENT_TABLES.has(table)) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; calls.live().then((r) => setLive(r.live), () => {}); }, 1000);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { if (t) clearTimeout(t); window.removeEventListener(CHANGE_EVENT, onChange); };
  }, [calls]);
  if (!live.length) return null;
  return (
    <section aria-labelledby="calls-now" className="mb-8">
      <h2 id="calls-now" className="type-section-title">{CALL_WORDS.history.now}</h2>
      <ul className="grid gap-1">
        {live.map((c) => (
          <li key={c.id} className={ROW}>
            <Lead item={{ kind: c.kind, people: c.people, startedBy: c.startedBy }} me={me} />
            <Link href={c.href} className={COVER}>
              <span className="block truncate text-sm font-semibold text-foreground">{nameOf({ ...c, people: c.people }, me)}</span>
              <span className="flex min-w-0 items-center gap-2 text-meta font-normal text-secondary">
                {c.kind === "group" ? <SmallFaces people={c.people} /> : null}
                <span className="truncate">{CALL_WORDS.history.started(startedWhen(c.startedAt, new Date(), timeZone), c.inRoom)}</span>
              </span>
            </Link>
            <span className="relative z-[var(--z-raised)] flex shrink-0 items-center gap-3">
              <LiveIndicator className="max-sm:hidden">{CALL_WORDS.thread.live}</LiveIndicator>
              <CallButton orgSlug={orgSlug} target={{ kind: "conversation", conversationId: c.where.conversationId, label: c.where.name ?? "the call" }} live={c} available={available} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistoryRow({ orgSlug, item, me, available, timeZone }: { orgSlug: string; item: CallHistoryItem; me: string; available: boolean; timeZone?: string }) {
  const other = item.kind === "direct" ? item.people.find((p) => p.membershipId !== me) ?? null : null;
  const name = nameOf(item, me);
  const answered = item.durationSeconds !== null && item.outcome === "joined";
  const when = [callWhen(item.startedAt, new Date(), timeZone), answered ? callDurationLabel(item.durationSeconds) : null].filter(Boolean).join(", ");
  const outcome = item.outcome === "joined" ? null : item.outcome;
  const target = item.kind === "direct" ? (other ? { kind: "person" as const, membershipId: other.membershipId, name: other.name } : null) : item.where.name ? { kind: "conversation" as const, conversationId: item.where.conversationId, label: item.where.name } : null;
  return (
    <li className={ROW}>
      <Lead item={item} me={me} />
      <Link href={item.href} className={COVER}>
        <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="flex min-w-0 items-center gap-2 text-meta font-normal text-secondary">
          {item.kind === "group" ? <SmallFaces people={item.people} /> : null}
          <span className="truncate">{when}</span>
        </span>
      </Link>
      <span className="relative z-[var(--z-raised)] flex shrink-0 items-center gap-2">
        {item.live ? <LiveIndicator className="max-sm:hidden">{CALL_WORDS.thread.live}</LiveIndicator> : null}
        {outcome ? <Badge tone={outcome === "missed" ? "danger" : "neutral"} className={outcome === "missed" ? undefined : "max-sm:hidden"}>{CALL_WORDS.history.outcome[outcome]}</Badge> : null}
        {item.recap === "done" ? <Badge className="max-sm:hidden">{CALL_WORDS.history.notes}</Badge> : null}
        {target && !item.live ? <CallButton orgSlug={orgSlug} target={target} live={null} available={available} label={other && item.outcome === "missed" ? CALL_WORDS.callBack : CALL_WORDS.callAgain} variant="ghost" /> : null}
      </span>
    </li>
  );
}

export function CallsList({ orgSlug, initial, filter, me, available, timeZone }: { orgSlug: string; initial: CallHistoryList; filter: "all" | "missed"; me: string; available: boolean; timeZone?: string }) {
  const calls = useMemo(() => callsApi(orgSlug), [orgSlug]);
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.nextBefore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // A refreshed page brings a new first page: start again from it.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) { setSeed(initial); setItems(initial.items); setNext(initial.nextBefore); }
  if (!items.length) {
    return filter === "missed"
      ? <EmptyState icon={PhoneMissed} title={CALL_WORDS.history.emptyMissed} className="py-16" />
      : <EmptyState icon={Phone} title={CALL_WORDS.history.empty} description={CALL_WORDS.history.emptyHint} className="py-16"
          action={<Link href={`/app/${orgSlug}/messages`} className={buttonVariants({ variant: "secondary", size: "sm" })}>{CALL_WORDS.history.openMessages}</Link>} />;
  }
  const more = async () => {
    if (!next) return;
    setLoading(true); setError(false);
    try {
      const page = await calls.history({ filter, before: next });
      setItems((xs) => [...xs, ...page.items.filter((i) => !xs.some((x) => x.id === i.id))]);
      setNext(page.nextBefore);
    } catch { setError(true); } finally { setLoading(false); }
  };
  return (
    <>
      <ul className="grid gap-1" aria-label={filter === "missed" ? CALL_WORDS.history.missedList : CALL_WORDS.history.yours}>
        {items.map((i) => <HistoryRow key={i.id} orgSlug={orgSlug} item={i} me={me} available={available} timeZone={timeZone} />)}
      </ul>
      {next ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void more()} loading={loading}>{CALL_WORDS.history.loadMore}</Button>
          {error ? <p role="alert" className="text-meta font-normal text-danger">{CALL_WORDS.history.loadMoreFailed}</p> : null}
        </div>
      ) : null}
    </>
  );
}
