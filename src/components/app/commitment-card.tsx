"use client";

/**
 * A commitment the workspace's assistant noted for the person (owner decision, 8 October 2026: phase 7b, "Brenda keeps
 * the loops closed", workspace commitments; contract C.3 and H.3). Two kinds reach the person who owes the work, in
 * "Between assistants" beside the follow-up asks and the items (as `LoopInboxItem`s), on her page's "Waiting for you" and
 * on the Commitments page:
 *
 * - a **noted commitment** (`commitment`: a promise they made, "I'll send the deck Thursday", or an ask they agreed to,
 *   "On it"): the workspace assistant's face (quiet: it is not theirs), "Brenda noted you said you'd “Send the deck”" (or
 *   "… you agreed to Olu's ask: “…”"), the message they wrote as typed in a bubble with its link, the due date, then "Add it
 *   to your to-dos?" ("Track it as your commitment?" for the owner and HR, who hold no to-dos), "Nothing is added until you
 *   accept.", and **Add to my to-dos** (white: one primary per card), **Decline** (an optional reason, up to 280
 *   characters, inline) and **Not a commitment**. "Change" opens the to-do's title and due date before accepting.
 * - an **open ask** (`open_ask`: someone asked them and nobody agreed in the thread): "Olu asked you to “Fix the login
 *   bug”", the ask as typed, "Take it on?", "Olu is told what you decide.", **Take it on**, **Decline**, **Not a
 *   commitment**.
 *
 * Accept is the consent (contract, decision 7): nothing is added until the person presses it. Everything someone wrote
 * (the message, a decline reason) is plain text with its line breaks kept, inside “ ”, never Markdown, never a link; the
 * only links are Boredroom's own (the message in its conversation, the to-do). Opening a card marks it seen (POST
 * …/seen, once per page). Each press goes to `/api/orgs/{org}/commitments/{id}/{accept|decline|dismiss}` and the card
 * takes the commitment the server answers with, so it changes in place; a press that finds it already answered reloads
 * it and says so. `compact`: one row (the face, the title, the badge, two lines of the quote) that opens in place; one
 * waiting for the person keeps its buttons under the row, as assistant-item-card's.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AnimatedArrowUpRight, AnimatedCheck } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Alert } from "@/components/ui/states";
import { AssistantFace } from "@/components/app/follow-up-exchange";
import { useAssistant } from "@/components/app/assistant-context";
import { failureText } from "@/components/app/assistant-item-card";
import { api, isApiFailure } from "@/lib/api-client";
import { clip, whenLabel } from "@/lib/follow-ups";
import { LOOP_LIMITS, LOOP_WORDS, type CommitmentView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const W = LOOP_WORDS.inbox;
/** The counter under a field shows from here on. */
const COUNT_FROM = 240;
const REASON_MAX = LOOP_LIMITS.declineReasonMax;

export type CommitmentAction = "accept" | "decline" | "dismiss" | "done";

/** Marked seen once per page, whatever re-renders (the definer answers 'ok' again anyway). */
const seen = new Set<string>();
export function markCommitmentSeen(orgSlug: string, id: string) {
  if (seen.has(id)) return;
  seen.add(id);
  api(`/api/orgs/${orgSlug}/commitments/${id}/seen`, { method: "POST", retries: 1 }).catch(() => seen.delete(id));
}

/** "Brenda noted you said you'd “Send the deck”", "Olu asked you to “Fix the login bug”" (titles clipped to 80). */
export function commitmentTitle(c: CommitmentView, workspaceName: string): string {
  const title = clip(c.title, 80);
  if (c.kind === "open_ask") return W.openAskTitle(c.asker?.firstName ?? "Someone", title);
  if (c.kind === "agreed_ask" && c.asker) return W.agreedTitle(workspaceName, c.asker.firstName, title);
  return W.commitmentTitle(workspaceName, title);
}

/** Still waiting for the person's answer (proposed, or an open ask they were told about). */
export const commitmentWaiting = (c: CommitmentView) => c.canAccept || c.canDecline || c.canDismiss;

