"use client";

/**
 * A task's discussion and status history as sheets (owner decision, 5 October 2026): two buttons in the full task
 * page's header instead of a side column, so the work itself takes the page's width. v4: each is a small outline
 * button with its icon and a count pill, and opens a right-hand sheet (the full width on a phone). The native dialog
 * holds focus inside and makes the page behind inert; Escape, the close button or a press on the dimmed page closes
 * it, and focus returns to the button that opened it. A link opens one on arrival: `?panel=comments` (a notification
 * about a comment) or `?panel=history`, or the hash `#comments` / `#history`; closing it takes the marker out of the
 * address, so a reload does not open it again.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { History, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, CountPill, TASK_STATUS_TONE, taskStatusLabel } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/input";
import { Alert, EmptyState } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { initialsOf } from "@/lib/avatar";
import { cn, formatDateTime } from "@/lib/utils";

export type TaskComment = { id: string; body: string; created_at: string; author_name: string };
export type TaskHistoryEntry = { from_status: string | null; to_status: string; reason: string | null; occurred_at: string; actor_name: string | null };
type Panel = "comments" | "history";

/** The words a link may use for each sheet. */
const PANELS: Record<string, Panel> = { comments: "comments", comment: "comments", discussion: "comments", history: "history" };
const panelFrom = (v: string | null | undefined): Panel | null => (v ? PANELS[v.toLowerCase()] ?? null : null);

/** "Ada", "Ada and David". */
const people = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "");

