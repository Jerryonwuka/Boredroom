"use client";

/**
 * "Ben is blocked on you" (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed", blocked on whom;
 * contract E and H.3): when someone marks their task blocked and names who it waits on, that person's own assistant
 * brings them the question in "Between assistants" (a `LoopInboxItem` of kind `blocked_on`), on her page's "Waiting for
 * you", and as the notch's card.
 *
 * The card, in assistant-item-card's anatomy: the blocked person's assistant's face (quiet: it is not the viewer's), "Ben
 * is blocked on you" and the time, "On “Landing page”" (a link to the task only when the viewer may open it; otherwise
 * the title Ben sent, as plain text), Ben's question as typed in a bubble inside “ ”, then **Not me** (ghost) and
 * **Answer** (white, the card's one primary). Answer opens an inline `Textarea` ("Your answer", up to 1,000 characters),
 * a `Checkbox` "This unblocks it" and **Send answer**: the answer is posted as the person's own comment on the task, and
 * "This unblocks it" moves the task back to In progress (contract, decision 8). Not me tells Ben it isn't theirs.
 *
 * Opening the card marks it seen (POST …/seen, once per page). Each press goes to
 * `/api/orgs/{org}/task-blocks/{id}/{answer|not-me}` and the card takes the block the server answers with. Plain text
 * throughout: the question and the answer are people's words, never Markdown, never linked. `compact`: one row that opens
 * in place, the buttons kept under the row while it waits.
 */
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { AssistantFace } from "@/components/app/follow-up-exchange";
import { failureText } from "@/components/app/assistant-item-card";
import { QuietLink } from "@/components/app/commitment-card";
import { api, isApiFailure } from "@/lib/api-client";
import { clip, whenLabel } from "@/lib/follow-ups";
import { LOOP_LIMITS, LOOP_WORDS, type TaskBlockView } from "@/lib/commitments";
import { cn } from "@/lib/utils";

const W = LOOP_WORDS.inbox;
const ANSWER_MAX = LOOP_LIMITS.answerMax;
const COUNT_FROM = 900;

const seen = new Set<string>();
/** Marks a block seen once per page (the definer answers 'ok' again anyway). */
export function markBlockSeen(orgSlug: string, id: string) {
  if (seen.has(id)) return;
  seen.add(id);
  api(`/api/orgs/${orgSlug}/task-blocks/${id}/seen`, { method: "POST", retries: 1 }).catch(() => seen.delete(id));
}

/** Still waiting for the viewer's answer. */
export const blockWaiting = (b: TaskBlockView) => b.status === "open" && (b.canAnswer || b.canNotMe);

