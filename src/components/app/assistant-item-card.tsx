"use client";

/**
 * One thing that passed between two assistants (owner decision, 8 October 2026: personal assistants, phase 6: "I want
 * all the bots to be able to communicate with each other"): a message one person's assistant passed on, a request to
 * accept a change, a one-line reply to a message, or a note for today's end-of-day team report. The same card on the
 * inbox ("Between assistants"), the item's own page and her page's "Waiting for you"; the chat's live card is
 * assistant-item-status-card, built on the words here.
 *
 * What the card shows, by who is looking (`item.viewer`) and what it is (`item.kind`):
 * - a message brought to the person: the sender's assistant's face (quiet: it is not theirs), "Olu's Max passed on a
 *   message from Olu", the words exactly as sent in a bubble inside “ ” ("Olu's words, as sent.", or "Max reworded it at
 *   Olu's request."), then "Mark as seen" and "Reply" (one line, 280 characters; "Sent. Max passes it to Olu.");
 * - a request brought to the person: "Olu's Max asks you to accept a change", "What would change" (the request's lines),
 *   Olu's note, "Nothing changes until you accept. If you do, {your assistant} does it for you, as you.", when it
 *   expires, then "Decline" (with an optional reason) and "Accept" (white: the screen's orange stays with its other
 *   standout); the outcome in words once answered ("Accepted. Added to your to-dos.", "Couldn't be done: …");
 * - a reply brought to the person: "Ben replied to your message", their message quoted small, the reply in a bubble;
 * - what the person sent: their own face, "To Ben's Brenda", the words and where it stands ("Ben has seen it, 14:02.",
 *   "Ben replied: “…”", "Ada declined: “…”"), with "Cancel request" while a request is open;
 * - a note for the team report: "From you via Max: “…”", when the report's readers read it, "Withdraw note" until then.
 *
 * Everything another person wrote (a message, a reply, a note, a decline reason, a task title in a request's lines) is
 * plain text with its line breaks kept: never Markdown, never a link (contract, principle 2). The only links are
 * Boredroom's own pages (the conversation a request came from). A received card's menu can stop new items from that
 * colleague's assistant ("Stop items from Olu's assistant"); they are told they are not delivered, and it is undone in
 * Settings → Your assistant.
 *
 * Each press goes to `/api/orgs/{org}/assistant-items/{id}/{seen|reply|accept|decline|cancel|withdraw}` and the card
 * takes the item the server answers with, so it changes in place; a press that finds the item already closed reloads
 * it and says so. Only the result of a press is announced (a polite status; a failed accept is an alert).
 *
 * `compact`: one row (the face, the title, the badge, two lines of the words) that opens into the whole card in place,
 * for the inbox's lists and her page; a request or message waiting for the person keeps its buttons under the row, so
 * it can be answered without opening it. `embedded`: the whole card inside something that already shows its badge.
 */
import { Fragment, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, EllipsisVertical } from "lucide-react";
import { AnimatedArrowUpRight, AnimatedCheck } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Menu, MenuItem } from "@/components/ui/menu";
import { AssistantFace } from "@/components/app/follow-up-exchange";
import { useAssistant } from "@/components/app/assistant-context";
import { api, isApiFailure } from "@/lib/api-client";
import { whenLabel } from "@/lib/follow-ups";
import { ASSISTANT_ITEM_LIMITS, ASSISTANT_ITEM_WORDS, assistantOf, dateTimeLabel, doneWords, timeLabel, type AssistantItemView } from "@/lib/assistant-items";
import { cn } from "@/lib/utils";

const REPLY_MAX = ASSISTANT_ITEM_LIMITS.replyMax;
const REASON_MAX = ASSISTANT_ITEM_LIMITS.declineReasonMax;
/** The counter under a one-line field shows from here on. */
const COUNT_FROM = 240;
const OFFLINE = "Cannot reach the server. Check your connection and try again.";
const W = ASSISTANT_ITEM_WORDS;

