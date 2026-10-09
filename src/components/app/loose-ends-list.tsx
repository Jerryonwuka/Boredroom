"use client";

/**
 * The person's loose ends (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed", the personal loop
 * closer; contract D and H.1): promises they made, things asked of them and things they asked of others in the
 * conversations they read, that never became a to-do, reminder, follow-up or commitment. Private to the person: only
 * they ever see these (the database's own rule), and nothing is added or sent until they choose an action.
 *
 * Three parts, all here:
 * - `LooseEndsList` (/home/loose-ends): cards grouped "Promises you made", "Asked of you", "You asked others", then
 *   "Done" (what was acted on, collapsed). Each card: the headline ("You said you'd “Send the deck” for Ben"), the
 *   message as typed (plain text in “ ”, three lines at most) with a "Message" link, where and when, the due date, and
 *   its actions (loose-end-actions: buttons on wide screens, a menu at ~400px). `?l=` marks one and scrolls to it.
 * - `LooseEndsPanel` (her page, inside her panel after "Waiting for you"): at most three compact rows (the headline in
 *   medium, "{where}, {when}" and the due date under it), each with a menu "Actions for “{title}”", and "See all {n}"; with
 *   none, one line and "Look for loose ends".
 * - `LookForLooseEnds`: the button that looks again now (POST …/loose-ends/scan; at most once every two minutes), then
 *   says what it found in a toast and refreshes the page.
 *
 * A card acted on here stays on screen with what was done until the page moves on. No orange of their own: the counts
 * are plain, the status badges neutral (the accent rules: nothing here is live or the screen's one thing to do).
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge, CountPill } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/toast";
import { LooseEndActions, type Person } from "@/components/app/loose-end-actions";
import { QuietLink } from "@/components/app/commitment-card";
import { useAssistant } from "@/components/app/assistant-context";
import { api, isApiFailure } from "@/lib/api-client";
import { dateTimeLabel } from "@/lib/assistant-items";
import { whenLabel } from "@/lib/follow-ups";
import { LOOP_WORDS, type LooseEndKind, type LooseEndList, type LooseEndScanResult, type LooseEndView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const L = LOOP_WORDS.looseEnds;
const GROUPS: { kind: LooseEndKind; title: string }[] = [
  { kind: "promise", title: "Promises you made" },
  { kind: "asked_of_me", title: "Asked of you" },
  { kind: "i_asked", title: "You asked others" },
];

/** What became of a loose end, in a word or two (its badge once acted on). */
export function looseEndStatus(v: LooseEndView, timeZone: string): string | null {
  switch (v.status) {
    case "open": return null;
    case "follow_up_scheduled": return L.status.follow_up_scheduled(v.result?.followUpAt ? dateTimeLabel(v.result.followUpAt, timeZone) : "scheduled");
    default: return L.status[v.status];
  }
}

// ---- Look for loose ends --------------------------------------------------------------------------------------------

