"use client";

/**
 * A follow-up between two assistants, drawn as a short exchange (owner decision, 8 October 2026: personal assistants,
 * phase 4: "instead of following up with the people, the assistants follow up with each other's assistants"). One
 * hairline card: the asking assistant's face and line ("Olu's Max asked Ben's Brenda, 15:40") with the status badge,
 * the question in a bubble and the task it is about; then the answering assistant's face and line ("Ben's Brenda, 15:41,
 * answered from Ben's work"), the answer in a bubble, the person's own reply when there is one, and what was shared
 * (`factLines`) behind a disclosure.
 *
 * Everything other people wrote (the question, the answer, a reply note, a task title, the facts) is plain text: never
 * Markdown, never a link (review, 8 October 2026). The only link is the task's own page.
 *
 * Both assistants keep their names everywhere ("Olu's Max asked Ben's Brenda"), except the subject's view of their own
 * assistant's line, which reads "Your Brenda" (`useAssistant().personal.name`). Other people's assistants are drawn in
 * their own look through `AssistantScope`, and only the viewer's own face may talk along while their assistant speaks
 * (the rest are `quiet`). A workspace row (the collection before the end-of-day report) is signed by the workspace's own
 * assistant ("Brenda, for today's team report, asked Ben's Brenda").
 *
 * `compact`: one line per follow-up (the answering face, the person, the badge, the answer clamped to two lines) that
 * opens into the full card in place; used in a group's list and the live card in her chat. `embedded`: the full card
 * inside something that already shows its badge (an opened compact row, "Show all" in the chat card), so its own
 * header badge is left out (visual review, 8 October 2026).
 *
 * An answer the AI wrote says so under it ("Written by AI from Ben's work"), so nobody takes it for the person's own
 * words (security review, 8 October 2026).
 */
import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { BrendaFace } from "@/components/app/brenda-face";
import { AssistantScope, useAssistant } from "@/components/app/assistant-context";
import { badgeOf, deadlineLabel, factLines, failureWords, whenLabel, REPLY_LABELS, type FollowUpView } from "@/lib/follow-ups";
import type { AssistantProfile } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/** The browser's own zone: where a caller has no organisation zone to give (the drawer's chat). */
export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/**
 * A deadline in "by" wording (C.5): "15:30" today, "12:00 tomorrow", else "Mon 12 Oct 12:00". Times are in the
 * organisation's time zone.
 */
export function byLabel(iso: string, timeZone: string, now: number): string {
  return deadlineLabel(iso, timeZone, new Date(now));
}

const possessive = (first: string) => `${first}'s`;

/** Who is who in one follow-up, in words, for the viewer. */
export function namesOf(view: FollowUpView, yourName: string) {
  const S = view.subject.firstName;
  const SA = view.subject.assistant.name;
  const subjectView = view.viewer === "subject";
  /** The answering assistant: "Ben's Brenda", or "Your Brenda" in the subject's own view. */
  const answerer = subjectView ? `Your ${yourName}` : `${possessive(S)} ${SA}`;
  /** The asking assistant: "Olu's Max", or the workspace's own ("Brenda"). */
  const asker = view.requester ? `${possessive(view.requester.firstName)} ${view.requester.assistant.name}` : view.workspaceAssistant?.name ?? "Brenda";
  return { S, SA, subjectView, answerer, asker, askerAssistantName: view.requester?.assistant.name ?? view.workspaceAssistant?.name ?? "Brenda" };
}

/**
 * Why a follow-up could not go on, in words for the viewer (C.7's words for the person who asked); nothing was shared.
 * The subject's own view says it from their side.
 */
export function failureFor(view: FollowUpView): string {
  if (view.viewer === "subject") {
    const R = view.requester?.firstName ?? "The workspace";
    return view.failure === "not_allowed" ? `${R} can no longer follow up on you, so nothing was shared.`
      : view.failure === "task_gone" ? "That task was removed or moved, so nothing was shared."
      : "Something went wrong, so nothing was shared.";
  }
  return failureWords(view.failure ?? "error", view.subject.firstName);
}

/**
 * Where an unanswered follow-up stands, in one sentence: "Asking Ben's Brenda…", "Ben's Brenda asked Ben. Reply due by
 * 19:41.", "Writing the answer…"; for a closed one without an answer, why. `shimmer` marks the working states.
 */
export function progressWords(view: FollowUpView, timeZone: string, now: number, yourName: string): { text: string; shimmer: boolean } {
  const { S, answerer, subjectView } = namesOf(view, yourName);
  switch (view.status) {
    case "pending": return { text: subjectView ? `${answerer} is looking at your work…` : `Asking ${answerer}…`, shimmer: true };
    case "asking": {
      const by = view.deadlineAt ? byLabel(view.deadlineAt, timeZone, now) : null;
      return { text: subjectView ? `${answerer} asked you.${by ? ` Reply by ${by}.` : ""}` : `${answerer} asked ${S}.${by ? ` Reply due by ${by}.` : ""}`, shimmer: false };
    }
    case "answering": return { text: "Writing the answer…", shimmer: true };
    case "cancelled": return { text: "Cancelled before it was answered.", shimmer: false };
    case "failed": return { text: failureFor(view), shimmer: false };
    default: return { text: view.answer ?? "", shimmer: false };
  }
}