export type ItemAction = "seen" | "reply" | "accept" | "decline" | "cancel" | "withdraw";

const possessive = (first: string) => `${first}'s`;

// ---- Words (shared with the chat's status card; the fixed strings are lib/assistant-items' ASSISTANT_ITEM_WORDS) ----

/** Who is who on an item, in words: "Olu", "Olu's Max", "Ben", "Ben's Brenda". */
export function itemNames(item: AssistantItemView) {
  const S = item.sender.firstName;
  const R = item.recipient?.firstName ?? "";
  return {
    S, R,
    SA: item.sender.assistant.name,
    RA: item.recipient?.assistant.name ?? "",
    senderAssistant: assistantOf(S, item.sender.assistant.name),
    recipientAssistant: item.recipient ? assistantOf(R, item.recipient.assistant.name) : "",
  };
}

/** The organisation's date today ("2026-10-08"), for telling today's report from an older one. */
function localDate(now: number, timeZone: string): string {
  try { return new Date(now).toLocaleDateString("en-CA", { timeZone }); } catch { return new Date(now).toISOString().slice(0, 10); }
}

/** "Wed 7 Oct" for a report's date ("2026-10-07"). */
function dayOf(date: string): string {
  return dateTimeLabel(`${date}T12:00:00Z`, "UTC").replace(/, \d\d:\d\d$/, "");
}

/** The title of an item in one line, for the viewer: "Message to Ben's Brenda", "Olu's Max asks you to accept a change". */
export function itemTitle(item: AssistantItemView, timeZone: string, now: number): string {
  const n = itemNames(item);
  if (item.kind === "report_note") {
    // Today's report by name; an older one by its day ("Note for the team report, Wed 7 Oct").
    const day = item.report && item.report.date !== localDate(now, timeZone) ? `, ${dayOf(item.report.date)}` : "";
    if (item.viewer !== "sender") return `Note from ${n.S} for the team report${day}`;
    return day ? `Note for the team report${day}` : W.card.reportNoteTitle;
  }
  if (item.viewer === "recipient") {
    if (item.kind === "message") return `${n.senderAssistant} passed on a message`;
    if (item.kind === "request") return `${n.senderAssistant} ${W.card.receivedRequest}`;
    return W.card.receivedReply(n.S);
  }
  if (item.kind === "message") return W.status.messageTitle(n.recipientAssistant);
  if (item.kind === "request") return W.status.requestTitle(n.recipientAssistant);
  return `Your reply to ${n.R}`;
}

/**
 * The words a compact row and the chat's card show under the title (two or three lines of them): someone's words inside
 * “ ” (a message, a reply, a note), or a request's summary in Boredroom's own words ("Add the to-do “Review pricing”").
 */
