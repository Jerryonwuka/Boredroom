"use client";

/**
 * A team lead's standup rollup (owner decisions, 8–9 October 2026: phase 7c, async standup option B; contract B.6 and
 * G.2). At the team's cutoff (12:00 by default) the worker puts one rollup together for the team's lead(s): who posted
 * (with the time and a link to the message), the blockers they named in their own approved words (and on whom), and who
 * has no update. Nobody is ever chased or shamed: "No update" is one neutral, alphabetical list of names in the quiet
 * grey, with no reason and no warning icon, so skipping the day and saying nothing read exactly the same. Posts that
 * came in after the cutoff are listed under "Posted after 12:00" (the rollup is not sent again for them).
 *
 * - The whole card (`/home/standup`, a lead's "Rollups"): the team and the day, the headline ("4 of 6 posted by
 *   12:00."), then **Posted**, **Blocked**, **No update** and **Posted after 12:00** as lists (an empty one is left
 *   out). Names and words are plain text, never Markdown or links; the only links are Boredroom's own (the message, the
 *   task), built from ids by lib/evidence-links. Opening it marks it seen (POST …/rollups/{id}/seen, once per page).
 * - `compact` (her page, "Waiting for you"): one row, the team's standup and the headline with the blockers' count, and
 *   Open, which goes to the whole card (where it is marked seen).
 *
 * No orange: a rollup is information, not the one thing to do (accent rules, 6 October 2026); the status words sit in
 * neutral badges. Fits 400px: lines wrap, nothing scrolls sideways.
 */
import { useEffect, useId } from "react";
import Link from "next/link";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { evidenceHref } from "@/lib/evidence-links";
import { STANDUP_WORDS, clockOf, rollupHeadline, type StandupRollupContent, type StandupRollupView } from "@/lib/standup";
import { cn } from "@/lib/utils";

const R = STANDUP_WORDS.rollup;

/** Marked seen once per page, whatever re-renders (the server answers 'ok' again anyway). */
const seenRollups = new Set<string>();
function markRollupSeen(orgSlug: string, id: string) {
  if (seenRollups.has(id)) return;
  seenRollups.add(id);
  api(`/api/orgs/${orgSlug}/standup/rollups/${id}/seen`, { method: "POST", retries: 1 }).catch(() => seenRollups.delete(id));
}

/** Why a day has no rollup to read, in a sentence (lib/standup's words for the reason codes of contract B.2 and B.6). */
function noRollupWords(r: StandupRollupView, cutoff: string): string {
  if (r.status === "open") return cutoff ? R.open(cutoff) : "The rollup comes at the cutoff.";
  return R.reasons(r.reason);
}

/** A message or task link in a line: " (message)", small, built from ids only. */
function LineLink({ href, word, about }: { href: string | null; word: string; about: string }) {
  if (!href) return null;
  return <span className="text-secondary">{" ("}<Link href={href} prefetch={false} className="link-inline">{word}<span className="sr-only">, {about}</span></Link>{")"}</span>;
}

/** A bold label over its list, as her replies group a summary ("**Posted**"). */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h4 id={id} className="text-sm font-semibold text-foreground">{label}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-[1.25em] text-sm font-normal text-foreground marker:text-secondary">{children}</ul>
    </section>
  );
}

