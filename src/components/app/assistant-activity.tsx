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
 * Settings → Your assistant shows the latest five (`AssistantActivityCard`) with "See everything", and beside it
 * "Between assistants": the inbox of follow-ups, messages and requests between the person's assistant and other
 * people's (owner decisions, 8 October 2026: personal assistants, phases 4 and 6).
 *
 * Reads are the person's alone (review, 8 October 2026): owners and HR see the assistant's actions organisation-wide,
 * never what it read for someone, and while an administrator is signed in as the person the list leaves reads out.
 *
 * Act without asking (owner decision, 8 October 2026): what the assistant did when the person asked in their own chat and
 * nobody pressed Confirm (`auto`) reads "done without asking", with the done disc.
 *
 * On your Mac (owner request and permission rule, 12 October 2026: "Brenda cannot take any action except I explicitly
 * give an instruction … do you want me to do this? And then I'll say, yes"; contract D.11, E.6): each on-screen task and
 * file job the person asked Brenda for Mac for, and what became of it, is a row (`source: "mac"`, id `task:<id>`): "You
 * said no: …", "Stopped: …", the summary when done, "In progress: …" while it runs. Its meta line says how the yes was
 * given ("14:02, on your Mac, you pressed Yes" / "you said yes" / "you typed yes"), "no answer" when none came, or "in
 * progress". Only the person ever sees these rows (never owners or HR, never while someone is signed in as them), they
 * go after 30 days, and "Forget" deletes one now (a confirm first, then the toast "Forgotten."). A live task can't be
 * forgotten: it is stopped from the Mac. Pictures, steps and file contents are never kept anywhere, so never shown.
 *
 * Brenda and her helpers (owner brief, 12 October 2026: "the person's request is the record"; contract N.3, S.9): each
 * request the person made on their Mac is a row too (id `request:<id>`, tool mac_request): what she did ("Opened Figma";
 * "Started a job: Organise your Desktop", which opens Jobs; "You said no"; "Undone") with "You asked: “…”" under it, and
 * Forget (the request, and its job when it started one; refused while that job runs).
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlarmClock, Check, Eye, ShieldCheck, Undo2, X } from "lucide-react";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Alert, EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { SettingsFooter, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { ACT_WORDS } from "@/lib/act-mode";
import { ACT_WORDS as MAC_ACT_WORDS } from "@/lib/act";
import { cn } from "@/lib/utils";
import type { ActivityItem, ActivityKind, ActivityPage } from "@/server/services/assistant-activity";

const LOAD_FAILED = "Could not load more. Check your connection and try again.";

// ---- On your Mac (phase 2, owner rule, 12 October 2026; contract D.11, E.6) ---------------------------------------------

/**
 * The words of the Mac's rows (contract E.6; `name`: the person's own assistant): the shared ones from `ACT_WORDS.activity`
 * (lib/act, the server's), and the three only this list uses (the Forget confirm and the empty tab).
 */
const MAC_SHARED = MAC_ACT_WORDS.activity;
export const MAC_WORDS = {
  tab: MAC_SHARED.filter,
  where: MAC_SHARED.onYourMac,
  via: MAC_SHARED.via,
  noAnswer: MAC_SHARED.noAnswer,
  live: MAC_SHARED.inProgress,
  forget: MAC_SHARED.forget,
  forgetLabel: MAC_SHARED.forgetLabel,
  forgotten: MAC_SHARED.forgotten,
  pageNote: MAC_SHARED.note,
  forgetTitle: "Forget this?",
  forgetDescription: (name: string) => `It goes from your Activity now. Whatever ${name} did on your Mac stays done.`,
  // Permission rule v2 (owner, 12 October 2026): the request is the go-ahead for routine things, so no "say yes" here.
  empty: (name: string) => `When you ask ${name} to do something on your Mac, it's listed here.`,
  asked: (words: string) => `You asked: “${words}”`,
} as const;

export type MacVia = "button" | "voice" | "typed";
/** What the rows of a Mac task need; `via` and `live` are read wherever the server puts them (top level or `detail`). */
type MacRowLike = { id: string; source: string; summary: string; outcome: string };

/** A row about something Brenda for Mac did (a screen task or a file job). */
export const isMacItem = (item: { source: string }): boolean => item.source === "mac";

/** The task's own id from a row's id ("task:<uuid>"), or null for any other row. */
/** A request's own id from a row's id ("request:<uuid>"), or null for any other row (Brenda and her helpers, contract N.3). */
export function requestIdOf(id: string): string | null {
  const m = /^request:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(id);
  return m ? m[1] : null;
}

export function taskIdOf(id: string): string | null {
  const m = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(id);
  return m ? m[1] : null;
}

function field(item: object, key: string): unknown {
  const top = (item as Record<string, unknown>)[key];
  if (top !== undefined && top !== null) return top;
  const detail = (item as { detail?: unknown }).detail;
  return detail && typeof detail === "object" ? (detail as Record<string, unknown>)[key] : undefined;
}

/** How the person said yes (button, voice, typed), or null when there was no yes. */
export function macVia(item: MacRowLike): MacVia | null {
  const v = field(item, "via");
  return v === "button" || v === "voice" || v === "typed" ? v : null;
}

/**
 * Where a Mac task stands, for its disc: still running ("In progress: …", or a `live` flag), done, ended without doing it
 * (no, no clear yes, no answer, stopped, file not found: `refused`), or failed (couldn't finish).
 */
export function macState(item: MacRowLike): "live" | "done" | "ended" | "failed" {
  if (field(item, "live") === true || item.summary.startsWith("In progress: ")) return "live";
  if (item.outcome === "failed") return "failed";
  if (item.outcome === "refused") return "ended";
  return "done";
}

/** The meta line after the time: "on your Mac, you pressed Yes", "on your Mac, no answer", "on your Mac, in progress". */
export function macMeta(item: MacRowLike): string {
  const state = macState(item);
  if (state === "live") return `${MAC_WORDS.where}, ${MAC_WORDS.live}`;
  const via = macVia(item);
  if (via) return `${MAC_WORDS.where}, ${MAC_WORDS.via[via]}`;
  // actSummary's words for a proposal nobody answered (contract D.11: expired → "No answer: …").
  if (item.summary.startsWith("No answer: ")) return `${MAC_WORDS.where}, ${MAC_WORDS.noAnswer}`;
  return MAC_WORDS.where;
}

/** Whether "Forget" is offered: the person's own ended Mac row, while they are signed in as themself. */
export function canForget(item: MacRowLike, impersonated: boolean): boolean {
  return !impersonated && isMacItem(item) && (!!taskIdOf(item.id) || !!requestIdOf(item.id)) && macState(item) !== "live";
}
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

/** How a row went, in words for its meta line, and its disc. A read is always "read for you"; one done without asking says so. */
function look(item: ActivityItem): { label: string; disc: string; icon: React.ReactNode } {
  const icon = "size-3.5";
  if (isMacItem(item)) {
    // Mac tasks (12 October 2026): a said-no or stopped task isn't a refusal by the workspace, so its disc is neutral; one
    // still running has the live dot (orange marks what is live: the accent rules).
    const state = macState(item);
    const label = macMeta(item);
    if (state === "live") return { label, disc: "bg-fill-1", icon: <span className="size-2 rounded-full bg-accent" /> };
    if (state === "failed") return { label, disc: "bg-danger/12 text-danger", icon: <X className={icon} aria-hidden /> };
    if (state === "ended") return { label, disc: "bg-fill-1 text-secondary", icon: <X className={icon} aria-hidden /> };
    return { label, disc: "bg-success/12 text-success", icon: <Check className={icon} aria-hidden /> };
  }
  if (item.source === "read") return { label: "read for you", disc: "bg-fill-1 text-secondary", icon: <Eye className={icon} aria-hidden /> };
  if (item.outcome === "refused") return { label: "not allowed", disc: "bg-danger/12 text-danger", icon: <X className={icon} aria-hidden /> };
  if (item.outcome === "failed") return { label: "failed", disc: "bg-danger/12 text-danger", icon: <X className={icon} aria-hidden /> };
  if (item.source === "automatic") return { label: "automatic", disc: "bg-fill-1 text-secondary", icon: <AlarmClock className={icon} aria-hidden /> };
  // An Undo the person pressed keeps the auto marker when what it undid ran without asking: it reads as an undo.
  if (item.tool === "undo") return { label: ACT_WORDS.log.undoneByYou, disc: "bg-fill-1 text-secondary", icon: <Undo2 className={icon} aria-hidden /> };
  if (item.auto) return { label: ACT_WORDS.log.label, disc: "bg-success/12 text-success", icon: <Check className={icon} aria-hidden /> };
  if (item.outcome === "confirmed") return { label: "confirmed by you", disc: "bg-success/12 text-success", icon: <ShieldCheck className={icon} aria-hidden /> };
  return { label: "done", disc: "bg-success/12 text-success", icon: <Check className={icon} aria-hidden /> };
}

/**
 * One thing the assistant did or read: the disc, the summary, the meta line (`day` first where there are no day headings)
 * and Open on the row's right when it has a page. The summary wraps on a phone; Open stays beside it.
 */
export function ActivityRow({ item, timeZone, day, id, orgSlug, name, impersonated = false, onForgotten }: {
  item: ActivityItem; timeZone: string; day?: string; id?: string;
  /** For a Mac row's Forget: where to delete it, whose assistant it was, and what to do once it has gone. */
  orgSlug?: string; name?: string; impersonated?: boolean; onForgotten?: (id: string) => void;
}) {
  const summaryId = useId();
  const l = look(item);
  const taskId = taskIdOf(item.id);
  const requestId = requestIdOf(item.id);
  const forgetPath = taskId ? `/brenda/activity/tasks/${encodeURIComponent(taskId)}` : requestId ? `/brenda/activity/requests/${encodeURIComponent(requestId)}` : null;
  const forget = orgSlug && onForgotten && forgetPath && canForget(item, impersonated) ? (
    <ConfirmButton variant="ghost" size="xs" className="shrink-0" aria-label={MAC_WORDS.forgetLabel(item.asked ? MAC_WORDS.asked(item.asked) : item.summary)}
      title={MAC_WORDS.forgetTitle} description={MAC_WORDS.forgetDescription(name ?? "Brenda")} confirmLabel={MAC_WORDS.forget} pendingLabel="Forgetting…"
      onConfirm={async () => {
        await api(`/api/orgs/${orgSlug}${forgetPath}`, { method: "DELETE", retries: 1 });
        notify(MAC_WORDS.forgotten, { tone: "success" });
        onForgotten(item.id);
      }}>
      {MAC_WORDS.forget}
    </ConfirmButton>
  ) : null;
  return (
    <li id={id} tabIndex={id ? -1 : undefined} className="flex items-start gap-3 rounded-lg py-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
      <span aria-hidden className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", l.disc)}>{l.icon}</span>
      <span className="min-w-0 flex-1">
        <span id={summaryId} className="block break-words font-medium text-foreground">{item.summary}</span>
        {item.asked ? <span className="block truncate text-meta font-normal text-secondary">{MAC_WORDS.asked(item.asked)}</span> : null}
        <span className="block text-meta font-normal text-secondary">
          {day ? `${day}, ` : ""}<span className="tabular-nums">{timeOf(item.createdAt, timeZone)}</span>, {l.label}
        </span>
      </span>
      {item.href ? (
        <Link href={item.href} aria-describedby={summaryId} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "shrink-0")}>Open<AnimatedArrowUpRight aria-hidden /></Link>
      ) : null}
      {forget}
    </li>
  );
}