export function TaskPanels({ orgSlug, taskId, taskTitle, comments, history, timezone, notify, initialPanel }: {
  orgSlug: string; taskId: string; taskTitle: string; comments: TaskComment[]; history: TaskHistoryEntry[]; timezone: string;
  /** First names of whoever a new comment notifies (the assignee and the reviewer, less the viewer). */
  notify: string[];
  /** `?panel=` from the address, read on the server so the sheet is open from the first paint. */
  initialPanel?: string;
}) {
  const [open, setOpen] = useState<Panel | null>(() => panelFrom(initialPanel));
  const commentsBtn = useRef<HTMLButtonElement>(null);
  const historyBtn = useRef<HTMLButtonElement>(null);
  const commentsDialog = useRef<HTMLDialogElement>(null);
  const historyDialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const commentsId = useId();
  const historyId = useId();
  const count = comments.length;

  // The hash cannot reach the server, so `#comments` is read here, on arrival and whenever it changes.
  useEffect(() => {
    const fromHash = () => { const p = panelFrom(window.location.hash.slice(1)); if (p) setOpen(p); };
    const t = window.setTimeout(fromHash, 0);
    window.addEventListener("hashchange", fromHash);
    return () => { window.clearTimeout(t); window.removeEventListener("hashchange", fromHash); };
  }, []);

  // The state drives the dialogs: open the one asked for (newest comment in view; on a pointer device the box takes
  // the focus, on a phone the close button does, so the keyboard does not cover the thread), close the other.
  useEffect(() => {
    for (const [name, ref] of [["comments", commentsDialog], ["history", historyDialog]] as const) {
      const d = ref.current;
      if (!d) continue;
      if (open === name && !d.open) {
        d.showModal();
        if (name === "comments") {
          if (list.current) list.current.scrollTop = list.current.scrollHeight;
          if (window.matchMedia("(pointer: fine)").matches) composer.current?.focus();
        }
      } else if (open !== name && d.open) d.close();
    }
  }, [open]);

  // A comment just posted (the page refreshes with it) scrolls into view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  /** After either dialog closes (Escape, the button, the backdrop): forget it, hand focus back, tidy the address. */
  const closed = (name: Panel) => {
    setOpen((cur) => (cur === name ? null : cur));
    (name === "comments" ? commentsBtn : historyBtn).current?.focus();
    const url = new URL(window.location.href);
    const hashed = panelFrom(url.hash.slice(1));
    if (url.searchParams.has("panel") || hashed) {
      url.searchParams.delete("panel");
      if (hashed) url.hash = "";
      window.history.replaceState(null, "", url);
    }
  };

  return (
    <>
      <span className="flex items-center gap-2">
        <Button ref={commentsBtn} size="sm" variant="secondary" onClick={() => setOpen("comments")}
          aria-label={count ? `Discussion, ${count} comment${count === 1 ? "" : "s"}` : "Discussion, no comments yet"}
          aria-haspopup="dialog" aria-expanded={open === "comments"} aria-controls={commentsId}>
          <MessageSquare aria-hidden />
          <CountPill count={count} className="-mr-1" />
        </Button>
        <Button ref={historyBtn} size="sm" variant="secondary" onClick={() => setOpen("history")}
          aria-label={history.length ? `Status history, ${history.length} change${history.length === 1 ? "" : "s"}` : "Status history"} aria-haspopup="dialog" aria-expanded={open === "history"} aria-controls={historyId}>
          <History aria-hidden />
          <CountPill count={history.length} className="-mr-1" />
        </Button>
      </span>

      <PanelSheet id={commentsId} dialogRef={commentsDialog} title="Discussion" subtitle={taskTitle} onClosed={() => closed("comments")}>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {count === 0 ? (
            <EmptyState compact icon={MessageSquare} title="No comments yet"
              description={`Ask a question or leave an update${notify.length ? `; ${people(notify)} ${notify.length === 1 ? "is" : "are"} notified` : ""}.`} />
          ) : (
            <ol className="space-y-5" aria-label="Comments, oldest first">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <span aria-hidden className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-grey-100 text-xs font-medium text-secondary">{initialsOf(c.author_name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-meta font-normal text-secondary"><span className="text-sm font-medium text-foreground">{c.author_name}</span><time dateTime={c.created_at} className="tabular-nums">{formatDateTime(c.created_at, timezone)}</time></p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm font-normal text-foreground">{c.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <CommentComposer orgSlug={orgSlug} taskId={taskId} textareaRef={composer} notify={notify} />
      </PanelSheet>

      <PanelSheet id={historyId} dialogRef={historyDialog} title="Status history" subtitle={taskTitle} onClosed={() => closed("history")}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {history.length === 0 ? <EmptyState compact icon={History} title="No changes yet" description="Each move, from to do to done, shows here with who made it and when." /> : (
            // Newest first: what happened last is what people open this for. A rail joins the steps; the latest is filled.
            <ol aria-label="Status changes, newest first">
              {[...history].reverse().map((h, i, all) => (
                <li key={`${h.occurred_at}-${i}`} className="relative pb-6 pl-7 last:pb-0">
                  {i < all.length - 1 ? <span aria-hidden className="absolute -bottom-1.5 left-[5px] top-4 w-px bg-border-input" /> : null}
                  <span aria-hidden className={cn("absolute left-0 top-1.5 size-[11px] rounded-full border", i === 0 ? "border-foreground bg-foreground" : "border-border-input-hover bg-background")} />
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    {h.from_status ? <><Badge tone={TASK_STATUS_TONE[h.from_status]}>{taskStatusLabel(h.from_status)}</Badge><span className="text-meta font-normal text-secondary">to</span></> : <span className="text-meta font-normal text-secondary">Created as</span>}
                    <Badge tone={TASK_STATUS_TONE[h.to_status]}>{taskStatusLabel(h.to_status)}</Badge>
                  </p>
                  <p className="mt-1.5 text-meta font-normal text-secondary">{h.actor_name ? `${h.actor_name}, ` : ""}<time dateTime={h.occurred_at} className="tabular-nums">{formatDateTime(h.occurred_at, timezone)}</time></p>
                  {h.reason ? <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-normal text-foreground">{h.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </PanelSheet>
    </>
  );
}

/** One sheet: the title row with its close button, then whatever the panel holds. Mounted closed; the parent opens it. */
function PanelSheet({ id, dialogRef, title, subtitle, onClosed, children }: { id: string; dialogRef: React.RefObject<HTMLDialogElement | null>; title: string; subtitle: string; onClosed: () => void; children: React.ReactNode }) {
  const titleId = useId();
  // A press that starts and ends on the dimmed page closes the sheet; a text selection dragged out of the box does not.
  const downOnBackdrop = useRef(false);
  return (
    <dialog ref={dialogRef} id={id} className="side-sheet" aria-labelledby={titleId} onClose={onClosed}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) e.currentTarget.close(); downOnBackdrop.current = false; }}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-6 pb-4 pt-6">
        <div className="min-w-0">
          <h2 id={titleId} className="type-dialog-title">{title}</h2>
          <p className="mt-1 truncate text-sm font-medium text-secondary">{subtitle}</p>
        </div>
        <IconButton aria-label="Close" className="-mr-2 -mt-1" onClick={() => dialogRef.current?.close()}><X aria-hidden /></IconButton>
      </div>
      {children}
    </dialog>
  );
}

/** The box under the thread. Posting refreshes the page, so the new comment, and the count on the button, come from the server. */
function CommentComposer({ orgSlug, taskId, textareaRef, notify }: { orgSlug: string; taskId: string; textareaRef: React.RefObject<HTMLTextAreaElement | null>; notify: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [posted, setPosted] = useState(0);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const post = async (form: HTMLFormElement) => {
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body || pending) return;
    setPending(true); setError(null); setFieldError(null);
    try {
      await api(`/api/orgs/${orgSlug}/tasks/${taskId}/comments`, { method: "POST", body: { body } });
      form.reset();
      setPosted((n) => n + 1);
      router.refresh();
    } catch (err) {
      if (isApiFailure(err)) { const f = err.error.fieldErrors?.body?.[0]; if (f) setFieldError(f); else setError(err.error.message); }
      else setError("Cannot reach the server. Your comment was not posted; try again.");
    } finally { setPending(false); }
  };
  return (
    <form className="shrink-0 border-t border-border bg-background px-6 pb-6 pt-4 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]" onSubmit={(e) => { e.preventDefault(); void post(e.currentTarget); }}>
      {error ? <Alert tone="danger" className="mb-3">{error}</Alert> : null}
      <label htmlFor={fieldId} className="sr-only">Comment</label>
      <Textarea ref={textareaRef} id={fieldId} name="body" required maxLength={4000} rows={3} placeholder="Ask a question or leave an update" className="min-h-20 resize-none"
        aria-keyshortcuts="Control+Enter Meta+Enter" aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? errorId : undefined}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      {fieldError ? <p id={errorId} role="alert" className="mt-1.5 text-meta font-medium text-danger">{fieldError}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-meta font-normal text-secondary">{notify.length ? `${people(notify)} ${notify.length === 1 ? "is" : "are"} notified.` : null}</p>
        <Button size="sm" type="submit" loading={pending}>{pending ? "Posting…" : "Post comment"}</Button>
      </div>
      <p role="status" className="sr-only">{posted ? "Comment posted." : ""}</p>
    </form>
  );
}
