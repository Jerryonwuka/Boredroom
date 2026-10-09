import { Info } from "lucide-react";
import { LOOP_WORDS, type ConversationTracking } from "@/lib/commitments";
import { cn } from "@/lib/utils";

/**
 * The one-line disclosure in a tracked group conversation (owner decision, 8 October 2026: phase 7b, workspace
 * commitments): "Brenda notes commitments made here; people accept them onto their own list." It sits above the
 * composer, in the composer's own column, for everyone who reads the conversation, whenever the workspace assistant is
 * noting commitments here: migration 0048 in, the conversation a channel, a team's or Everyone (`applies`; never a
 * direct thread), the workspace's switch and the conversation's own both on and the conversation not archived
 * (`tracked`, decided by the server). `role="note"`, 13px secondary with an `Info` icon; no orange (it asks nothing of
 * anyone). The name is the workspace assistant's (product words: everyone in the conversation knows it by that name).
 *
 * No hooks: the Messages page draws it on the server and hands it to the composer.
 */
export function isTrackedHere(state: ConversationTracking | null | undefined): boolean {
  return !!state && state.ready && state.applies && state.tracked;
}

export function TrackedDisclosure({ state, className }: { state: ConversationTracking; className?: string }) {
  if (!isTrackedHere(state)) return null;
  return (
    <p role="note" className={cn("flex items-start gap-1.5 text-meta font-normal text-secondary", className)}>
      <Info className="mt-[3px] size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{LOOP_WORDS.disclosure(state.workspaceAssistantName)}</span>
    </p>
  );
}