// Keyed by string, so the Mac's tab ("mac", contract D.11) reads the same whether or not the kinds list carries it yet.
const TAB_EMPTY = (name: string, page: Pick<ActivityPage, "readsAvailable" | "readsHidden">): Record<string, string> => ({
  all: `When ${name} does something for you, or reads your messages to catch you up, it's listed here.`,
  actions: `${name} hasn't done anything for you yet.`,
  reads: page.readsHidden ? `What ${name} read is hidden while someone else is signed in as this person.`
    : !page.readsAvailable ? "Reads appear here after the next database update."
    : `${name} hasn't read any messages for you yet. Ask “What did I miss?”`,
  problems: `Everything ${name} tried went through.`,
  mac: MAC_WORDS.empty(name),
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
  const listRef = useRef<HTMLDivElement>(null);
  // A forgotten Mac row goes from the list; the focus moves to the list's first row (or the status line), never to the body.
  const forgotten = (gone: string) => {
    setItems((list) => list.filter((i) => i.id !== gone));
    setStatus(MAC_WORDS.forgotten);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>("li[tabindex]")?.focus());
  };
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
    const ask = canAsk && kind !== "problems" && (kind as string) !== "mac" && !(kind === "reads" && (initial.readsHidden || !initial.readsAvailable));
    return (
      <EmptyState icon3d="eye-checklist" title="Nothing yet" description={TAB_EMPTY(name, initial)[kind] ?? TAB_EMPTY(name, initial).all}
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
    <div ref={listRef} className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`activity-day-${g.key}`}>
          <h2 id={`activity-day-${g.key}`} className="mb-1 text-sm font-medium text-secondary">{dayHeading(g.key, today)}</h2>
          <ul className="space-y-1">
            {g.rows.map((item) => <ActivityRow key={item.id} id={`activity-${item.id}`} item={item} timeZone={timeZone}
              orgSlug={orgSlug} name={name} impersonated={initial.readsHidden} onForgotten={forgotten} />)}
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
 * line, there being no headings), or a line saying nothing has happened yet, then "Between assistants" (the inbox of
 * what passed between the person's assistant and other people's, phase 6) and "See everything".
 */