export function LookForLooseEnds({ orgSlug, variant = "secondary", className }: { orgSlug: string; variant?: "secondary" | "ghost"; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  async function look() {
    if (busy) return;
    setBusy(true); setSaid("");
    try {
      const r = await api<LooseEndScanResult>(`/api/orgs/${orgSlug}/loose-ends/scan`, { method: "POST", body: {}, retries: 0 });
      const n = r.found.length;
      const words = !r.ready ? L.notReady : n ? L.found(n) : L.foundNone;
      setSaid(words);
      notify(words, { tone: !r.ready ? "warning" : n ? "success" : "neutral", ...(r.note ? { description: r.note } : {}) });
      router.refresh();
    } catch (err) {
      // The cooldown (429), "needs a database update" (503) and any refusal in the server's words.
      const words = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : "Couldn't look just now. Try again in a moment.";
      setSaid(words);
      notify(words, { tone: "warning" });
    } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant={variant} size="sm" loading={busy} onClick={() => void look()} className={className}>{busy ? L.looking : L.look}</Button>
      <span role="status" aria-live="polite" className="sr-only">{said}</span>
    </>
  );
}

// ---- The page's list ------------------------------------------------------------------------------------------------

export function LooseEndsList({ orgSlug, items, people, timeZone, now, highlight = null, noneOpen = null }: {
  orgSlug: string; items: LooseEndView[]; people: Person[]; timeZone: string; now: number; highlight?: string | null;
  /** Shown above "Done" when nothing is open (review, 9 October 2026: a lone collapsed "Done" looked broken). */
  noneOpen?: React.ReactNode;
}) {
  // Loose ends acted on here, as the server answered (the page's copy takes over once it has moved on too).
  const [acted, setActed] = useState<Record<string, { view: LooseEndView; words: string }>>({});
  const view = (v: LooseEndView) => (acted[v.id] && v.status === "open" ? acted[v.id].view : v);
  const all = items.map(view);
  const open = all.filter((v) => v.status === "open" || acted[v.id]);
  const done = all.filter((v) => v.status !== "open" && !acted[v.id]);
  const highlightDone = !!highlight && done.some((v) => v.id === highlight);

  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`loose-end-${highlight}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight]);

  const card = (v: LooseEndView) => (
    <LooseEndCard key={v.id} orgSlug={orgSlug} item={v} people={people} timeZone={timeZone} now={now} highlight={highlight === v.id}
      said={acted[v.id]?.words ?? null} onDone={(next, words) => setActed((cur) => ({ ...cur, [next.id]: { view: next, words } }))} />
  );

  return (
    <div className="space-y-10">
      {open.length ? null : noneOpen}
      {GROUPS.map((g) => {
        const rows = open.filter((v) => v.kind === g.kind);
        if (!rows.length) return null;
        return (
          <section key={g.kind} aria-labelledby={`loose-${g.kind}`}>
            <SectionTitle id={`loose-${g.kind}`} title={<span className="inline-flex items-center gap-2">{g.title}<CountPill count={rows.length} /></span>} />
            <ul className="space-y-3">{rows.map(card)}</ul>
          </section>
        );
      })}
      {done.length ? (
        <details open={highlightDone || undefined} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-sm font-medium text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
            Done<CountPill count={done.length} />
          </summary>
          <ul className="mt-3 space-y-3">{done.map(card)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function LooseEndCard({ orgSlug, item, people, timeZone, now, highlight, said, onDone }: {
  orgSlug: string; item: LooseEndView; people: Person[]; timeZone: string; now: number; highlight: boolean;
  said: string | null; onDone: (view: LooseEndView, words: string) => void;
}) {
  const uid = useId();
  const status = looseEndStatus(item, timeZone);
  const m = item.message;
  return (
    <li>
      <article id={`loose-end-${item.id}`} tabIndex={-1} aria-labelledby={`${uid}-h`}
        className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border-accent-ring")}>
        <div className="min-w-0">
          <div className="flex items-start gap-x-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <h3 id={`${uid}-h`} className="min-w-0 flex-[1_1_12rem] break-words text-sm font-medium text-foreground">{item.headline}</h3>
              {status ? <Badge tone="neutral" className="shrink-0">{status}</Badge> : null}
            </div>
            {/* At ~400px the actions are one menu beside the headline; wider, a row of buttons under the card's words. */}
            {item.actions.length && !said ? (
              <LooseEndActions orgSlug={orgSlug} item={item} people={people} timeZone={timeZone} onDone={onDone} layout="menu" className="-my-1 -mr-1 shrink-0 sm:hidden" />
            ) : null}
          </div>
          {m.withdrawn ? <p className="mt-1.5 text-meta font-normal text-secondary">{LOOP_WORDS.page.withdrawn}</p>
            : m.quote ? <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap break-words text-sm font-normal text-secondary">“{m.quote}”</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta font-normal text-secondary">
            <span className="min-w-0 break-words">{m.where}, <time dateTime={m.at} className="tabular-nums">{whenLabel(m.at, timeZone, new Date(now))}</time></span>
            {m.withdrawn ? null : <QuietLink href={m.href}>{LOOP_WORDS.page.openMessage}</QuietLink>}
            {item.dueLabel ? <Badge tone="neutral" size="sm">Due {item.dueLabel}</Badge> : item.dueWords ? <span>“{item.dueWords}”</span> : null}
          </p>
          {item.result?.taskId && item.status === "todo" ? <p className="mt-1.5"><QuietLink href={`/app/${orgSlug}/todos`}>{LOOP_WORDS.page.openTodo}</QuietLink></p> : null}
          {item.result?.error ? <p className="mt-1.5 break-words text-meta font-normal text-danger">Couldn&apos;t follow up: {item.result.error}</p> : null}
          {said ? <p className="mt-1.5 text-meta font-normal text-success">{said}</p> : null}
        </div>
        {item.actions.length && !said ? (
          <LooseEndActions orgSlug={orgSlug} item={item} people={people} timeZone={timeZone} onDone={onDone} layout="buttons" className="flex justify-end max-sm:hidden" />
        ) : null}
      </article>
    </li>
  );
}

// ---- Her page's block -------------------------------------------------------------------------------------------------

export function LooseEndsPanel({ orgSlug, list, people, timeZone, now, className, rowClassName }: {
  orgSlug: string; list: LooseEndList; people: Person[]; timeZone: string; now: number; className?: string;
  /** The rows' surface (her panel's translucent fill). */ rowClassName?: string;
}) {
  const { name } = useAssistant().personal;
  const titleId = useId();
  const [acted, setActed] = useState<{ view: LooseEndView; words: string }[]>([]);
  if (!list.ready) return null;
  const base = `/app/${orgSlug}`;
  const shown = list.items.filter((v) => v.status === "open" && !acted.some((a) => a.view.id === v.id)).slice(0, 3);
  const rows = [...acted.map((a) => ({ view: a.view, words: a.words as string | null })), ...shown.map((view) => ({ view, words: null as string | null }))];
  const open = Math.max(list.counts.open - acted.length, shown.length);
  return (
    <section aria-labelledby={titleId} className={cn("min-w-0", className)}>
      <SectionTitle id={titleId} title={<span className="inline-flex items-center gap-2">{L.title}{open ? <CountPill count={open} /> : null}</span>}
        action={open > shown.length ? <Link href={`${base}/home/loose-ends`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{L.seeAll(open)}</Link> : undefined} />
      {rows.length ? (
        <ul className={cn("card-panel space-y-0.5 p-1", rowClassName)}>
          {rows.map(({ view: v, words }) => (
            <li key={v.id} className="flex min-w-0 items-start gap-2 rounded-xl px-2 py-2">
              <div className="min-w-0 flex-1">
                <Link href={`${base}/home/loose-ends?l=${v.id}`} className="line-clamp-2 break-words rounded-sm text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] hover:underline hover:decoration-border-input-hover hover:underline-offset-4">{v.headline}</Link>
                <p className="mt-0.5 text-meta font-normal text-secondary">
                  {v.message.where}, <span className="tabular-nums">{whenLabel(v.message.at, timeZone, new Date(now))}</span>{v.dueLabel ? <>, due <span className="tabular-nums">{v.dueLabel}</span></> : null}
                </p>
                {words ? <p className="mt-0.5 text-meta font-normal text-success">{words}</p> : null}
              </div>
              {words ? null : (
                <LooseEndActions orgSlug={orgSlug} item={v} people={people} timeZone={timeZone} layout="menu" className="-my-0.5 shrink-0"
                  onDone={(next, said) => setActed((cur) => [...cur.filter((a) => a.view.id !== next.id), { view: next, words: said }])} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className={cn("card-panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5", rowClassName)}>
          <p className="min-w-0 text-meta font-normal text-secondary">{L.empty.body(name)}</p>
          <LookForLooseEnds orgSlug={orgSlug} />
        </div>
      )}
    </section>
  );
}
