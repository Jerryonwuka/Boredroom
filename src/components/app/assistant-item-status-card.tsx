"use client";

/**
 * The live card under her reply in the chat once something went to another person's assistant (owner decision,
 * 8 October 2026: personal assistants, phase 6). In place of the plain done line, as the follow-up's card
 * (follow-up-status-card), for an action that carries `assistantItemId`:
 *
 * - both faces overlapping: the person's own assistant and the other person's (a note for the team report: theirs and
 *   the workspace's own);
 * - the title ("Message to Ben's Brenda", "Request to Ada's Brenda", "Note for today's team report") and the badge;
 * - what was sent (the words, or the request's summary), three lines with "Show all";
 * - where it stands, in one live line: "Delivered.", "Ben has seen it, 14:02.", "Ben replied: “…”", "Waiting for Ada.",
 *   "Ada accepted: to-do added.", "Ada declined: “…”", "Couldn't be done: …", "Expired: no answer from Ada.", "Goes in
 *   today's report at 18:00.", "In the report.";
 * - "Cancel request" or "Withdraw note" (ghost, asking first) while that is still possible.
 *
 * It reads `GET /api/orgs/{org}/assistant-items/{id}`, again (300 ms after the last one) when the workspace's change
 * stream names this item (a reply is a new row, so any new item also reads again while a message waits for one), and
 * every 30 s while it is still open and the tab is on screen. A failed read keeps the last state with a quiet "Couldn't
 * refresh" and Retry. Only the status line is a live region. Other people's words (a reply, a decline reason) are plain
 * text. Saved chats keep the card (the action's `assistantItemId` is saved with the conversation).
 *
 * Times are in the organisation's time zone where the caller knows it (her page), else this browser's (the drawer).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatedRefreshCw } from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/states";
import { AssistantFace, browserTimeZone } from "@/components/app/follow-up-exchange";
import { ItemBadge, isOpenRequest, itemNames, itemPreview, outcomeOf } from "@/components/app/assistant-item-card";
import { useAssistant } from "@/components/app/assistant-context";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import { api, isApiFailure } from "@/lib/api-client";
import { ASSISTANT_ITEM_WORDS, type AssistantItemView } from "@/lib/assistant-items";
import { cn } from "@/lib/utils";

const W = ASSISTANT_ITEM_WORDS;
const POLL_MS = 30_000;
const DEBOUNCE_MS = 300;
/** Longer than this (or with line breaks) offers "Show all" under the three-line clamp. */
const LONG = 180;

/** Still moving: a reply may come, a request is waiting or being done, a note is waiting for the report. */
function stillOpen(item: AssistantItemView): boolean {
  if (item.kind === "message") return !item.reply;
  if (item.kind === "request") return isOpenRequest(item) || item.status === "accepted";
  if (item.kind === "report_note") return item.status === "delivered";
  return item.status === "delivered";
}

/**
 * Worth the slow read: still open, except a message once it is seen or a day old (most never get a reply; the change
 * stream brings one when it comes). Saved chats hold many such cards (correctness review, 8 October 2026).
 */
function polls(item: AssistantItemView, now: number): boolean {
  if (!stillOpen(item)) return false;
  if (item.kind === "message") return item.status === "delivered" && now - Date.parse(item.createdAt) < 86_400_000;
  return true;
}