export function AssistantActivityCard({ orgSlug, timeZone, name, items: initial, now, impersonated = false }: { orgSlug: string; timeZone: string; name: string; items: ActivityItem[]; now: number; impersonated?: boolean }) {
  const today = dayKey(now, timeZone);
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setItems(initial); }
  return (
    <SettingsSection id="activity" title={`What ${name} did`} description={`The latest things ${name} did or read for you.`}>
      <SettingsGroup>
        <div className="px-5 py-3">
          {items.length ? (
            <ul className="space-y-1">
              {items.slice(0, 5).map((item) => <ActivityRow key={item.id} item={item} timeZone={timeZone} day={shortDay(dayKey(item.createdAt, timeZone), today)}
                orgSlug={orgSlug} name={name} impersonated={impersonated} onForgotten={(gone) => setItems((list) => list.filter((i) => i.id !== gone))} />)}
            </ul>
          ) : (
            <p className="py-2 text-sm font-normal text-secondary">Nothing yet. Everything {name} does or reads for you is listed here.</p>
          )}
        </div>
        <SettingsFooter>
          {/* Since phase 6 (owner decision, 8 October 2026) everything between assistants is one inbox. */}
          <Link href={`/app/${orgSlug}/home/assistants`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Between assistants</Link>
          <Link href={`/app/${orgSlug}/home/activity`} className={buttonVariants({ variant: "secondary", size: "sm" })}>See everything</Link>
        </SettingsFooter>
      </SettingsGroup>
    </SettingsSection>
  );
}