/** What became of a block, in words for the person it waited on. */
export function blockOutcome(b: TaskBlockView): { text: string; tone: "neutral" | "success" } | null {
  const first = b.blocked.firstName;
  switch (b.status) {
    case "answered": return { text: b.answer ? `You answered: “${b.answer}”${b.unblocked ? ` It's back in progress.` : ""}` : W.answered(first), tone: "success" };
    case "not_me": return { text: W.notMeDone(first), tone: "neutral" };
    case "cleared": return { text: `${first} isn't blocked on it any more.`, tone: "neutral" };
    case "cancelled": return { text: `${first} withdrew the question.`, tone: "neutral" };
    default: return null;
  }
}

export function BlockCard({ orgSlug, block: given, timeZone, now, compact = false, id, highlight = false, className, onChange }: {
  orgSlug: string; block: TaskBlockView; timeZone: string; now: number;
  compact?: boolean; id?: string; highlight?: boolean; className?: string;
  onChange?: (b: TaskBlockView) => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [local, setLocal] = useState<TaskBlockView | null>(null);
  // A press's answer stands until the page's copy has moved on from open too.
  const b = local && local.id === given.id && local.status !== "open" && given.status === "open" ? local : given;
  const [busy, setBusy] = useState<"answer" | "not-me" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [mode, setMode] = useState<"idle" | "answer">("idle");
  const [text, setText] = useState("");
  const [unblock, setUnblock] = useState(false);
  const [open, setOpen] = useState(false);
  const waiting = blockWaiting(b);
  const first = b.blocked.firstName;
  const titleId = `${uid}-title`;
  const at = (iso: string) => whenLabel(iso, timeZone, new Date(now));

  useEffect(() => {
    if (b.viewer === "waiting_on" && waiting && !b.seenAt && (!compact || open)) markBlockSeen(orgSlug, b.id);
  }, [orgSlug, b.id, b.viewer, b.seenAt, waiting, compact, open]);

  // No single-block read in the contract: the page's refresh brings the block as it is now.
  const reload = () => router.refresh();

  async function press(action: "answer" | "not-me", body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(action); setError(null); setSaid("");
    try {
      const r = await api<{ block: TaskBlockView }>(`/api/orgs/${orgSlug}/task-blocks/${b.id}/${action}`, { method: "POST", ...(body ? { body } : {}), retries: 1 });
      setLocal(r.block); onChange?.(r.block);
      setMode("idle"); setText("");
      setSaid(action === "answer" ? W.answered(first) : W.notMeDone(first));
      router.refresh();
    } catch (err) {
      setError(failureText(err));
      if (isApiFailure(err) && (err.error.status === 409 || err.error.status === 404)) reload();
    } finally { setBusy(null); }
  }

  const answerForm = mode === "answer" ? (
    <form className="min-w-0 space-y-2" onSubmit={(e) => {
      e.preventDefault();
      const words = text.trim();
      if (!words) { setError(LOOP_WORDS.errors.emptyAnswer); return; }
      void press("answer", { answer: words, unblock });
    }}>
      <label htmlFor={`${uid}-answer`} className="block text-meta font-medium text-foreground">{W.answerPlaceholder}</label>
      <Textarea id={`${uid}-answer`} className="min-h-20 w-full" value={text} maxLength={ANSWER_MAX} disabled={!!busy} autoFocus
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setMode("idle"); } }}
        aria-describedby={`${uid}-where${text.length > COUNT_FROM ? ` ${uid}-count` : ""}`} />
      {text.length > COUNT_FROM ? <p id={`${uid}-count`} className="text-right text-xs font-normal tabular-nums text-subtle">{text.length} of {ANSWER_MAX}</p> : null}
      <p id={`${uid}-where`} className="text-meta font-normal text-secondary">{first} sees it as your comment on the task.</p>
      <Checkbox checked={unblock} disabled={!!busy} onChange={(e) => setUnblock(e.target.checked)}
        hint={`The task goes back to In progress for ${first}.`}>{W.unblocks}</Checkbox>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setMode("idle")}>Back</Button>
        <Button type="submit" variant="primary" size="sm" loading={busy === "answer"} disabled={!!busy || !text.trim()}>{W.sendAnswer}</Button>
      </div>
    </form>
  ) : null;

  const buttons = !waiting ? null : mode === "answer" ? answerForm : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {b.canNotMe ? <Button variant="ghost" size="sm" loading={busy === "not-me"} disabled={!!busy} onClick={() => void press("not-me")}>{W.notMe}</Button> : null}
      {b.canAnswer ? <Button variant="primary" size="sm" disabled={!!busy} onClick={() => { setMode("answer"); setError(null); }}>{W.answer}</Button> : null}
    </div>
  );

  const outcome = waiting ? null : blockOutcome(b);
  const taskTitle = clip(b.taskTitle, 80);
  const onTask = b.taskHref ? <QuietLink href={b.taskHref}>{W.blockedOn(taskTitle)}</QuietLink> : <span className="text-meta font-normal text-secondary">{W.blockedOn(taskTitle)}</span>;

  const full = (inside: boolean) => (
    <article id={inside ? undefined : id} tabIndex={!inside && id ? -1 : undefined} aria-labelledby={titleId}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && !inside && "border-accent-ring", !inside && className)}>
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={b.blocked.assistant} own={false} className="mt-px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={titleId} className="min-w-0 flex-[1_1_12rem] break-words text-sm font-normal text-foreground">
              <strong className="font-semibold">{W.blockedTitle(first)}</strong><span className="text-secondary">, <time dateTime={b.createdAt} className="tabular-nums">{at(b.createdAt)}</time></span>
            </h3>
            {inside ? null : <Badge tone={b.badge.tone} className="shrink-0">{b.badge.label}</Badge>}
          </div>
          <div className="mt-1">{onTask}</div>
          <p className="mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground">“{b.question}”</p>
          {outcome ? <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-meta font-normal", outcome.tone === "success" ? "text-success" : "text-secondary")}>{outcome.text}</p> : null}
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {buttons ? <div className={mode === "idle" ? undefined : "min-[440px]:pl-7"}>{buttons}</div> : null}
    </article>
  );
  const live = <p role="status" aria-live="polite" className="sr-only">{said}</p>;

  if (!compact) return <>{full(false)}{live}</>;

  const fullId = `${uid}-full`;
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={cn("min-w-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border border-accent-ring", className)}>
      <button type="button" aria-expanded={open} aria-controls={fullId} onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-75 hover:bg-fill-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <AssistantFace profile={b.blocked.assistant} own={false} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 flex-[1_1_12rem] break-words text-sm font-medium text-foreground">
              {W.blockedTitle(first)}<span className="font-normal text-secondary">, <span className="tabular-nums">{at(b.createdAt)}</span></span>
            </span>
            <Badge tone={b.badge.tone} className="shrink-0">{b.badge.label}</Badge>
          </span>
          <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-meta font-normal text-secondary">{W.blockedOn(taskTitle)}: “{b.question}”</span>
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div id={fullId} className="mt-1">{full(true)}</div> : (
        waiting || said || error ? (
          <div className="space-y-2 pb-2 pl-[38px] pr-2">
            {said ? <p className="text-meta font-normal text-secondary">{said}</p> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {buttons}
          </div>
        ) : null
      )}
      {live}
    </div>
  );
}