/** Where a commitment stands once answered, in one sentence for the person who owes it, with a tone for the words. */
export function commitmentOutcome(c: CommitmentView): { text: string; tone: "neutral" | "success" | "danger"; working?: boolean } | null {
  switch (c.status) {
    case "accepting": return { text: c.acceptMakesTodo ? "Adding it to your to-dos…" : "Accepting…", tone: "neutral", working: true };
    case "open": return { text: c.todo ? W.accepted : W.acceptedNoTodo, tone: "success" };
    case "done": return { text: "Done.", tone: "success" };
    case "declined": return { text: c.declineReason ? `${W.declined} You said: “${c.declineReason}”` : W.declined, tone: "neutral" };
    case "dismissed": return { text: W.dismissed, tone: "neutral" };
    case "expired": return { text: LOOP_WORDS.errors.expired, tone: "neutral" };
    case "cancelled": return { text: "Cancelled: the message was withdrawn or the to-do removed.", tone: "neutral" };
    default: return null;
  }
}

/** An instant as the date picker's local "yyyy-mm-ddThh:mm" (this browser's zone, as the task editor). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** The date picker's local value as an ISO instant, or null for none (or a value that is not one). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Someone's words: plain text, line breaks kept, never formatted or linked, inside “ ”. */
function Bubble({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground", className)}>{children}</p>;
}

/** A small link to one of Boredroom's own pages ("Message ↗", "To-do ↗"). */
export function QuietLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} prefetch={false} className={cn("inline-flex max-w-full items-center gap-1 rounded-sm text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:size-3.5 [&_svg]:shrink-0", className)}>
      <span className="min-w-0 truncate">{children}</span><AnimatedArrowUpRight aria-hidden />
    </Link>
  );
}