export function itemPreview(item: AssistantItemView): string {
  if (item.kind === "request" && item.request) {
    const s = item.request.summary;
    // The sender's note travels with the request in one row too: whoever answers from the row has read all of it.
    const note = item.body ? `\n${item.viewer === "sender" ? "Your note" : W.card.senderNote(item.sender.firstName)}: “${item.body}”` : "";
    return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${note}` : "";
  }
  return item.body ? `“${item.body}”` : "";
}

export const isOpenRequest = (item: AssistantItemView) => item.kind === "request" && (item.status === "delivered" || item.status === "seen");

/**
 * Where an item stands, in one sentence for the viewer, with a tone for the words (status colours only for done and
 * failed). Null when the card has nothing to add beyond its badge (a message brought to the person and not yet seen).
 * `working`: Boredroom is doing an accepted request right now.
 */
export function outcomeOf(item: AssistantItemView, o: { timeZone: string; now: number; yourName: string }): { text: string; tone: "neutral" | "success" | "danger"; working?: boolean } | null {
  const { S, R } = itemNames(item);
  const at = (iso: string) => whenLabel(iso, o.timeZone, new Date(o.now));
  if (item.kind === "report_note") {
    switch (item.status) {
      case "delivered": return item.report && !item.report.open ? { text: "Going in the report now.", tone: "neutral" } : { text: W.status.noteOpen(item.report ? timeLabel(item.report.cutoffAt, o.timeZone) : ""), tone: "neutral" };
      case "done": return { text: W.status.noteDone, tone: "success" };
      case "withdrawn": return { text: item.viewer === "sender" ? W.status.noteWithdrawn : `${S} withdrew this note.`, tone: "neutral" };
      case "expired": return { text: W.status.noteNotSent, tone: "neutral" };
      default: return null;
    }
  }
  if (item.kind === "request" && item.request) {
    const p = item.request.payload;
    const expires = dateTimeLabel(item.request.expiresAt, o.timeZone);
    const failed = item.result?.words || W.results.error;
    if (item.viewer === "recipient") {
      switch (item.status) {
        case "delivered": case "seen": return { text: `Waiting for your answer. ${W.card.expires(expires)}`, tone: "neutral" };
        case "accepted": return { text: `Accepted. ${o.yourName} is doing it…`, tone: "neutral", working: true };
        case "done": return { text: W.card.accepted(doneWords(p, o.timeZone, { sentForCheck: item.result?.sentForCheck })), tone: "success" };
        case "failed": return { text: W.card.couldNotBeDone(failed), tone: "danger" };
        case "declined": return { text: item.declineReason ? `${W.card.declined} You said: “${item.declineReason}”` : W.card.declined, tone: "neutral" };
        case "expired": return { text: W.card.expiredLine, tone: "neutral" };
        case "cancelled": return { text: W.card.cancelledBy(S), tone: "neutral" };
        default: return null;
      }
    }
    switch (item.status) {
      case "delivered": return { text: `${W.status.waiting(R)} ${W.card.expires(expires)}`, tone: "neutral" };
      case "seen": return { text: `${R} has seen it${item.seenAt ? `, ${at(item.seenAt)}` : ""}. ${W.card.expires(expires)}`, tone: "neutral" };
      case "accepted": return { text: W.status.doing(R), tone: "neutral", working: true };
      case "done": return { text: W.status.done(R, doneWords(p, o.timeZone, { sentForCheck: item.result?.sentForCheck })), tone: "success" };
      case "failed": return { text: W.status.failed(failed), tone: "danger" };
      case "declined": return { text: W.status.declined(R, item.declineReason), tone: "neutral" };
      case "expired": return { text: W.status.expired(R), tone: "neutral" };
      case "cancelled": return { text: W.status.cancelled, tone: "neutral" };
      default: return null;
    }
  }
  // A message or a reply.
  if (item.viewer === "sender") {
    if (item.reply) return { text: W.status.replied(R, item.reply.body), tone: "neutral" };
    if (item.seenAt) return { text: W.status.seen(R, at(item.seenAt)), tone: "success" };
    return { text: W.status.delivered, tone: "neutral" };
  }
  if (item.reply) return { text: `You replied: “${item.reply.body}”`, tone: "neutral" };
  if (item.seenAt) return { text: `Seen, ${at(item.seenAt)}.`, tone: "neutral" };
  return null;
}

/** What a failed press says: the server's own words for a refusal, or how to recover. */
export function failureText(err: unknown): string {
  if (isApiFailure(err)) return err.error.status >= 500 && err.error.code !== "NOT_READY" ? "Something went wrong. Nothing was changed; try again." : err.error.message;
  return OFFLINE;
}

// ---- Parts ----------------------------------------------------------------------------------------------------------

/** The status in a word or two, from the server (`itemBadge`): a word always sits in the badge. */
export function ItemBadge({ item, className }: { item: Pick<AssistantItemView, "badge">; className?: string }) {
  return <Badge tone={item.badge.tone} className={className}>{item.badge.label}</Badge>;
}

/** Someone's words: plain text, line breaks kept, never formatted or linked, inside “ ”. */
function Bubble({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground", className)}>{children}</p>;
}

/**
 * What a request would change, one line each. Lines shaped "Label: value" read as a definition list (the label in the
 * secondary grey); anything else as a plain list. Plain text throughout: a task title is someone's words.
 */
export function RequestLines({ lines, className }: { lines: string[]; className?: string }) {
  const rows = lines.map((line) => {
    const at = line.indexOf(": ");
    return at > 0 && at <= 32 ? { term: line.slice(0, at), value: line.slice(at + 2) } : { term: null, value: line };
  });
  if (rows.length && rows.every((r) => r.term)) {
    return (
      <dl className={cn("grid gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm min-[440px]:grid-cols-[auto_minmax(0,1fr)]", className)}>
        {rows.map((r, i) => (
          <Fragment key={i}>
            <dt className="text-meta font-normal text-secondary min-[440px]:pt-px">{r.term}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words font-normal text-foreground max-[439px]:mb-1">{r.value}</dd>
          </Fragment>
        ))}
      </dl>
    );
  }
  return (
    <ul className={cn("space-y-1 rounded-xl border border-border px-3 py-2 text-sm", className)}>
      {rows.map((r, i) => <li key={i} className="whitespace-pre-wrap break-words font-normal text-foreground">{r.term ? `${r.term}: ${r.value}` : r.value}</li>)}
    </ul>
  );
}

// ---- The card -------------------------------------------------------------------------------------------------------

export function AssistantItemCard({ orgSlug, item: given, timeZone, now, compact = false, embedded = false, id, highlight = false, className, onChange }: {
  orgSlug: string; item: AssistantItemView; timeZone: string; now: number;
  /** One row that opens into the whole card in place (lists, her page). */ compact?: boolean;
  /** Inside something that already shows the badge. */ embedded?: boolean;
  /** The card's element id. */ id?: string;
  /** The item a link pointed at: a 1px orange border. */ highlight?: boolean;
  className?: string;
  /** After a press changed it, with the item as it is now (a list keeps it on screen once the server drops it). */
  onChange?: (item: AssistantItemView) => void;
}) {
  const router = useRouter();
  const { personal } = useAssistant();
  const uid = useId();
  // The item as a press left it; the page's copy takes over once it is as new (the change stream refreshes the page).
  const [local, setLocal] = useState<AssistantItemView | null>(null);
  const item = local && local.id === given.id && Date.parse(local.updatedAt) >= Date.parse(given.updatedAt) ? local : given;
  const [busy, setBusy] = useState<ItemAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  /** The tone of `said`: an Accept's outcome reads the same in the row as in the whole card. */
  const [saidTone, setSaidTone] = useState<"neutral" | "success" | "danger">("neutral");
  const [failedNow, setFailedNow] = useState(false);
  /** A reply went from here: "Sent. Max passes it to Olu." stays under the card. */
  const [replied, setReplied] = useState(false);
  const [mode, setMode] = useState<"idle" | "reply" | "decline">("idle");
  const [text, setText] = useState("");
  const [muteOpen, setMuteOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const n = itemNames(item);
  const at = (iso: string) => whenLabel(iso, timeZone, new Date(now));
  const viewer = item.viewer;
  const received = viewer === "recipient";
  const note = item.kind === "report_note";
  const outcome = outcomeOf(item, { timeZone, now, yourName: personal.name });
  const titleId = `${uid}-title`;
  const fieldId = `${uid}-field`;
  const countId = `${uid}-count`;

  // The face beside it: the other person's assistant on what was brought to the person (quiet: it is not theirs), the
  // person's own on what they sent.
  const face = received || (note && viewer !== "sender")
    ? { profile: item.sender.assistant, own: false }
    : { profile: personal, own: true };

  async function reload() {
    try {
      const r = await api<{ item: AssistantItemView }>(`/api/orgs/${orgSlug}/assistant-items/${item.id}`);
      setLocal(r.item); onChange?.(r.item);
    } catch { /* the card keeps what it has */ }
  }

  /** Sends one press and takes the answer. Throws (for the confirm dialogs, which show why in place). */
  async function post(action: ItemAction, body?: Record<string, unknown>): Promise<AssistantItemView> {
    const r = await api<{ item: AssistantItemView }>(`/api/orgs/${orgSlug}/assistant-items/${item.id}/${action}`, { method: "POST", ...(body ? { body } : {}), retries: 1 });
    setLocal(r.item);
    onChange?.(r.item);
    router.refresh();
    return r.item;
  }

  function pressWords(action: ItemAction, next: AssistantItemView): string {
    switch (action) {
      case "seen": return "Marked as seen.";
      case "reply": return W.card.replySent(n.SA, n.S);
      case "decline": return W.card.declined;
      case "cancel": return "Request cancelled.";
      case "withdraw": return "Note withdrawn.";
      default: return next.status === "failed" ? "" : outcomeOf(next, { timeZone, now, yourName: personal.name })?.text ?? "Accepted.";
    }
  }

  async function press(action: ItemAction, body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(action); setError(null); setSaid(""); setSaidTone("neutral"); setFailedNow(false);
    try {
      const next = await post(action, body);
      setMode("idle"); setText("");
      setSaid(pressWords(action, next));
      if (action === "accept") setSaidTone(outcomeOf(next, { timeZone, now, yourName: personal.name })?.tone ?? "neutral");
      if (action === "reply") setReplied(true);
      // A request that could not be done says so as an alert, once, right after the press.
      if (action === "accept" && next.status === "failed") setFailedNow(true);
    } catch (err) {
      setError(failureText(err));
      // Already answered, expired or gone: show it as it is now.
      if (isApiFailure(err) && (err.error.status === 409 || err.error.status === 404)) void reload();
    } finally {
      setBusy(null);
    }
  }

  function start(next: "reply" | "decline") {
    setMode(next); setText(""); setError(null);
    requestAnimationFrame(() => field.current?.focus());
  }

  const actionable = item.canSeen || item.canReply || item.canAccept || item.canDecline || item.canCancel || item.canWithdraw;

  // ---- The one-line field: a reply, or the reason for declining ----
  const max = mode === "reply" ? REPLY_MAX : REASON_MAX;
  const lineForm = mode !== "idle" ? (
    <form className="min-w-0" onSubmit={(e) => {
      e.preventDefault();
      const words = text.replace(/\s+/g, " ").trim();
      if (mode === "reply") { if (words) void press("reply", { body: words }); }
      else void press("decline", { reason: words || null });
    }}>
      <label htmlFor={fieldId} className="mb-1.5 block text-meta font-medium text-foreground">{mode === "reply" ? W.card.replyPlaceholder : W.card.declinePlaceholder}</label>
      <Input ref={field} id={fieldId} fieldSize="sm" className="w-full" value={text} maxLength={max} disabled={!!busy}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setMode("idle"); } }}
        aria-describedby={text.length > COUNT_FROM ? countId : undefined} />
      {text.length > COUNT_FROM ? <p id={countId} className="mt-1 text-right text-xs font-normal tabular-nums text-subtle">{text.length} of {max}</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setMode("idle")}>{mode === "reply" ? "Cancel" : "Back"}</Button>
        {mode === "reply"
          ? <Button type="submit" variant="primary" size="sm" loading={busy === "reply"} disabled={!text.trim() || !!busy}>{W.card.sendReply}</Button>
          : <Button type="submit" variant="ghost" size="sm" loading={busy === "decline"} disabled={!!busy}>{W.card.decline}</Button>}
      </div>
    </form>
  ) : null;

  // ---- The buttons ----
  const buttons = mode !== "idle" ? lineForm : actionable ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {item.canSeen && !item.canAccept ? <Button variant="ghost" size="sm" loading={busy === "seen"} disabled={!!busy} onClick={() => void press("seen")}>{W.card.markSeen}</Button> : null}
      {/* Each opens its one-line field in place of the buttons, with the cursor in it. */}
      {item.canReply ? <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => start("reply")}>{W.card.reply}</Button> : null}
      {item.canDecline ? <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => start("decline")}>{W.card.decline}</Button> : null}
      {item.canAccept ? <Button variant="primary" size="sm" loading={busy === "accept"} disabled={!!busy} onClick={() => void press("accept")}><AnimatedCheck aria-hidden />{W.card.accept}</Button> : null}
      {item.canCancel ? (
        <ConfirmButton variant="ghost" size="sm" title={W.card.cancelConfirm} confirmLabel={W.card.cancelRequest} cancelLabel="Keep it" pendingLabel="Cancelling…"
          description={`${n.R} won't be asked any more, and nothing changes on ${possessive(n.R)} account.`}
          onConfirm={async () => { await post("cancel"); setSaid("Request cancelled."); }}>
          {W.card.cancelRequest}
        </ConfirmButton>
      ) : null}
      {item.canWithdraw ? (
        <ConfirmButton variant="ghost" size="sm" title={W.card.withdrawConfirm} confirmLabel={W.card.withdrawNote} cancelLabel="Keep it" pendingLabel="Withdrawing…"
          description="It won't go in today's team report."
          onConfirm={async () => { await post("withdraw"); setSaid("Note withdrawn."); }}>
          {W.card.withdrawNote}
        </ConfirmButton>
      ) : null}
    </div>
  ) : null;

  // ---- What it says, by kind and viewer ----
  const quoteLine = (label: React.ReactNode, words: string) => (
    <p className="mt-1.5 break-words text-meta font-normal text-secondary">{label} “<span className="whitespace-pre-wrap text-foreground">{words}</span>”</p>
  );
  const originLink = item.origin ? (
    <Link href={item.origin.href} prefetch={false} className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-sm text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:size-3.5 [&_svg]:shrink-0">
      <span className="min-w-0 truncate">{W.card.askedIn(item.origin.name)}</span><AnimatedArrowUpRight aria-hidden />
    </Link>
  ) : null;
  const outcomeLine = outcome ? (
    <p role={failedNow && outcome.tone === "danger" ? "alert" : undefined}
      className={cn("mt-1.5 whitespace-pre-wrap break-words text-meta font-normal", outcome.tone === "danger" ? "text-danger" : outcome.tone === "success" ? "text-success" : "text-secondary", outcome.working && "brenda-shimmer")}>
      {outcome.text}
    </p>
  ) : null;

  let title: React.ReactNode;
  let content: React.ReactNode;
  if (note) {
    title = viewer === "sender" ? itemTitle(item, timeZone, now) : <>Note from <strong className="font-semibold">{item.sender.name}</strong> for the team report</>;
    content = (
      <>
        <p className="mt-1.5 text-meta font-normal text-secondary">{viewer === "sender" ? `From you via ${personal.name}:` : `From ${n.S} via ${n.SA}:`}</p>
        <Bubble>“{item.body}”</Bubble>
        {item.tidied ? <p className="mt-1 text-xs font-normal text-subtle">{viewer === "sender" ? "Reworded as you asked." : W.card.reworded(n.SA, n.S)}</p> : null}
        {item.status === "delivered" && item.report?.open
          ? <p className="mt-1.5 text-meta font-normal text-secondary">{W.card.reportReadAt(timeLabel(item.report.cutoffAt, timeZone))}</p>
          : outcomeLine}
      </>
    );
  } else if (received && item.kind === "message") {
    title = <><strong className="font-semibold">{n.senderAssistant}</strong> {W.card.receivedMessage(n.S)}</>;
    content = (
      <>
        <Bubble>“{item.body}”</Bubble>
        <p className="mt-1 text-xs font-normal text-subtle">{item.tidied ? W.card.reworded(n.SA, n.S) : W.card.asSent(n.S)}</p>
        {originLink}
        {item.reply ? quoteLine("You replied:", item.reply.body) : null}
      </>
    );
  } else if (received && item.kind === "request" && item.request) {
    title = <><strong className="font-semibold">{n.senderAssistant}</strong> {W.card.receivedRequest}</>;
    content = (
      <>
        <p className="mt-2 text-meta font-medium text-foreground">{W.card.whatWouldChange}</p>
        <RequestLines lines={item.request.lines} className="mt-1.5" />
        {item.body ? <><p className="mt-2 text-meta font-medium text-foreground">{W.card.senderNote(n.S)}</p><Bubble>“{item.body}”</Bubble></> : null}
        {isOpenRequest(item) ? (
          <>
            <p className="mt-2 text-meta font-normal text-secondary">{W.card.nothingChanges(personal.name)}</p>
            <p className="mt-0.5 text-meta font-normal text-secondary">{W.card.expires(dateTimeLabel(item.request.expiresAt, timeZone))}</p>
          </>
        ) : outcomeLine}
        {originLink}
      </>
    );
  } else if (received) {
    // A reply to the person's own message.
    title = <><strong className="font-semibold">{n.S}</strong> replied to your message</>;
    content = (
      <>
        {item.replyTo ? <p className="mt-1 truncate text-meta font-normal text-secondary">Your message: “{item.replyTo.body}”</p> : null}
        <Bubble>“{item.body}”</Bubble>
      </>
    );
  } else if (item.kind === "message") {
    title = <>To <strong className="font-semibold">{n.recipientAssistant}</strong></>;
    content = (
      <>
        <Bubble>“{item.body}”</Bubble>
        {item.tidied ? <p className="mt-1 text-xs font-normal text-subtle">Reworded as you asked.</p> : null}
        {originLink}
        {item.seenAt ? <p className="mt-1.5 text-meta font-normal text-secondary">{W.card.hasSeen(n.R, at(item.seenAt))}</p>
          : <p className="mt-1.5 text-meta font-normal text-secondary">Delivered. {n.RA} passes it to {n.R}.</p>}
        {item.reply ? quoteLine(`${n.R} replied:`, item.reply.body) : null}
      </>
    );
  } else if (item.kind === "request" && item.request) {
    title = <>To <strong className="font-semibold">{n.recipientAssistant}</strong>: accept a change</>;
    content = (
      <>
        <RequestLines lines={item.request.lines} className="mt-2" />
        {item.body ? quoteLine("Your note:", item.body) : null}
        {outcomeLine}
        {originLink}
      </>
    );
  } else {
    // A reply the person sent to someone's message.
    title = <>Your reply to <strong className="font-semibold">{n.R}</strong></>;
    content = (
      <>
        {item.replyTo ? <p className="mt-1 truncate text-meta font-normal text-secondary">{possessive(n.R)} message: “{item.replyTo.body}”</p> : null}
        <Bubble>“{item.body}”</Bubble>
        {outcomeLine}
      </>
    );
  }

  // The menu on what was brought to the person: stop new items from that colleague's assistant.
  const menu = item.canMute && received && !muted ? (
    <Menu align="end" label={`Options for ${possessive(n.S)} item`}
      trigger={<IconButton size="xs" aria-label="More options" className="-my-1 -mr-1"><EllipsisVertical aria-hidden /></IconButton>}>
      <MenuItem onSelect={() => setMuteOpen(true)}>{W.card.mute(n.S)}</MenuItem>
    </Menu>
  ) : null;

  const full = (inside: boolean) => (
    <article id={inside ? undefined : id} tabIndex={!inside && id ? -1 : undefined} aria-labelledby={titleId}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && !inside && "border-accent-ring", !inside && className)}>
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={face.profile} own={face.own} className="mt-px" />
        <div className="min-w-0 flex-1">
          {/* No wrap: the badge and its menu stay top right at any width, so the menu (aligned to its end) opens on screen. */}
          <div className="flex items-start justify-between gap-x-3">
            <h3 id={titleId} className="min-w-0 flex-1 break-words text-sm font-normal text-foreground">
              {title}<span className="text-secondary">, <time dateTime={item.createdAt} className="tabular-nums">{at(item.createdAt)}</time></span>
            </h3>
            <span className="flex shrink-0 items-center gap-1.5">{embedded || inside ? null : <ItemBadge item={item} />}{menu}</span>
          </div>
          {content}
        </div>
      </div>
      {muted ? (
        <p className="text-meta font-normal text-secondary">
          You won&apos;t get new items from {possessive(n.S)} assistant. <Link href={`/app/${orgSlug}/settings?section=assistant#assistant-talk`} className="link-inline">Undo in Settings</Link>
        </p>
      ) : null}
      {replied ? <p className="text-meta font-normal text-secondary">{W.card.replySent(n.SA, n.S)}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {/* The one-line field lines up with the words above it (past the face); the buttons sit on the right. */}
      {mode !== "idle" ? <div className="min-[440px]:pl-7">{buttons}</div> : buttons}
    </article>
  );

  const muteDialog = (
    <ConfirmDialog open={muteOpen} onClose={() => setMuteOpen(false)} tone="primary" title={W.card.muteTitle(n.S)}
      description={W.card.muteBody(n.S, n.SA)}
      confirmLabel="Stop items" pendingLabel="Stopping…"
      onConfirm={async () => {
        await api(`/api/orgs/${orgSlug}/assistant-items/mutes`, { method: "PUT", body: { senderMembershipId: item.sender.membershipId, muted: true }, retries: 1 });
        setMuted(true); setSaid(`Stopped items from ${possessive(n.S)} assistant.`);
      }} />
  );
  // Only the result of a press is announced.
  const live = <p role="status" aria-live="polite" className="sr-only">{said}</p>;

  if (!compact) return <>{full(false)}{muteDialog}{live}</>;

  // ---- Compact: one row that opens in place ----
  const preview = itemPreview(item);
  const fullId = `${uid}-full`;
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={cn("min-w-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border border-accent-ring", className)}>
      <button type="button" aria-expanded={open} aria-controls={fullId} onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-75 hover:bg-fill-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <AssistantFace profile={face.profile} own={face.own} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 break-words text-sm font-medium text-foreground">
              {itemTitle(item, timeZone, now)}<span className="font-normal text-secondary">, <span className="tabular-nums">{at(item.createdAt)}</span></span>
            </span>
            <ItemBadge item={item} className="shrink-0" />
          </span>
          {/* A request the person can accept from this row shows all of what it asks, never clipped to two lines. */}
          {preview ? <span className={cn("mt-0.5 whitespace-pre-wrap break-words text-meta font-normal text-secondary", !item.canAccept && "line-clamp-2")}>{preview}</span> : null}
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div id={fullId} className="mt-1">{full(true)}</div> : (
        // Waiting for the person: answer it from the row; what a press did shows under it.
        (item.canAccept || item.canDecline || item.canSeen || item.canReply) || mode !== "idle" || error || said || failedNow ? (
          <div className="space-y-2 pb-2 pl-[38px] pr-2">
            {said ? <p className={cn("text-meta font-normal", saidTone === "success" ? "text-success" : saidTone === "danger" ? "text-danger" : "text-secondary")}>{said}</p> : failedNow ? outcomeLine : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {buttons}
          </div>
        ) : null
      )}
      {muteDialog}{live}
    </div>
  );
}
