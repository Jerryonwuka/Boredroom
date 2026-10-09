"use client";

/**
 * The Commitments page's list and its filters (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops
 * closed", workspace commitments; contract H.4). The rows are `CommitmentView`s the server read as the viewer: their own
 * ("My commitments": what they owe and what they asked, every status), their teams' (leads) or everyone's (the owner and
 * HR), where a supervisor only ever gets accepted ones (open, overdue, done) and reads the message's words only when they
 * are in that conversation (otherwise "—" with why).
 *
 * - `CommitmentFilterBar`: the person (`Select`, team and everyone), the status (`Segmented`: All, Waiting, Open, Overdue,
 *   Done, Declined, Not a commitment on "My commitments"; All, Open, Overdue, Done for the others) and "This week"
 *   (`Checkbox`). Each change moves the address (`?person=`, `?status=`, `?week=1`), so a filtered list can be linked.
 * - `CommitmentsTable`: on a wide screen a `DataTable` (What, Who, Asked by, Where, Due, Status, and a row menu: Message,
 *   To-do, Mark done, Answer); under 640px a `<ul>` of rows ("Ben Okafor, asked by Olu, #Design", the due date and the
 *   badge) with the same menu, so nothing scrolls sideways. `?c=` marks one row (the 2px orange marker) and scrolls to
 *   it. "Show more" appends older pages (`nextBefore`). "Answer" opens the commitment's own card in a sheet (Add to my
 *   to-dos, Decline, Not a commitment), the same card as in "Between assistants".
 *
 * An overdue date carries the red dot beside it (components/app/due: never red text) and the status badge says
 * "Overdue" in words. No orange of its own beyond the selected row's marker and the segmented control's dot.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EllipsisVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { DataTable } from "@/components/ui/table";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import { Alert } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { OverdueDot } from "@/components/app/due";
import { CommitmentCard } from "@/components/app/commitment-card";
import { api, isApiFailure } from "@/lib/api-client";
import { clip } from "@/lib/follow-ups";
import { LOOP_WORDS, type CommitmentFilters, type CommitmentList, type CommitmentScope, type CommitmentView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const P = LOOP_WORDS.page;
export type StatusFilter = NonNullable<CommitmentFilters["status"]>;

const MINE_STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "waiting", label: "Waiting" }, { value: "open", label: "Open" }, { value: "overdue", label: P.filters.overdue },
  { value: "done", label: "Done" }, { value: "declined", label: "Declined" }, { value: "dismissed", label: LOOP_WORDS.label.dismissed },
];
const TEAM_STATUSES = MINE_STATUSES.filter((s) => s.value === "all" || s.value === "open" || s.value === "overdue" || s.value === "done");
/**
 * The statuses a scope can filter by (a supervisor never sees waiting, declined or dismissed ones). Client-side only: the
 * page (a server component) keeps its own copy of the rule, since a "use client" module's functions cannot run there.
 */
const statusesFor = (scope: CommitmentScope) => (scope === "mine" ? MINE_STATUSES : TEAM_STATUSES);

