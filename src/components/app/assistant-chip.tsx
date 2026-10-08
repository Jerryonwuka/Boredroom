"use client";

/**
 * Her mark on messages (owner decision, 8 October 2026: personal assistants, phase 3). A message carries who wrote it
 * (`messages.author_kind`, migration 0037), and Messages, the conversation list and the toasts say so:
 * - `via_assistant`: the person's own assistant sent it for them after they confirmed it. The person stays the author
 *   (their picture and name); `AssistantChip` sits beside the name (or beside the time under your own message): the
 *   assistant's small face and "via Max", with the tooltip "Sent by Max for Olu after Olu confirmed it".
 * - `assistant`: the assistant's own words in a thread (written only by Boredroom's worker; phases 4 and 5). The
 *   assistant is the author: `AssistantAvatar` (its face on a grey disc) in place of the picture, its name, and a small
 *   "Olu's assistant" tag.
 * The name and look are the sender's own assistant's (`assistant_profiles`, readable by everyone in the workspace), never
 * the viewer's. Faces here are `quiet`: they never talk along while the viewer's own assistant reads a reply aloud.
 *
 * The chip is a focusable note so the keyboard reaches its tooltip (`[data-tip][tabindex]` in components/ui/tooltips);
 * the tooltip and the screen reader say the same sentence.
 */
import { BrendaFace } from "@/components/app/brenda-face";
import { lookOf, type AssistantProfile } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/**
 * "Olu" from "Olu Adeyemi": the chip's sentence and the toast's "Olu's assistant" use the first name, as the conversation
 * list does. For client modules only: server components cannot call a function from a "use client" module, so the
 * Messages page keeps its own copy.
 */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The sentence behind "via Max": who sent it, for whom, and that they confirmed it first. */
export function viaAssistantSentence(assistantName: string, personName: string, isYou: boolean): string {
  if (isYou) return `Sent by ${assistantName} for you after you confirmed it`;
  const who = firstName(personName);
  return `Sent by ${assistantName} for ${who} after ${who} confirmed it`;
}

/** "via Max", with the assistant's face: on a message the person's own assistant sent for them after they confirmed it. */
export function AssistantChip({ assistant, personName, isYou, className }: { assistant: AssistantProfile; personName: string; isYou: boolean; className?: string }) {
  const sentence = viaAssistantSentence(assistant.name, personName, isYou);
  return (
    <span tabIndex={0} role="note" aria-label={sentence} data-tip={sentence}
      className={cn("inline-flex h-5 min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-fill-0 pl-0.5 pr-2 align-middle text-xs font-medium text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", className)}>
      <BrendaFace size="sm" look={lookOf(assistant)} quiet className="shrink-0" />
      <span className="truncate">via {assistant.name}</span>
    </span>
  );
}

/** An assistant in the place of a person's picture: its small face on a grey disc, 32px (or 24px). */
export function AssistantAvatar({ assistant, size = 32, className }: { assistant: AssistantProfile; size?: 24 | 32; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full bg-fill-1", size === 24 ? "size-6" : "size-8", className)}>
      <BrendaFace size={size === 24 ? "sm" : "md"} look={lookOf(assistant)} quiet />
    </span>
  );
}
