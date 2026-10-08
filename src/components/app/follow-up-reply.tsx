"use client";

/**
 * "Waiting for you" (owner decision, 8 October 2026: personal assistants, phase 4). When someone's follow-up cannot be
 * answered from the person's recent work (or they chose "Always ask me first"), their own assistant asks them once:
 * this card, on their assistant's page, on "Asked about you" and on the follow-up's own page (the bell and the notch
 * carry the same ask). One tap answers it: On track, Blocked, Done or Not started, with a line of their own if they
 * like (typed or dictated, at most 280 characters), or "Not now". Their reply goes back as their own words, quoted;
 * it never changes the task ("Done" is words, not a status change: the card says so and links the task).
 *
 * The asking assistant's face is drawn in its own look and stays quiet (it is not the person's own). What their
 * assistant will share is one disclosure away, so the person knows exactly what goes back. "Send reply" is a white
 * primary (the screen's one orange button stays with the app's other standout); it waits for a choice.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Mic } from "lucide-react";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { CountPill } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm";
import { StatusDot } from "@/components/ui/status-dot";
import { AssistantFace, byLabel, namesOf } from "@/components/app/follow-up-exchange";
import { useAssistant } from "@/components/app/assistant-context";
import { useDictation } from "@/hooks/use-dictation";
import { api, isApiFailure } from "@/lib/api-client";
import { factLines, FOLLOW_UP_LIMITS, REPLY_LABELS, type FollowUpView, type ReplyChoice } from "@/lib/follow-ups";
import { cn } from "@/lib/utils";

/** The four quick replies, in this order; "Not now" is its own button. */
const CHOICES = ["on_track", "blocked", "done", "not_started"] as const satisfies readonly ReplyChoice[];
const NOTE_MAX = FOLLOW_UP_LIMITS.noteMax;
/** The counter shows from here on. */
const COUNT_FROM = 240;

/** What a failed reply says: the server's own words (409 "This follow-up is already closed."), or how to recover. */
function failureText(err: unknown): string {
  if (isApiFailure(err)) return err.error.message;
  return "Cannot reach the server. Check your connection and try again.";
}