export function AssistantItemStatusCard({ orgSlug, itemId, timeZone, action, className }: {
  orgSlug: string; itemId: string;
  /** Called before a link here opens a page (the drawer closes first); the card has none of its own yet. */ onLeave?: () => void;
  /** The organisation's time zone; this browser's when not given. */ timeZone?: string;
  /** Beside the badge: the action row's Open button. */ action?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const { personal, workspace } = useAssistant();
  const [item, setItem] = useState<AssistantItemView | null>(null);
  const [failed, setFailed] = useState<"gone" | "refresh" | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const zone = timeZone ?? browserTimeZone();
  const bodyId = useId();
  // The newest read wins: an older answer arriving late does not overwrite a newer one.
  const seq = useRef(0);
  const known = useRef<{ open: boolean; waitingForReply: boolean }>({ open: true, waitingForReply: true });

  const load = useCallback(() => {
    const mine = ++seq.current;
    return api<{ item: AssistantItemView | null }>(`/api/orgs/${orgSlug}/assistant-items/${itemId}`).then((r) => {
      if (mine !== seq.current) return;
      if (!r.item) { setFailed("gone"); setLoading(false); return; }
      known.current = { open: stillOpen(r.item), waitingForReply: r.item.kind === "message" && r.item.viewer === "sender" && !r.item.reply };
      setItem(r.item); setFailed(null); setNow(Date.now()); setLoading(false);
    }, (err: unknown) => {
      if (mine !== seq.current) return;
      // Not there (or no longer the person's to see) says so; before the database update (503) there is nothing to show;
      // anything else keeps the last state.
      const status = isApiFailure(err) ? err.error.status : 0;
      setFailed(status === 404 || (status === 503 && isApiFailure(err) && err.error.code === "NOT_READY") ? "gone" : "refresh");
      setLoading(false);
    });
  }, [orgSlug, itemId]);

  useEffect(() => { void load(); }, [load]);

  // The change stream: this item changed, or (while a message waits for its one-line reply) a new item arrived.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<ChangeEvent>).detail;
      if (!d || d.table !== "assistant_items") return;
      const ours = d.id === itemId || (known.current.waitingForReply && d.op.toUpperCase() === "INSERT");
      if (!ours) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void load(); }, DEBOUNCE_MS);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { window.removeEventListener(CHANGE_EVENT, onChange); if (timer) clearTimeout(timer); };
  }, [itemId, load]);

  // A slow read while it is still open and the tab is on screen, in case a change was missed (a reconnect).
  const open = !!item && polls(item, now);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [open, load]);

  const retry = failed === "refresh" ? (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs font-normal text-subtle">
      {W.status.couldNotRefresh}.
      <button type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-my-1")}><AnimatedRefreshCw aria-hidden />{W.status.retry}</button>
    </p>
  ) : null;

  if (!item) {
    return (
      <div className={cn("rounded-xl border border-border p-3", className)}>
        {failed === "gone" ? <p className="text-sm font-normal text-secondary">This is no longer here.</p>
          : failed ? <><p className="text-sm font-normal text-secondary">Sent to another assistant</p>{retry}</>
          : <div aria-hidden className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>}
        {!failed ? <span className="sr-only" role="status">Loading…</span> : null}
      </div>
    );
  }

  const n = itemNames(item);
  const received = item.viewer === "recipient";
  const note = item.kind === "report_note";
  const title = note ? W.status.noteTitle
    : received
      ? item.kind === "message" ? `Message from ${n.senderAssistant}` : item.kind === "request" ? `Request from ${n.senderAssistant}` : `Reply from ${n.S}`
      : item.kind === "message" ? W.status.messageTitle(n.recipientAssistant) : item.kind === "request" ? W.status.requestTitle(n.recipientAssistant) : `Reply to ${n.R}`;
  // The person's own assistant first, then the other side: the other person's, or the workspace's for a note.
  const other = note ? workspace : received ? item.sender.assistant : item.recipient?.assistant ?? workspace;
  const preview = itemPreview(item);
  const long = preview.length > LONG || preview.includes("\n");
  const line = outcomeOf(item, { timeZone: zone, now, yourName: personal.name }) ?? { text: item.status === "seen" ? "Seen." : "New.", tone: "neutral" as const };

  async function post(what: "cancel" | "withdraw") {
    const r = await api<{ item: AssistantItemView }>(`/api/orgs/${orgSlug}/assistant-items/${itemId}/${what}`, { method: "POST", retries: 1 });
    setItem(r.item); setNow(Date.now());
    router.refresh();
  }

  return (
    <div className={cn("min-w-0 rounded-xl border border-border-input p-3", className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-px flex shrink-0 -space-x-1.5" aria-hidden>
          <AssistantFace profile={personal} own />
          <AssistantFace profile={other} own={false} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 break-words text-sm font-medium text-foreground">{title}</p>
            <span className="flex shrink-0 items-center gap-1.5"><ItemBadge item={item} />{action}</span>
          </div>
          {preview ? (
            <>
              <p id={bodyId} className={cn("mt-1 whitespace-pre-wrap break-words text-sm font-normal text-foreground", !expanded && "line-clamp-3")}>{preview}</p>
              {long ? (
                <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((x) => !x)}
                  className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "-ml-2 mt-0.5")}>{expanded ? "Show less" : W.status.showAll}</button>
              ) : null}
            </>
          ) : null}
          {/* The status line, the card's one live region (the same element throughout, so each change is heard). */}
          <p role="status" aria-live="polite"
            className={cn("mt-1 whitespace-pre-wrap break-words text-meta font-normal", line.tone === "danger" ? "text-danger" : line.tone === "success" ? "text-success" : "text-secondary", line.working && "brenda-shimmer")}>
            {line.text}
          </p>
          {item.canCancel || item.canWithdraw ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.canCancel ? (
                <ConfirmButton variant="ghost" size="sm" className="-ml-2" title={W.card.cancelConfirm} confirmLabel={W.card.cancelRequest} cancelLabel="Keep it" pendingLabel="Cancelling…"
                  description={`${n.R} won't be asked any more, and nothing changes on ${n.R}'s account.`} onConfirm={() => post("cancel")}>
                  {W.card.cancelRequest}
                </ConfirmButton>
              ) : null}
              {item.canWithdraw ? (
                <ConfirmButton variant="ghost" size="sm" className="-ml-2" title={W.card.withdrawConfirm} confirmLabel={W.card.withdrawNote} cancelLabel="Keep it" pendingLabel="Withdrawing…"
                  description="It won't go in today's team report." onConfirm={() => post("withdraw")}>
                  {W.card.withdrawNote}
                </ConfirmButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {retry}
    </div>
  );
}
