"use client";

/**
 * "What Max did" (owner decision, 8 October 2026: personal assistants, phase 3): one place where a person sees everything
 * their own assistant did or read for them. Its actions (done, confirmed by them, automatic, not allowed, failed) and
 * the conversations it read to catch them up, newest first, grouped by the organisation's day under small headings
 * ("Today", "Yesterday", "Tuesday 6 October"). Rows are calm rows separated by space, as the action log in Settings →
 * Brenda: a 24px status disc, the summary (14/20 medium), a meta line in commas ("09:14, read for you") and an Open link
 * when the row has a page to go to.
 *
 * The page (`/home/activity`) renders the first 30 on the server; "Show more" fetches the next page from
 * `GET /api/orgs/{org}/brenda/activity` by its opaque cursor and appends it, and a polite status says how many show.
 * Settings → Your assistant shows the latest five (`AssistantActivityCard`) with "See everything", and beside it "Asked
 * about you": every follow-up about the person's work and what their assistant shared (owner decision, 8 October 2026:
 * personal assistants, phase 4).
 *
 * Reads are the person's alone (review, 8 October 2026): owners and HR see the assistant's actions organisation-wide,
 * never what it read for someone, and while an administrator is signed in as the person the list leaves reads out.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, Check, Eye, ShieldCheck, X } from "lucide-react";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { SettingsFooter, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ActivityItem, ActivityKind, ActivityPage } from "@/server/services/assistant-activity";

const LOAD_FAILED = "Could not load more. Check your connection and try again.";
const CATCH_UP_ASK = "What did I miss in Messages? Catch me up.";

/** The day an instant falls on in the organisation's time zone, as YYYY-MM-DD. */
function dayKey(at: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** YYYY-MM-DD, one day earlier. */
function dayBefore(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", else "Tuesday 6 October" (the year too when it is not this one). */
function dayHeading(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === dayBefore(today)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Today", "Yesterday", else "Tue 6 Oct": the day in a row's meta line where there are no day headings (Settings). */
function shortDay(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === dayBefore(today)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function timeOf(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

/** How a row went, in words for its meta line, and its disc. A read is always "read for you". */
function look(item: ActivityItem): { label: string; disc: string; icon: React.ReactNode } {
  const icon = "size-3.5";
  if (item.source === "read") return { label: "read for you", disc: "bg-fill-1 text-secondary", icon: <Eye className={icon} aria-hidden /> };
  if (item.outcome === "refused") return { label: "not allowed", disc: "bg-danger/12 text-danger", icon: <X className={icon} aria-hidden /> };
  if (item.outcome === "failed") return { label: "failed", disc: "bg-danger/12 text-danger", icon: <X className={icon} aria-hidden /> };
  if (item.source === "automatic") return { label: "automatic", disc: "bg-fill-1 text-secondary", icon: <AlarmClock className={icon} aria-hidden /> };
  if (item.outcome === "confirmed") return { label: "confirmed by you", disc: "bg-success/12 text-success", icon: <ShieldCheck className={icon} aria-hidden /> };
  return { label: "done", disc: "bg-success/12 text-success", icon: <Check className={icon} aria-hidden /> };
}

/**
 * One thing the assistant did or read: the disc, the summary, the meta line (`day` first where there are no day headings)
 * and Open on the row's right when it has a page. The summary wraps on a phone; Open stays beside it.
 */
export function ActivityRow({ item, timeZone, day, id }: { item: ActivityItem; timeZone: string; day?: string; id?: string }) {
  const summaryId = useId();
  const l = look(item);
  return (
    <li id={id} tabIndex={id ? -1 : undefined} className="flex items-start gap-3 rounded-lg py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
      <span aria-hidden className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", l.disc)}>{l.icon}</span>
      <span className="min-w-0 flex-1">
        <span id={summaryId} className="block break-words font-medium text-foreground">{item.summary}</span>
        <span className="block text-meta font-normal text-secondary">
          {day ? `${day}, ` : ""}<span className="tabular-nums">{timeOf(item.createdAt, timeZone)}</span>, {l.label}
        </span>
      </span>
      {item.href ? (
        <Link href={item.href} aria-describedby={summaryId} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "shrink-0")}>Open<AnimatedArrowUpRight aria-hidden /></Link>
      ) : null}
    </li>
  );
}

const TAB_EMPTY = (name: string, page: Pick<ActivityPage, "readsAvailable" | "readsHidden">): Record<ActivityKind, string> => ({
  all: `When ${name} does something for you, or reads your messages to catch you up, it's listed here.`,
  actions: `${name} hasn't done anything for you yet.`,
  reads: page.readsHidden ? `What ${name} read is hidden while someone else is signed in as this person.`
    : !page.readsAvailable ? "Reads appear here after the next database update."
    : `${name} hasn't read any messages for you yet. Ask “What did I miss?”`,
  problems: `Everything ${name} tried went through.`,
});

/**
 * The list on "What Max did": the first page from the server, more on "Show more". Rendered with `key={kind}` so a new
 * tab starts from its own first page. `now` is the server's clock when the page rendered, so "Today" reads the same on
 * both sides; `canAsk` is whether the plan includes the assistant (the empty state's "Ask Max" needs it).
 */
export function AssistantActivity({ orgSlug, timeZone, kind, initial, name, now, canAsk = true }: {
  orgSlug: string; timeZone: string; kind: ActivityKind; initial: ActivityPage; name: string; now: number; canAsk?: boolean;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const more = useRef<HTMLButtonElement>(null);
  // Where the focus goes once a page has arrived, if it was lost while the button was busy: back to "Show more", or to
  // the first new row when there is nothing more to show (the button has gone).
  const focusTo = useRef<string | null>(null);
  const base = `/app/${orgSlug}`;
  const today = dayKey(now, timeZone);

  useEffect(() => {
    if (loading) return;
    const target = focusTo.current;
    focusTo.current = null;
    const at = document.activeElement;
    if (target && (!at || at === document.body)) (target === "more" ? more.current : document.getElementById(target))?.focus();
  }, [items, loading]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true); setFailure(null);
    try {
      const q = new URLSearchParams({ kind, cursor, limit: "30" });
      const page = await api<ActivityPage>(`/api/orgs/${orgSlug}/brenda/activity?${q}`, { retries: 1 });
      // A row already shown (a page that overlapped) is not shown twice.
      const seen = new Set(items.map((i) => i.id));
      const fresh = page.items.filter((i) => !seen.has(i.id));
      const next = [...items, ...fresh];
      setItems(next); setCursor(page.nextCursor);
      setStatus(`Showing ${next.length}`);
      focusTo.current = page.nextCursor ? "more" : fresh[0] ? `activity-${fresh[0].id}` : null;
    } catch (err) {
      // A refusal (a page link that is no longer valid) says why; a fault or no answer is the plain line.
      setFailure(isApiFailure(err) && err.error.status < 500 ? err.error.message : LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    const askHref = kind === "reads" ? `${base}/home?ask=${encodeURIComponent(CATCH_UP_ASK)}` : `${base}/home`;
    const ask = canAsk && kind !== "problems" && !(kind === "reads" && (initial.readsHidden || !initial.readsAvailable));
    return (
      <EmptyState icon3d="eye-checklist" title="Nothing yet" description={TAB_EMPTY(name, initial)[kind]}
        action={ask ? <Link href={askHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>Ask {name}</Link>
          : kind !== "all" ? <Link href={`${base}/home/activity`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Show everything</Link> : null} />
    );
  }

  // Grouped by the organisation's day, in the order the rows came (newest first).
  const groups: { key: string; rows: ActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.createdAt, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(item); else groups.push({ key, rows: [item] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`activity-day-${g.key}`}>
          <h2 id={`activity-day-${g.key}`} className="mb-1 text-sm font-medium text-secondary">{dayHeading(g.key, today)}</h2>
          <ul className="space-y-1">
            {g.rows.map((item) => <ActivityRow key={item.id} id={`activity-${item.id}`} item={item} timeZone={timeZone} />)}
          </ul>
        </section>
      ))}
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {cursor ? <Button ref={more} variant="secondary" size="sm" loading={loading} onClick={() => void loadMore()}>Show more</Button> : null}
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
    </div>
  );
}

/**
 * Settings → Your assistant: the latest five things the assistant did or read for the person (the day in each row's meta
 * line, there being no headings), or a line saying nothing has happened yet, then "Asked about you" and "See everything".
 */
export function AssistantActivityCard({ orgSlug, timeZone, name, items, now }: { orgSlug: string; timeZone: string; name: string; items: ActivityItem[]; now: number }) {
  const today = dayKey(now, timeZone);
  return (
    <SettingsSection id="activity" title={`What ${name} did`} description={`The latest things ${name} did or read for you.`}>
      <SettingsGroup>
        <div className="px-5 py-3">
          {items.length ? (
            <ul className="space-y-1">
              {items.slice(0, 5).map((item) => <ActivityRow key={item.id} item={item} timeZone={timeZone} day={shortDay(dayKey(item.createdAt, timeZone), today)} />)}
            </ul>
          ) : (
            <p className="py-2 text-sm font-normal text-secondary">Nothing yet. Everything {name} does or reads for you is listed here.</p>
          )}
        </div>
        <SettingsFooter>
          <Link href={`/app/${orgSlug}/home/follow-ups/about-you`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Asked about you</Link>
          <Link href={`/app/${orgSlug}/home/activity`} className={buttonVariants({ variant: "secondary", size: "sm" })}>See everything</Link>
        </SettingsFooter>
      </SettingsGroup>
    </SettingsSection>
  );
}