export function FollowUpReplyCard({ orgSlug, view, timeZone, now, onDone, className, id, highlight = false }: {
  orgSlug: string; view: FollowUpView; timeZone: string; now: number;
  /** After the reply went through, with the follow-up as it is now and what was chosen. */
  onDone?: (view: FollowUpView, choice: ReplyChoice) => void;
  className?: string;
  /** The card's element id (a link's `?f=` scrolls to it). */ id?: string;
  /** The ask a link pointed at: a 1px orange border on the card (not the list row's marker). */ highlight?: boolean;
}) {
  const router = useRouter();
  const { personal } = useAssistant();
  const uid = useId();
  const [choice, setChoice] = useState<(typeof CHOICES)[number] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"send" | "not_now" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReplyChoice | null>(null);
  const dictation = useDictation(note, (t) => setNote(t.slice(0, NOTE_MAX)));
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const names = namesOf(view, personal.name);
  const workspace = !view.requester;
  // In a thread it is the person's own assistant asking them (the tagger's question, posted back there).
  const askerProfile = view.thread ? personal : view.requester?.assistant ?? view.workspaceAssistant ?? personal;
  const by = view.deadlineAt ? byLabel(view.deadlineAt, timeZone, now) : null;
  // Asked in a conversation (phase 6): the reply is posted there for everyone, and nothing from the work is shared.
  const thread = view.thread;
  const facts = !thread && view.facts && view.facts.v === 1 ? factLines(view.facts, { timeZone, now: new Date(now), first: view.subject.firstName, forSubject: true, asker: view.requester?.firstName ?? null }) : [];

  async function reply(c: ReplyChoice) {
    if (busy) return;
    setError(null); setNoteError(null);
    let words = note;
    // Still dictating: what is being said is part of the reply.
    if (c !== "not_now" && (dictation.listening || dictation.busy)) {
      const said = await dictation.stop();
      if (said === null) return; // the dictation failed or was cancelled: the card stays as it is
      words = said.slice(0, NOTE_MAX);
    } else if (dictation.listening || dictation.busy) dictation.cancel();
    setBusy(c === "not_now" ? "not_now" : "send");
    try {
      const trimmed = words.trim();
      const r = await api<{ followUp: FollowUpView }>(`/api/orgs/${orgSlug}/follow-ups/${view.id}/reply`, {
        method: "POST", body: { choice: c, ...(c !== "not_now" && trimmed ? { note: trimmed } : {}) }, retries: 1,
      });
      setSent(c);
      onDone?.(r.followUp, c);
      router.refresh();
    } catch (err) {
      const field = isApiFailure(err) ? err.error.fieldErrors?.note?.[0] : undefined;
      if (field) setNoteError(field); else setError(failureText(err));
    } finally {
      setBusy(null);
    }
  }

  // Radio behaviour: the arrows move the choice (and the focus) round the four; Home and End jump to the ends.
  function onRadioKey(e: React.KeyboardEvent<HTMLButtonElement>, at: number) {
    const keys: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: CHOICES.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + CHOICES.length) % CHOICES.length;
    setChoice(CHOICES[next]);
    radios.current[next]?.focus();
  }

  if (sent) {
    return (
      <div id={id} role="status" className={cn("card-panel flex items-start gap-2.5 p-4 text-sm", className)}>
        <span aria-hidden className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-success/12 text-success"><Check className="size-3" /></span>
        <span className="min-w-0 font-normal text-foreground">
          {/* "Not now" says what happens instead, as the notch does (visual review, 8 October 2026). */}
          {thread
            ? sent === "not_now" ? `Done. ${personal.name} says in ${thread.where} that you can't answer right now.` : `Sent. Your reply is posted in ${thread.where}${thread.direct ? "" : " for everyone there"}.`
            : sent === "not_now"
            ? workspace ? `Told ${names.askerAssistantName} you can't answer right now. The report gets what your work shows instead.` : `Told ${names.askerAssistantName} you can't answer right now. ${names.askerAssistantName} gets what your work shows instead.`
            : `Sent. ${workspace ? `${names.askerAssistantName} puts your answer in today's team report.` : `${names.askerAssistantName} gets your answer.`}`}
        </span>
      </div>
    );
  }

  const noteId = `${uid}-note`;
  const countId = `${uid}-count`;
  const hintId = `${uid}-hint`;
  const tabStop = choice ? CHOICES.indexOf(choice) : 0;
  const listening = dictation.listening;

  return (
    <section id={id} tabIndex={id ? -1 : undefined} aria-labelledby={`${uid}-title`}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border-accent-ring", className)}>
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={askerProfile} own={!!view.thread} className="mt-px" />
        <div className="min-w-0 flex-1">
          <h3 id={`${uid}-title`} className="text-sm font-normal text-foreground">
            {thread ? <><strong className="font-semibold">{view.requester?.firstName ?? "Someone"}</strong> asked {personal.name} in {thread.direct ? "your chat" : thread.where}.</>
              : workspace ? <><strong className="font-semibold">{names.asker}</strong> is collecting updates for today&apos;s team report.</>
              : view.task ? <><strong className="font-semibold">{names.asker}</strong> wants an update on “{view.task.title}”.</>
              : <><strong className="font-semibold">{names.asker}</strong> wants to know what you&apos;re working on.</>}
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground">“{view.question}”</p>
          {by ? (
            <p className="mt-1.5 text-meta font-normal text-secondary">
              Reply by <span className="tabular-nums">{by}</span>. {thread
                ? `Your reply is posted in ${thread.where}${thread.direct ? "" : " for everyone there"}. If you don't reply, ${personal.name} says so there.`
                : workspace ? "Your reply goes in the report your team lead, the owner and HR receive." : `If you don't, ${names.askerAssistantName} gets what your work shows.`}
            </p>
          ) : null}
        </div>
      </div>

      <div role="radiogroup" aria-label="Your answer" className="flex flex-wrap gap-2">
        {CHOICES.map((c, i) => {
          const on = choice === c;
          return (
            <button key={c} ref={(el) => { radios.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={i === tabStop ? 0 : -1}
              disabled={!!busy} onClick={() => setChoice(c)} onKeyDown={(e) => onRadioKey(e, i)}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 pointer-coarse:h-10",
                on ? "border-foreground bg-fill-1 text-foreground" : "border-border-input text-secondary hover:border-border-input-hover hover:text-foreground")}>
              {/* The choice mark: a small orange dot, as on a segmented control (accent rules). */}
              {on ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
              {REPLY_LABELS[c]}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor={noteId} className="mb-1.5 block text-meta font-medium text-foreground">Add a line, if you like</label>
        <div className="flex items-center gap-2">
          <Input id={noteId} fieldSize="sm" className="min-w-0 flex-1" value={note} maxLength={NOTE_MAX} disabled={!!busy || dictation.busy}
            onChange={(e) => { setNote(e.target.value); setNoteError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && choice && !busy) { e.preventDefault(); void reply(choice); } }}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={[note.length > COUNT_FROM ? countId : null, noteError ? `${noteId}-error` : null].filter(Boolean).join(" ") || undefined}
            placeholder={listening ? "Listening…" : undefined} />
          {/* Dictation where this browser can do it; hidden where it cannot. */}
          {dictation.supported === true ? (
            <IconButton aria-label="Dictate a line" aria-pressed={listening} data-tip={listening ? "Stop dictating" : "Dictate a line"} disabled={!!busy || dictation.busy}
              onClick={() => void dictation.toggle()} className={cn(listening && "bg-fill-1 text-accent hover:text-accent")}>
              <Mic aria-hidden />
            </IconButton>
          ) : null}
        </div>
        <div aria-live="polite" className="text-meta font-normal">
          {listening ? <p className="mt-1.5 flex items-center gap-1.5 text-secondary"><StatusDot tone="live" size={6} />Listening… press the microphone again to stop.</p>
            : dictation.busy ? <p className="brenda-shimmer mt-1.5">Writing out what you said…</p> : null}
        </div>
        {note.length > COUNT_FROM ? <p id={countId} className="mt-1 text-right text-xs font-normal tabular-nums text-subtle">{note.length} of {NOTE_MAX}</p> : null}
        {noteError ? <p id={`${noteId}-error`} role="alert" className="mt-1.5 text-meta font-medium text-danger">{noteError}</p> : null}
        {dictation.error ? <p role="alert" className="mt-1.5 text-meta font-normal text-warning">{dictation.error}</p> : null}
      </div>

      {facts.length ? (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-meta font-medium text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 -rotate-90 transition-transform duration-150 group-open:rotate-0 motion-reduce:transition-none" aria-hidden />What your assistant will share
          </summary>
          <ul className="mt-1.5 space-y-1 pl-[18px] text-meta font-normal text-secondary">
            {facts.map((line, i) => <li key={i} className="list-disc break-words marker:text-subtle">{line}</li>)}
          </ul>
        </details>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id={hintId} className="min-w-0 text-xs font-normal text-subtle">
          {view.task ? "This doesn't change the task." : "This doesn't change any of your tasks."}
          {view.task ? <> <Link href={view.task.href} className="link-inline inline-flex items-center gap-0.5 font-normal text-secondary [&_svg]:size-3">Open the task<AnimatedArrowUpRight aria-hidden /></Link></> : null}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" loading={busy === "not_now"} disabled={!!busy} onClick={() => void reply("not_now")}>Not now</Button>
          <Button variant="primary" size="sm" loading={busy === "send"} disabled={!choice || !!busy} aria-describedby={hintId} onClick={() => choice && void reply(choice)}>Send reply</Button>
        </div>
      </div>
    </section>
  );
}

/**
 * The person's asks waiting for a reply, under "Waiting for you" with an orange count (it asks them to act). On her home
 * screen at most two cards show, then "See all {n}". A card that has just been answered stays, collapsed to "Sent.",
 * after the page refreshes without it, so the person sees their reply went.
 */
export function WaitingForYou({ orgSlug, items, timeZone, now, max, seeAllHref, title = "Waiting for you", cardClassName, highlight, className }: {
  orgSlug: string; items: FollowUpView[]; timeZone: string; now: number;
  /** Cards shown at most; the rest behind "See all {n}" (`seeAllHref`). */ max?: number; seeAllHref?: string;
  /** The section's title; null for none (the follow-up's own page). */ title?: string | null;
  cardClassName?: string;
  /** A card to mark and scroll to (`?f=`). */ highlight?: string | null;
  className?: string;
}) {
  // Answered here: kept on screen (collapsed) once the refreshed page no longer lists them.
  const [answered, setAnswered] = useState<FollowUpView[]>([]);
  const titleId = useId();
  const shown = [...items, ...answered.filter((a) => !items.some((i) => i.id === a.id))];
  const visible = max ? shown.slice(0, max) : shown;
  const waiting = items.length;
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`follow-up-${highlight}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight]);
  if (!shown.length) return null;
  return (
    <section aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Your reply"} className={cn("min-w-0", className)}>
      {title ? (
        <SectionTitle id={titleId} title={<span className="inline-flex items-center gap-2">{title}<CountPill count={waiting} tone="attention" /></span>}
          action={max && waiting > max && seeAllHref ? <Link href={seeAllHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>See all {waiting}</Link> : undefined} />
      ) : null}
      <ul className="space-y-3">
        {visible.map((v) => (
          <li key={v.id}>
            <FollowUpReplyCard orgSlug={orgSlug} view={v} timeZone={timeZone} now={now} className={cardClassName} id={`follow-up-${v.id}`} highlight={highlight === v.id}
              onDone={() => setAnswered((cur) => (cur.some((x) => x.id === v.id) ? cur : [...cur, v]))} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Cancel follow-up" on the follow-up's own page, for the person who asked while it is still open: a quiet button that
 * asks first ("Cancel it" / "Keep asking"). Nothing more is shared once it is cancelled.
 */
export function CancelFollowUpButton({ orgSlug, view }: { orgSlug: string; view: FollowUpView }) {
  const router = useRouter();
  const { personal } = useAssistant();
  const { answerer, S } = namesOf(view, personal.name);
  return (
    <ConfirmButton variant="ghost" size="sm" title="Cancel this follow-up?" confirmLabel="Cancel it" cancelLabel="Keep asking" pendingLabel="Cancelling…"
      description={view.status === "asking" ? `${answerer} stops waiting for ${S}, and nothing more is shared.` : `${answerer} stops, and nothing is shared.`}
      onConfirm={async () => {
        await api(`/api/orgs/${orgSlug}/follow-ups/${view.id}/cancel`, { method: "POST", retries: 1 });
        router.refresh();
      }}>
      Cancel follow-up
    </ConfirmButton>
  );
}