export function CommitmentCard({ orgSlug, view: given, timeZone, now, compact = false, embedded = false, id, highlight = false, className, onChange }: {
  orgSlug: string; view: CommitmentView; timeZone: string; now: number;
  /** One row that opens into the whole card in place (lists, her page). */ compact?: boolean;
  /** Inside something that already shows the badge (a sheet). */ embedded?: boolean;
  /** The card's element id (the inbox scrolls to `?f=`). */ id?: string;
  /** The commitment a link pointed at: a 1px orange border. */ highlight?: boolean;
  className?: string;
  /** After a press changed it, with the commitment as it is now (a list keeps it on screen once the server drops it). */
  onChange?: (c: CommitmentView) => void;
}) {
  const router = useRouter();
  const { workspace } = useAssistant();
  const uid = useId();
  // The commitment as a press left it; the page's copy takes over when it moves on (another press, the worker).
  const [local, setLocal] = useState<CommitmentView | null>(null);
  const c = local && local.id === given.id && statusRank(local.status) > statusRank(given.status) ? local : given;
  const [busy, setBusy] = useState<CommitmentAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [saidTone, setSaidTone] = useState<"neutral" | "success" | "danger">("neutral");
  const [mode, setMode] = useState<"idle" | "decline" | "change">("idle");
  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(given.title);
  const [due, setDue] = useState(() => toLocalInput(given.dueAt));
  const [open, setOpen] = useState(false);
  const waiting = commitmentWaiting(c);
  const ask = c.kind === "open_ask";
  const asker = c.asker?.firstName ?? null;
  const titleId = `${uid}-title`;
  const at = (iso: string) => whenLabel(iso, timeZone, new Date(now));

  // Opening a waiting card marks it seen: the whole card on arrival, a compact row when it is opened.
  useEffect(() => {
    if (c.viewer === "committer" && waiting && (!compact || open)) markCommitmentSeen(orgSlug, c.id);
  }, [orgSlug, c.id, c.viewer, waiting, compact, open]);

  async function reload() {
    try {
      const r = await api<{ commitment: CommitmentView }>(`/api/orgs/${orgSlug}/commitments/${c.id}`);
      setLocal(r.commitment); onChange?.(r.commitment);
    } catch { /* the card keeps what it has */ }
  }

  async function press(action: CommitmentAction, body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(action); setError(null); setSaid(""); setSaidTone("neutral");
    try {
      const r = await api<{ commitment: CommitmentView; note?: string | null }>(`/api/orgs/${orgSlug}/commitments/${c.id}/${action}`, { method: "POST", ...(body ? { body } : {}), retries: 1 });
      setLocal(r.commitment); onChange?.(r.commitment);
      setMode("idle"); setReason("");
      if (action === "accept") {
        setSaid(r.note ?? (r.commitment.todo || r.commitment.acceptMakesTodo ? W.accepted : W.acceptedNoTodo));
        setSaidTone(r.note ? "neutral" : "success");
      } else if (action === "decline") setSaid(W.declined);
      else if (action === "dismiss") setSaid(W.dismissed);
      else setSaid("Marked done.");
      router.refresh();
    } catch (err) {
      setError(failureText(err));
      // Already answered, expired or gone: show it as it is now.
      if (isApiFailure(err) && (err.error.status === 409 || err.error.status === 404)) void reload();
    } finally { setBusy(null); }
  }

  function accept() {
    const body: Record<string, unknown> = {};
    if (mode === "change") {
      const t = title.replace(/\s+/g, " ").trim();
      if (!t) { setError("Give the to-do a title."); return; }
      if (t !== c.title) body.title = t;
      const d = fromLocalInput(due);
      if (d !== (c.dueAt ? new Date(c.dueAt).toISOString() : null)) body.dueAt = d;
    }
    void press("accept", Object.keys(body).length ? body : undefined);
  }

  const acceptLabel = ask ? W.takeItOn : c.acceptMakesTodo ? W.accept : W.acceptNoTodos;
  const question = ask ? W.openAskQuestion : c.acceptMakesTodo ? W.commitmentQuestion : W.commitmentQuestionNoTodos;

  // ---- The buttons, or the reason for declining, or the to-do's title and date before accepting ----
  const declineForm = mode === "decline" ? (
    <form className="min-w-0" onSubmit={(e) => { e.preventDefault(); void press("decline", { reason: reason.replace(/\s+/g, " ").trim() || null }); }}>
      <label htmlFor={`${uid}-reason`} className="mb-1.5 block text-meta font-medium text-foreground">{W.declinePlaceholder}</label>
      <Textarea id={`${uid}-reason`} className="min-h-16 w-full" value={reason} maxLength={REASON_MAX} disabled={!!busy} autoFocus
        onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setMode("idle"); } }}
        aria-describedby={reason.length > COUNT_FROM ? `${uid}-count` : undefined} />
      {reason.length > COUNT_FROM ? <p id={`${uid}-count`} className="mt-1 text-right text-xs font-normal tabular-nums text-subtle">{reason.length} of {REASON_MAX}</p> : null}
      {/* An ask's asker is told of a decline (privately); a promise's is not (contract C.2). */}
      {c.kind !== "promise" && asker ? <p className="mt-1.5 text-meta font-normal text-secondary">{asker} is told, with your reason if you give one.</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setMode("idle")}>Back</Button>
        <Button type="submit" variant="secondary" size="sm" loading={busy === "decline"} disabled={!!busy}>{W.decline}</Button>
      </div>
    </form>
  ) : null;

  const changeFields = mode === "change" ? (
    <div className="grid gap-3 rounded-xl border border-border p-3 min-[440px]:grid-cols-2">
      <Field label="To-do" htmlFor={`${uid}-todo`} className="min-[440px]:col-span-2">
        <Input id={`${uid}-todo`} fieldSize="sm" value={title} maxLength={LOOP_LIMITS.titleMax} disabled={!!busy} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Due" htmlFor={`${uid}-due`} hint="Optional">
        <DatePicker mode="datetime" id={`${uid}-due`} size="sm" value={due} onChange={setDue} disabled={!!busy} />
      </Field>
    </div>
  ) : null;

  // `row`: the buttons under a compact row, without "Change" (the whole card, opened in place, has it).
  const buttonsFor = (row: boolean) => !waiting ? null : mode === "decline" ? declineForm : (
    <div className="space-y-3">
      {changeFields}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {c.canAccept && c.acceptMakesTodo && mode !== "change" && !row ? <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setMode("change")}>Change</Button> : null}
        {mode === "change" ? <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { setMode("idle"); setTitle(c.title); setDue(toLocalInput(c.dueAt)); }}>Keep as noted</Button> : null}
        {c.canDismiss ? <Button variant="ghost" size="sm" loading={busy === "dismiss"} disabled={!!busy} onClick={() => void press("dismiss")}>{W.dismiss}</Button> : null}
        {c.canDecline ? <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { setMode("decline"); setError(null); }}>{W.decline}</Button> : null}
        {c.canAccept ? <Button variant="primary" size="sm" loading={busy === "accept"} disabled={!!busy} onClick={accept}><AnimatedCheck aria-hidden />{acceptLabel}</Button> : null}
      </div>
    </div>
  );

  const outcome = waiting ? null : commitmentOutcome(c);
  const outcomeLine = outcome ? (
    <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-meta font-normal", outcome.tone === "success" ? "text-success" : outcome.tone === "danger" ? "text-danger" : "text-secondary", outcome.working && "brenda-shimmer")}>{outcome.text}</p>
  ) : null;

  const quote = c.message.withdrawn ? <p className="mt-1.5 text-meta font-normal text-secondary">{LOOP_WORDS.page.withdrawn}</p>
    : c.message.edited ? <p className="mt-1.5 text-meta font-normal text-secondary">{LOOP_WORDS.page.edited}</p>
    : c.message.quote ? <Bubble>“{c.message.quote}”</Bubble>
    : <p className="mt-1.5 text-meta font-normal text-secondary">{LOOP_WORDS.page.noMessage}</p>;
  const where = c.where.name;
  const links = (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {c.message.href ? <QuietLink href={c.message.href}>{where ? `${LOOP_WORDS.page.openMessage} in ${where}` : LOOP_WORDS.page.openMessage}</QuietLink> : null}
      {c.todo ? <QuietLink href={c.todo.href}>{LOOP_WORDS.page.openTodo}</QuietLink> : null}
    </div>
  );

  const full = (inside: boolean) => (
    <article id={inside ? undefined : id} tabIndex={!inside && id ? -1 : undefined} aria-labelledby={titleId}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && !inside && "border-accent-ring", !inside && className)}>
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={workspace} own={false} className="mt-px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={titleId} className="min-w-0 flex-[1_1_12rem] break-words text-sm font-normal text-foreground">
              {commitmentTitle(c, workspace.name)}<span className="text-secondary">, <time dateTime={c.createdAt} className="tabular-nums">{at(c.createdAt)}</time></span>
            </h3>
            {embedded || inside ? null : <Badge tone={c.badge.tone} className="shrink-0">{c.badge.label}</Badge>}
          </div>
          {quote}
          {c.agreement?.quote ? <p className="mt-1.5 break-words text-meta font-normal text-secondary">You replied: “<span className="whitespace-pre-wrap text-foreground">{c.agreement.quote}</span>”</p>
            : c.agreement?.edited ? <p className="mt-1.5 text-meta font-normal text-secondary">{LOOP_WORDS.page.edited}</p> : null}
          {c.dueLabel ? <p className="mt-1.5 text-meta font-normal text-secondary">Due <span className="tabular-nums text-foreground">{c.dueLabel}</span>{c.dueWords ? <> (“{c.dueWords}”)</> : null}</p> : null}
          {links}
          {waiting ? (
            <>
              <p className="mt-2 text-sm font-medium text-foreground">{question}</p>
              <p className="mt-0.5 text-meta font-normal text-secondary">{ask && asker ? W.askerToldOnDecline(asker) : W.nothingChanges}</p>
            </>
          ) : outcomeLine}
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {waiting ? <div className={mode === "idle" ? undefined : "min-[440px]:pl-7"}>{buttonsFor(false)}</div> : null}
    </article>
  );
  // Only the result of a press is announced.
  const live = <p role="status" aria-live="polite" className="sr-only">{said}</p>;

  if (!compact) return <>{full(false)}{live}</>;

  // ---- Compact: one row that opens in place ----
  const fullId = `${uid}-full`;
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={cn("min-w-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border border-accent-ring", className)}>
      <button type="button" aria-expanded={open} aria-controls={fullId} onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-75 hover:bg-fill-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <AssistantFace profile={workspace} own={false} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 flex-[1_1_12rem] break-words text-sm font-medium text-foreground">
              {commitmentTitle(c, workspace.name)}<span className="font-normal text-secondary">, <span className="tabular-nums">{at(c.createdAt)}</span></span>
            </span>
            <Badge tone={c.badge.tone} className="shrink-0">{c.badge.label}</Badge>
          </span>
          {c.message.quote ? <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-meta font-normal text-secondary">“{c.message.quote}”</span> : null}
          {c.dueLabel ? <span className="mt-0.5 block text-meta font-normal text-secondary">Due <span className="tabular-nums">{c.dueLabel}</span></span> : null}
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div id={fullId} className="mt-1">{full(true)}</div> : (
        // Waiting for the person: answer it from the row; what a press did shows under it.
        waiting || said || error ? (
          <div className="space-y-2 pb-2 pl-[38px] pr-2">
            {said ? <p className={cn("text-meta font-normal", saidTone === "success" ? "text-success" : "text-secondary")}>{said}</p> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {buttonsFor(true)}
          </div>
        ) : null
      )}
      {live}
    </div>
  );
}

/** How far along a status is, so the card keeps a press's answer until the page's copy has caught up or moved on. */
function statusRank(s: CommitmentView["status"]): number {
  switch (s) {
    case "proposed": case "asked": return 0;
    case "accepting": return 1;
    case "open": case "declined": case "dismissed": case "expired": return 2;
    default: return 3;
  }
}
