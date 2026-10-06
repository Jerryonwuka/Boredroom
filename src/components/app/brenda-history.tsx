"use client";

/**
 * Past chats (owner decision, 5 October 2026): every conversation with Brenda, the most recently active first, in a
 * column beside her chat (not a tab of its own), so moving between conversations is one press. Each row says what it
 * was about (the first thing asked), how it ended and when it was last active; pressing it carries the conversation on
 * in place, and the open one is lit. Each can be deleted for good: it leaves the list at once, and comes back with a
 * word if the delete does not go through. A search narrows the list. Private to the person, which the list says.
 *
 * v4 (6 October 2026): the column is styled like the spec's sub-navigation. A 50px title row that lines up with her
 * chat header, a 32px search field, then rows of r8 with 8px sides: the title 14/20 medium, the preview 13/19.5 in the
 * secondary grey, the time 12/16 subtle. The open row is fill-1 with the 2px orange marker on its left edge (accent
 * rules, 6 October 2026: the chosen sub-nav item), a hovered one fill-0; Delete (a 28px ghost icon
 * button) shows on the open row, under the pointer and on focus, and always on touch screens.
 */
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Lock, MessagesSquare, Search, Trash2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { CountPill } from "@/components/ui/badge";
import { Alert, EmptyState } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { cn, relativeTime } from "@/lib/utils";
import type { ConversationSummary } from "@/server/services/brenda-history";

// The clock for "last active", to the minute. The server's minute is used while the page hydrates, so both render the
// same words; afterwards it moves on by itself.
const subscribeMinute = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The clock "last active" is measured against: the server's minute while hydrating, then the browser's. */
export function useMinuteClock(serverNow: number) {
  return useSyncExternalStore(subscribeMinute, thisMinute, () => serverNow);
}

/** "5m ago" within the week, then the date. */
export function lastActive(iso: string, now: number) {
  const t = Date.parse(iso);
  if (now - t < 7 * 86_400_000) return relativeTime(iso, now);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" }).format(t);
}

export function BrendaHistory({ conversations, now, currentId, opening, error, onOpen, onDelete, onStart, onClose, className }: {
  conversations: ConversationSummary[];
  /** The server's clock when the page rendered (to the minute). */
  now: number;
  /** The conversation open in the chat, if it is saved. */
  currentId: string | null;
  /** The row being fetched to carry on. */
  opening: string | null;
  error: string | null;
  onOpen: (id: string) => void;
  onDelete: (c: ConversationSummary) => void;
  /** The empty state's one next action: a new chat. */
  onStart: () => void;
  /** Small screens, where the list is a sheet over the chat: closes it. */
  onClose?: () => void;
  className?: string;
}) {
  const clock = useMinuteClock(now);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter((c) => `${c.title} ${c.preview}`.toLowerCase().includes(q)) : conversations;

  /** Deletes, then puts the focus on the row that took its place (or the next action when none is left). */
  function remove(c: ConversationSummary, index: number) {
    onDelete(c);
    requestAnimationFrame(() => {
      const rows = box.current?.querySelectorAll<HTMLElement>("[data-chat-row]");
      const target = rows?.length ? rows[Math.min(index, rows.length - 1)] : box.current?.querySelector<HTMLElement>("[data-chat-start], input");
      target?.focus();
    });
  }

  return (
    <div ref={box} className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex h-[50px] shrink-0 items-center justify-between gap-2 border-b border-border pl-5 pr-3">
        <h2 id={`${uid}-title`} className="flex items-center gap-2 text-sm font-semibold text-foreground">Past chats<CountPill count={conversations.length} /></h2>
        {onClose ? <IconButton aria-label="Close past chats" onClick={onClose} className="lg:hidden"><X aria-hidden /></IconButton> : null}
      </div>
      {conversations.length ? (
        <div role="search" className="px-3 pb-2 pt-3">
          <label className="field field-sm field-adorned">
            <Search aria-hidden />
            <span className="sr-only">Search past chats</span>
            <input type="search" autoComplete="off" enterKeyHint="search" maxLength={200} placeholder="Search chats" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }} />
          </label>
        </div>
      ) : null}
      <Presence show={!!error}><Alert tone="danger" className="mx-3 mb-2">{error}</Alert></Presence>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
        {shown.length ? (
          <ul aria-labelledby={`${uid}-title`} className="space-y-0.5">
            {shown.map((c, i) => {
              const busy = opening === c.id;
              const current = currentId === c.id;
              return (
                <li key={c.id} className="group relative">
                  <button type="button" data-chat-row aria-describedby={`${uid}-${c.id}`} aria-busy={busy || undefined} aria-current={current || undefined}
                    onClick={() => onOpen(c.id)}
                    className={cn("block w-full rounded-lg py-2 pl-2 pr-9 text-left transition-colors duration-75 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
                      current ? "selected-marker bg-fill-1" : "hover:bg-fill-0")}>
                    <span className="block truncate text-sm font-medium text-foreground">{c.title}</span>
                    <span id={`${uid}-${c.id}`} className="block truncate text-meta font-normal text-secondary">
                      {current ? <span className="sr-only">Open now. </span> : null}{c.preview || "No reply yet"}
                      <span className="sr-only" suppressHydrationWarning>. Last active {lastActive(c.updatedAt, clock)}, {c.messageCount} messages.</span>
                    </span>
                    {/* A date (older than a week) is written in the browser's time zone, which the server may not share. */}
                    <time dateTime={c.updatedAt} aria-hidden className={cn("mt-0.5 block text-xs font-normal text-subtle", busy && "brenda-shimmer")} suppressHydrationWarning>{busy ? "Opening…" : lastActive(c.updatedAt, clock)}</time>
                  </button>
                  {/* Shown on the open row, under the pointer and on focus; always on touch screens. */}
                  <ConfirmButton variant="ghost" size="icon-xs" aria-label={`Delete ${c.title}`} data-tip="Delete"
                    className={cn("absolute right-1 top-1.5 transition-opacity duration-75 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100", current ? "opacity-100" : "opacity-0")}
                    title="Delete this chat?" description={<>&ldquo;{c.title}&rdquo; and everything in it will be deleted for good. This cannot be undone.</>}
                    confirmLabel="Delete chat" pendingLabel="Deleting…" onConfirm={() => remove(c, i)}>
                    <Trash2 aria-hidden />
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        ) : conversations.length ? (
          <p role="status" className="px-2 py-6 text-center text-sm font-normal text-secondary">No chats match &ldquo;{query.trim()}&rdquo;.</p>
        ) : (
          <EmptyState compact icon={MessagesSquare} title="No past chats yet"
            description="Every conversation with Brenda is kept here, only for you, so you can carry on where you left off."
            action={<button type="button" data-chat-start onClick={onStart} className={buttonVariants({ variant: "secondary", size: "sm" })}>Start a chat</button>} />
        )}
      </div>

      <p className="flex shrink-0 items-center gap-1.5 border-t border-border px-5 py-3 text-xs font-normal text-subtle"><Lock className="size-3.5" aria-hidden />Only you can see these</p>
    </div>
  );
}
