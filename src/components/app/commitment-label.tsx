import { CircleCheck, NotebookPen } from "lucide-react";
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
 * No hooks: drawn by the Messages page on the server, usable from a client part too.
 */
const TONE: Record<MessageLabelState, "neutral" | "success"> = { noted: "neutral", done: "success", declined: "neutral", dismissed: "neutral" };

export function CommitmentLabel({ label, assistantName, className }: { label: MessageLabel; assistantName: string; className?: string }) {
  const state = label.state;
  const sentence = LOOP_WORDS.label.aria(assistantName, state);
  const text = label.text || LOOP_WORDS.label[state] || LOOP_WORDS.label.noted;
  const Icon = state === "done" ? CircleCheck : NotebookPen;
  return (
    <span tabIndex={0} role="note" aria-label={sentence} data-tip={sentence}
      className={cn("inline-flex shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", className)}>
      <Badge size="sm" tone={TONE[state] ?? "neutral"} className="gap-1"><Icon className="size-3 shrink-0" aria-hidden />{text}</Badge>
    </span>
  );
}