/** The four lists of a sent rollup (an empty one is left out). */
function RollupLists({ orgSlug, content, timeZone }: { orgSlug: string; content: StandupRollupContent; timeZone: string }) {
  const cutoff = clockOf(content.cutoffAt, timeZone);
  const clockTime = (iso: string) => clockOf(iso, timeZone);
  const message = (messageId: string | null, conversationId: string | null) => evidenceHref(orgSlug, { kind: "message", id: messageId, conversationId });
  return (
    <div className="grid gap-3">
      {content.posted.length ? (
        <Group label={R.posted}>
          {content.posted.map((p) => (
            <li key={p.membershipId} className="break-words">
              <span className="font-medium">{p.name}</span>, <time dateTime={p.at} className="tabular-nums">{clockTime(p.at)}</time>
              <LineLink href={message(p.messageId, p.conversationId)} word={R.messageLink} about={`${p.name}'s standup`} />
            </li>
          ))}
        </Group>
      ) : null}
      {content.blockers.length ? (
        <Group label={R.blocked}>
          {content.blockers.map((b, i) => (
            <li key={`${b.membershipId}-${i}`} className="break-words">
              <span className="font-medium">{b.name}</span>
              {b.onName ? <> on <span className="font-medium">{b.onName}</span></> : null}
              {/* Their own approved words: plain text, as written (they carry the task's title in its own quotes). */}
              : <span className="whitespace-pre-wrap">{b.text}</span>
              <LineLink href={b.taskId ? evidenceHref(orgSlug, { kind: "task", id: b.taskId }) : null} word="task" about={`what ${b.name} is blocked on`} />
            </li>
          ))}
        </Group>
      ) : null}
      {content.noUpdate.length ? (
        // Never chased, never shamed (owner decision, 8 October 2026): names only, in the quiet grey, no reason, no icon.
        <Group label={R.noUpdate}>
          {content.noUpdate.map((p) => <li key={p.membershipId} className="break-words text-secondary">{p.name}</li>)}
        </Group>
      ) : null}
      {content.late.length ? (
        <Group label={cutoff ? R.late(cutoff) : "Posted later"}>
          {content.late.map((p) => (
            <li key={p.membershipId} className="break-words">
              <span className="font-medium">{p.name}</span>, <time dateTime={p.at} className="tabular-nums">{clockTime(p.at)}</time>
              <LineLink href={message(p.messageId, p.conversationId)} word={R.messageLink} about={`${p.name}'s standup`} />
            </li>
          ))}
        </Group>
      ) : null}
    </div>
  );
}

export function StandupRollupCard({ orgSlug, rollup: r, timeZone, compact = false, highlight = false, className, id }: {
  orgSlug: string; rollup: StandupRollupView; timeZone: string;
  /** One row with Open (her page). */ compact?: boolean;
  /** The rollup a link pointed at (`?r=`): a 1px orange border, scrolled to and focused. */ highlight?: boolean;
  className?: string; id?: string;
}) {
  const titleId = useId();
  const c = r.content;
  // The organisation's clock: the rollup's own zone when the server sends it, else the page's.
  const tz = c?.timeZone ?? r.timeZone ?? timeZone;
  const cutoff = clockOf(c?.cutoffAt ?? r.cutoffAt, tz);
  // The whole card is where a rollup is read: opening it marks it seen.
  useEffect(() => { if (!compact && !r.seen && r.status === "sent") markRollupSeen(orgSlug, r.id); }, [compact, orgSlug, r.id, r.seen, r.status]);
  useEffect(() => {
    if (!highlight || !id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight, id]);

  const headline = c ? rollupHeadline(c, tz) : noRollupWords(r, cutoff);

  if (compact) {
    const blockers = c?.blockers.length ?? 0;
    return (
      <div id={id} className={cn("card-panel flex min-w-0 items-center gap-3 px-3 py-2.5", className)}>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-foreground">{r.team.name} standup</p>
          <p className="break-words text-meta font-normal text-secondary">
            {headline}{blockers ? ` ${blockers === 1 ? "1 blocker" : `${blockers} blockers`} named.` : ""}
          </p>
        </div>
        <Link href={r.href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")} aria-label={`Open the ${r.team.name} standup rollup`}>
          Open<AnimatedArrowUpRight aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <article id={id} tabIndex={id ? -1 : undefined} aria-labelledby={titleId}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border-accent-ring", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-[1_1_14rem]">
          <h3 id={titleId} className="break-words text-sm font-semibold text-foreground">{R.title(r.team.name, r.dateLabel)}</h3>
          <p className="mt-0.5 text-sm font-normal text-secondary">{headline}</p>
        </div>
        {r.status === "open" ? <Badge className="shrink-0">Collecting</Badge> : r.status === "skipped" ? <Badge className="shrink-0">No rollup</Badge> : null}
      </div>
      {c && r.status === "sent" ? <RollupLists orgSlug={orgSlug} content={c} timeZone={tz} /> : null}
    </article>
  );
}