/** The page's address with these filters (the tab kept; empty ones left out). */
function commitmentsHref(base: string, f: { tab: string; person?: string | null; status?: StatusFilter; week?: boolean; c?: string | null }): string {
  const q = new URLSearchParams();
  if (f.tab !== "mine") q.set("tab", f.tab);
  if (f.person) q.set("person", f.person);
  if (f.status && f.status !== "all") q.set("status", f.status);
  if (f.week) q.set("week", "1");
  if (f.c) q.set("c", f.c);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export function CommitmentFilterBar({ base, scope, person, status, week, people }: {
  /** The page's own path (/app/{slug}/commitments). */ base: string;
  scope: CommitmentScope; person: string | null; status: StatusFilter; week: boolean;
  people: CommitmentList["people"];
}) {
  const router = useRouter();
  const id = useId();
  const go = (next: Partial<{ person: string | null; status: StatusFilter; week: boolean }>) =>
    router.push(commitmentsHref(base, { tab: scope, person, status, week, ...next }), { scroll: false });
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
      {scope !== "mine" ? (
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={`${id}-person`} className="text-xs font-medium text-subtle">{P.filters.person}</label>
          <Select id={`${id}-person`} fieldSize="sm" className="w-auto max-w-[min(16rem,70vw)]" value={person ?? ""} onChange={(e) => go({ person: e.target.value || null })}>
            <option value="">{P.filters.everyone}</option>
            {people.map((p) => <option key={p.membershipId} value={p.membershipId}>{p.name}</option>)}
          </Select>
        </div>
      ) : null}
      {/* Seven statuses do not fit a phone in one row (review, 9 October 2026): a Select below 640px, the Segmented above. */}
      <div className="flex min-w-0 max-w-full items-center gap-2 max-sm:hidden">
        <span id={`${id}-status`} aria-hidden className="text-xs font-medium text-subtle">{P.filters.status}</span>
        <Segmented aria-label={P.filters.status} value={status} onChange={(v) => go({ status: v as StatusFilter })}
          options={statusesFor(scope).map((s) => ({ value: s.value, label: s.label }))} className="max-w-full" />
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:hidden">
        <label htmlFor={`${id}-status-select`} className="text-xs font-medium text-subtle">{P.filters.status}</label>
        <Select id={`${id}-status-select`} fieldSize="sm" className="w-auto" value={status} onChange={(e) => go({ status: e.target.value as StatusFilter })}>
          {statusesFor(scope).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </div>
      <Checkbox checked={week} onChange={(e) => go({ week: e.target.checked })}>{P.filters.thisWeek}</Checkbox>
    </div>
  );
}

const DASH = <span aria-hidden className="text-subtle">—</span>;

/** "You", or the person's name. */
function who(c: CommitmentView): string {
  return c.viewer === "committer" ? "You" : c.committer.name;
}
function askedBy(c: CommitmentView): string | null {
  if (!c.asker) return null;
  return c.viewer === "asker" ? "You" : c.asker.name;
}
/** "#Design", "Everyone", "Design team" as the server names it; null when the viewer cannot read it. */
function whereName(c: CommitmentView): string | null {
  return c.where.name;
}

function DueCell({ c }: { c: CommitmentView }) {
  if (!c.dueLabel) return c.dueWords ? <span className="text-secondary">“{c.dueWords}”</span> : DASH;
  const overdue = c.display === "overdue";
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {overdue ? <><OverdueDot /><span className="sr-only">Overdue, was due </span></> : null}{c.dueLabel}
    </span>
  );
}

function WhereCell({ c }: { c: CommitmentView }) {
  const name = whereName(c);
  if (!name) return <span className="text-subtle" title={P.noMessage}>—<span className="sr-only">{P.noMessage}</span></span>;
  if (!c.message.href || c.message.withdrawn) return <span className="text-secondary" title={c.message.withdrawn ? P.withdrawn : undefined}>{name}</span>;
  return <Link href={c.message.href} prefetch={false} className="link-inline">{name}</Link>;
}