/** The status in a word or two (`badgeOf`): Starting, Waiting for Ben, Writing the answer, Answered, No reply, Not now, Cancelled, Couldn't follow up. */
export function FollowUpBadge({ view, className }: { view: Pick<FollowUpView, "status" | "subject">; className?: string }) {
  const b = badgeOf(view);
  return <Badge tone={b.tone} className={className}>{b.label}</Badge>;
}

/** An assistant's small face in its own look; only the viewer's own may talk along while their assistant speaks. */
export function AssistantFace({ profile, own, className }: { profile: AssistantProfile; own: boolean; className?: string }) {
  return <AssistantScope profile={profile}><BrendaFace size="sm" quiet={!own} className={className} /></AssistantScope>;
}

/** A bubble of someone's words: plain text, lines kept, never formatted or linked. */
function Bubble({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 whitespace-pre-wrap break-words rounded-2xl bg-fill-1 px-3.5 py-2 text-sm font-normal text-foreground", className)}>{children}</p>;
}

export function FollowUpExchange({ view, timeZone, now, compact = false, embedded = false, id, className, highlight = false }: {
  view: FollowUpView; timeZone: string; now: number; compact?: boolean;
  /** Inside something that already shows the status badge: no badge of its own. */ embedded?: boolean;
  /** The card's element id (the subject's list scrolls to `?f=`). */ id?: string;
  className?: string;
  /** The card a link pointed at: a 1px orange border (not the list row's marker). */ highlight?: boolean;
}) {
  const { personal } = useAssistant();
  if (compact) return <CompactExchange view={view} timeZone={timeZone} now={now} yourName={personal.name} />;
  const names = namesOf(view, personal.name);
  const { S, subjectView, answerer, asker } = names;
  const at = (iso: string | null) => (iso ? whenLabel(iso, timeZone, new Date(now)) : null);
  const workspace = !view.requester;
  const askerProfile = view.requester?.assistant ?? view.workspaceAssistant ?? personal;
  const askLine = workspace ? `${asker}, for today's team report, asked ${possessive(S)} ${view.subject.assistant.name}` : `${asker} asked ${possessive(S)} ${view.subject.assistant.name}`;
  const terminal = view.status === "answered" || view.status === "expired" || view.status === "declined";
  // How the answer came about, after the answering assistant's name and time. A reply in the same minute as the answer
  // is not timed twice ("Ben's Brenda, 05:50, from Ben's reply").
  const repliedAt = at(view.repliedAt ?? view.reply?.at ?? null);
  const how = view.answeredFrom === "person"
    ? view.reply?.choice === "not_now" ? (subjectView ? "you said not now" : `${S} said not now`)
      : repliedAt && repliedAt === at(view.answeredAt) ? `from ${subjectView ? "your" : possessive(S)} reply`
      : `${subjectView ? "you" : S} replied at ${repliedAt ?? ""}`.trimEnd()
    : view.answeredFrom === "deadline" ? `no reply by ${view.deadlineAt ? byLabel(view.deadlineAt, timeZone, now) : "the time given"}`
    : `answered from ${subjectView ? "your" : possessive(S)} work`;
  const waiting = progressWords(view, timeZone, now, personal.name);
  // While the person is being asked, what happens if they do not reply.
  const ifNoReply = view.status === "asking" && view.deadlineAt
    ? subjectView
      ? `${answerer} asked you. If you don't reply by ${byLabel(view.deadlineAt, timeZone, now)}, ${names.askerAssistantName} gets what your work shows.`
      : workspace
        ? `${answerer} asked ${S}. If ${S} doesn't reply by ${byLabel(view.deadlineAt, timeZone, now)}, the report gets what ${possessive(S)} work shows.`
        : `${answerer} asked ${S}. If ${S} doesn't reply by ${byLabel(view.deadlineAt, timeZone, now)}, ${names.askerAssistantName} gets what ${possessive(S)} work shows.`
    : null;
  // What was shared: once answered; for the subject, also what their assistant will share while it is still open.
  // Nothing is shown for a cancelled or failed one, where nothing was shared.
  const open = view.status === "pending" || view.status === "asking" || view.status === "answering";
  const facts = view.facts && view.facts.v === 1 && (terminal || (subjectView && open))
    ? factLines(view.facts, { timeZone, now: new Date(now), first: S, forSubject: subjectView, asker: subjectView ? view.requester?.firstName ?? null : null }) : [];
  const sharedLabel = subjectView ? (terminal ? "What your assistant shared" : "What your assistant will share") : `What ${answerer} shared`;
  const replyLabel = subjectView ? "Your reply" : `${possessive(S)} reply`;
  // The reply under the answer only when the answer does not already say it: Boredroom's own answer opens with the
  // choice and the note in quotes, and "said not now" is in the line above (visual review, 8 October 2026).
  const note = view.reply?.note?.replace(/\s+/g, " ").trim() ?? "";
  const replySaid = !!view.reply && !!view.answer && (view.reply.choice === "not_now" || (note ? view.answer.includes(note.slice(0, 40)) : view.answerEngine !== "claude"));
  const byAi = view.answerEngine === "claude" && !!view.answer;

  return (
    <article id={id} tabIndex={id ? -1 : undefined}
      aria-label={workspace ? `Update for today's team report from ${view.subject.name}` : subjectView ? `Follow-up from ${view.requester?.name ?? asker}` : `Follow-up with ${view.subject.name}`}
      className={cn("card-panel flex min-w-0 flex-col gap-4 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border-accent-ring", className)}>
      {/* The ask: who asked whom, when, about what. */}
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={askerProfile} own={view.viewer === "requester"} className="mt-px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-sm font-medium text-foreground">
              {askLine}<span className="font-normal text-secondary">, <span className="tabular-nums">{at(view.createdAt)}</span></span>
            </p>
            {embedded ? null : <FollowUpBadge view={view} />}
          </div>
          <Bubble>“{view.question}”</Bubble>
          {view.task ? (
            <Link href={view.task.href} className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-sm text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:size-3.5 [&_svg]:shrink-0">
              <span className="min-w-0 truncate">About {view.task.title}</span><AnimatedArrowUpRight aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {/* The answer, or where it stands. */}
      <div className="flex items-start gap-2.5">
        <AssistantFace profile={view.subject.assistant} own={subjectView} className="mt-px" />
        <div className="min-w-0 flex-1">
          {terminal ? (
            <>
              <p className="text-sm font-medium text-foreground">
                {answerer}<span className="font-normal text-secondary">, {view.answeredAt ? <span className="tabular-nums">{at(view.answeredAt)}</span> : null}{view.answeredAt ? ", " : ""}{how}</span>
              </p>
              {view.answer ? <Bubble>{view.answer}</Bubble> : null}
              {byAi ? <p className="mt-1 text-xs font-normal text-subtle">Written by AI from {subjectView ? "your" : possessive(S)} work{view.reply && view.reply.choice !== "not_now" ? " and reply" : ""}.</p> : null}
              {view.reply && !replySaid ? (
                <p className="mt-1.5 break-words text-meta font-normal text-secondary">
                  {replyLabel}: <span className="text-foreground">{REPLY_LABELS[view.reply.choice]}</span>{view.reply.note ? <>, “<span className="whitespace-pre-wrap text-foreground">{view.reply.note}</span>”</> : null}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {/* One sentence on where it stands: "Ben's Brenda asked Ben. If Ben doesn't reply by 19:41, Max gets what Ben's work shows." */}
              <p className={cn("pt-px text-sm font-normal text-secondary", waiting.shimmer && "brenda-shimmer")}>
                {ifNoReply ?? (view.status === "answering" ? `${answerer} is writing the answer…` : waiting.text)}
              </p>
              {view.reply && view.status === "answering" ? (
                <p className="mt-1.5 break-words text-meta font-normal text-secondary">
                  {replyLabel}: <span className="text-foreground">{REPLY_LABELS[view.reply.choice]}</span>{view.reply.note ? <>, “<span className="whitespace-pre-wrap text-foreground">{view.reply.note}</span>”</> : null}
                </p>
              ) : null}
            </>
          )}
          {facts.length ? (
            // The subject sees exactly what was shared about them, open from the start (full transparency); the asker
            // opens it when they want the detail.
            <details className="group mt-2" open={subjectView || undefined}>
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-meta font-medium text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 -rotate-90 transition-transform duration-150 group-open:rotate-0 motion-reduce:transition-none" aria-hidden />{sharedLabel}
              </summary>
              <ul className="mt-1.5 space-y-1 pl-[18px] text-meta font-normal text-secondary">
                {facts.map((line, i) => <li key={i} className="list-disc break-words marker:text-subtle">{line}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** One line per follow-up (face, person, badge, the answer or where it stands, two lines at most), opening into the full card. */
function CompactExchange({ view, timeZone, now, yourName }: { view: FollowUpView; timeZone: string; now: number; yourName: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const line = progressWords(view, timeZone, now, yourName);
  return (
    <div className="min-w-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-75 hover:bg-fill-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        <AssistantFace profile={view.subject.assistant} own={view.viewer === "subject"} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{view.subject.name}</span>
            <FollowUpBadge view={view} />
          </span>
          <span className={cn("mt-0.5 line-clamp-2 break-words text-meta font-normal text-secondary", line.shimmer && "brenda-shimmer")}>{line.text}</span>
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div id={id} className="mt-1"><FollowUpExchange view={view} timeZone={timeZone} now={now} embedded /></div> : null}
    </div>
  );
}
