import { CircleCheck, Lock, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LOOP_WORDS, type MessageLabel, type MessageLabelState } from "@/lib/commitments";
import { cn } from "@/lib/utils";

/**
 * The small "Noted" label on a message (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed").
 * When the workspace assistant notices a commitment in a tracked group conversation ("I'll send the deck Thursday", or
 * the "On it" that agreed to an ask), everyone in the conversation sees it on that message (`MessageRow.
 * commitment_label`, written only by Boredroom's worker, read under the conversation's own row-level security). Its
 * state follows the commitment: noted (waiting for the person, or on their list) "Noted", done "Done", declined
 * "Declined", "Not a commitment". An unanswered proposal that expired, or one whose message was withdrawn, has no label.
 *
 * A 16px `Badge` under the bubble (`MessageBubble`'s `label` slot: beside the time under your own message, on its own
 * small row under anyone else's): neutral, with a 12px `NotebookPen` (`CircleCheck` and the success tone when done).
 * No orange (accent rules, 6 October 2026: a label is information, not something to act on); the word always says the
 * state. It is a focusable note, as the "via Max" chip is, so the one tooltip system shows its sentence on hover and
 * keyboard focus and the screen reader says the same: "Brenda noted a commitment here", "Commitment: done" (`W` is the
 * workspace assistant's name, as everyone in the conversation knows it).
 *
 * Private decline labels (owner decision, 9 October 2026: phase 7c, contract E): "Declined" and "Not a commitment" are
 * read only by that commitment's committer and asker; every other reader of the conversation gets no label for the
 * message at all (the label query and, after migration 0050, the table's policy leave it out, so nothing here hides
 * anything). The two who do see one see that it is theirs alone: a 12px `Lock` before the word, and the hint after the
 * sentence in the tooltip and the accessible name ("Commitment: declined. Only you and Ada see this."). No colour
 * change. "Noted" and "Done" stay as they were, for every reader. The label says it is private (`private`, from
 * `messageLabel`) and names the other of the two by first name (`other`; none for a promise: "Only you see this.",
 * `LOOP_WORDS.label.privateHint`).
 *
 * No hooks: drawn by the Messages page on the server, usable from a client part too.
 */
const TONE: Record<MessageLabelState, "neutral" | "success"> = { noted: "neutral", done: "success", declined: "neutral", dismissed: "neutral" };

/** "Only you and Ada see this." for a private label ("Only you see this." when there is nobody else: a promise). */
export function privateHint(label: MessageLabel): string {
  return LOOP_WORDS.label.privateHint(label.other);
}

/**
 * Whether only the commitment's two people read this label (declined or "not a commitment"). A label from a server
 * older than phase 7c has no `private`; only the two parties ever receive those two states anyway.
 */
export function isPrivateLabel(label: MessageLabel): boolean {
  return typeof label.private === "boolean" ? label.private : label.state === "declined" || label.state === "dismissed";
}

export function CommitmentLabel({ label, assistantName, className }: { label: MessageLabel; assistantName: string; className?: string }) {
  const state = label.state;
  const secret = isPrivateLabel(label);
  // "Commitment: declined. Only you and Ada see this." (the hint after the state's own sentence).
  const sentence = secret ? `${LOOP_WORDS.label.aria(assistantName, state)}. ${privateHint(label)}` : LOOP_WORDS.label.aria(assistantName, state);
  const text = label.text || LOOP_WORDS.label[state] || LOOP_WORDS.label.noted;
  const Icon = state === "done" ? CircleCheck : NotebookPen;
  return (
    <span tabIndex={0} role="note" aria-label={sentence} data-tip={sentence}
      className={cn("inline-flex shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", className)}>
      <Badge size="sm" tone={TONE[state] ?? "neutral"} className="gap-1">
        {secret ? <Lock className="size-3 shrink-0" aria-hidden /> : <Icon className="size-3 shrink-0" aria-hidden />}{text}
      </Badge>
    </span>
  );
}