export function CommitmentsTable({ orgSlug, scope, filters, initial, timeZone, now, highlight = null }: {
  orgSlug: string; scope: CommitmentScope;
  /** What the first page was read with (for "Show more"). */ filters: { person: string | null; status: StatusFilter; week: boolean };
  initial: { items: CommitmentView[]; nextBefore: string | null };
  timeZone: string; now: number; highlight?: string | null;
}) {
  const router = useRouter();
  const [older, setOlder] = useState<CommitmentView[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, CommitmentView>>({});
  const [answering, setAnswering] = useState<CommitmentView | null>(null);
  const next = cursor === undefined ? initial.nextBefore : cursor;
  const seen = new Set(initial.items.map((c) => c.id));
  const items = [...initial.items, ...older.filter((c) => !seen.has(c.id))].map((c) => changed[c.id] && changed[c.id].status !== c.status ? changed[c.id] : c);

  useEffect(() => {
    if (!highlight) return;
    // Both layouts carry the row; the one on screen is the one with a box.
    const el = [document.getElementById(`commitment-row-${highlight}`), document.getElementById(`commitment-item-${highlight}`)].find((x) => x && x.getClientRects().length);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [highlight]);

  async function load() {
    if (!next || loading) return;
    setLoading(true); setFailure(null);
    try {
      const q = new URLSearchParams({ scope, status: filters.status, before: next, limit: "50" });
      if (filters.person) q.set("person", filters.person);
      if (filters.week) q.set("week", "1");
      const r = await api<CommitmentList>(`/api/orgs/${orgSlug}/commitments?${q}`, { retries: 1 });
      setOlder((cur) => [...cur, ...r.items.filter((x) => !cur.some((y) => y.id === x.id))]);
      setCursor(r.nextBefore);
    } catch (err) {
      setFailure(isApiFailure(err) && err.error.status < 500 ? err.error.message : "Could not load more. Check your connection and try again.");
    } finally { setLoading(false); }
  }

  async function markDone(c: CommitmentView) {
    try {
      const r = await api<{ commitment: CommitmentView }>(`/api/orgs/${orgSlug}/commitments/${c.id}/done`, { method: "POST", retries: 1 });
      setChanged((cur) => ({ ...cur, [c.id]: r.commitment }));
      notify(`Marked “${clip(c.title, 60)}” done.`, { tone: "success" });
      router.refresh();
    } catch (err) {
      notify(isApiFailure(err) && err.error.status < 500 ? err.error.message : "That didn't go through. Try again.", { tone: "danger" });
    }
  }

  const menu = (c: CommitmentView) => {
    const any = c.message.href || c.todo || c.canMarkDone || c.canAccept || c.canDecline || c.canDismiss;
    if (!any) return null;
    return (
      <Menu align="end" label={`Actions for “${clip(c.title, 60)}”`}
        trigger={<IconButton aria-label={`Actions for “${clip(c.title, 60)}”`}><EllipsisVertical aria-hidden /></IconButton>}>
        {c.canAccept || c.canDecline || c.canDismiss ? <MenuItem onSelect={() => setAnswering(c)}>Answer…</MenuItem> : null}
        {c.message.href && !c.message.withdrawn ? <MenuItem href={c.message.href}>{P.openMessage}</MenuItem> : null}
        {c.todo ? <MenuItem href={c.todo.href}>{P.openTodo}</MenuItem> : null}
        {c.canMarkDone ? <MenuItem onSelect={() => void markDone(c)}>{P.markDone}</MenuItem> : null}
      </Menu>
    );
  };

  return (
    <div className="space-y-4">
      {/* Wide: the table. */}
      <DataTable caption={LOOP_WORDS.page.title} className="max-sm:hidden">
        <thead>
          <tr>
            <th>{P.columns.what}</th><th>{P.columns.who}</th><th>{P.columns.askedBy}</th><th>{P.columns.where}</th><th>{P.columns.due}</th><th>{P.columns.status}</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} id={`commitment-row-${c.id}`} className={cn(highlight === c.id && "selected-marker bg-fill-1")}>
              <td className="wrap min-w-48"><span className="line-clamp-2 break-words font-medium">{c.title}</span>{c.stalled && c.display === "overdue" ? <span className="block text-meta text-secondary">No progress since it was due</span> : null}</td>
              <td className="nowrap">{who(c)}</td>
              <td className="nowrap">{askedBy(c) ?? DASH}</td>
              <td className="nowrap"><WhereCell c={c} /></td>
              <td className="nowrap"><DueCell c={c} /></td>
              <td className="nowrap"><Badge tone={c.badge.tone}>{c.badge.label}</Badge></td>
              <td className="nowrap text-right">{menu(c)}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {/* Under 640px: one row each, nothing sideways. */}
      <ul className="-mx-2 space-y-1 sm:hidden" aria-label={LOOP_WORDS.page.title}>
        {items.map((c) => {
          const line = [who(c), askedBy(c) ? `asked by ${askedBy(c)}` : null, whereName(c)].filter(Boolean).join(", ");
          return (
            <li key={c.id} id={`commitment-item-${c.id}`} className={cn("flex min-w-0 items-start gap-2 rounded-xl px-2 py-3", highlight === c.id && "selected-marker bg-fill-1")}>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-medium text-foreground">{c.title}</p>
                <p className="mt-0.5 break-words text-meta font-normal text-secondary">{line}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-meta font-normal text-secondary">
                  <Badge tone={c.badge.tone}>{c.badge.label}</Badge>
                  {c.dueLabel ? <span>Due <DueCell c={c} /></span> : null}
                </p>
              </div>
              <div className="shrink-0">{menu(c)}</div>
            </li>
          );
        })}
      </ul>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {next ? <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>{P.showMore}</Button> : null}
      <p role="status" aria-live="polite" className="sr-only">{older.length ? `Showing ${items.length}` : ""}</p>
      {answering ? (
        <Sheet open size="sm" onClose={() => setAnswering(null)} title={LOOP_WORDS.page.title}>
          <CommitmentCard orgSlug={orgSlug} view={changed[answering.id] ?? answering} timeZone={timeZone} now={now}
            onChange={(v) => setChanged((cur) => ({ ...cur, [v.id]: v }))} />
        </Sheet>
      ) : null}
    </div>
  );
}
