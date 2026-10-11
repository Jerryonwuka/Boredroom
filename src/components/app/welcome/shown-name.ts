"use client";

/**
 * The assistant's name as a preview shows it (owner decision, 7 October 2026: personal assistants; review, 7 October
 * 2026), in a module of its own (owner request, 11 October 2026: the first-run welcome) so the welcome's stage can use it
 * without loading the canvas character that `AssistantPreview` draws (assistant-preview re-exports it).
 */
import { useState } from "react";
import { DEFAULT_ASSISTANT_NAME, assistantNameProblem, normaliseAssistantName } from "@/lib/assistant-look";

/**
 * The name to show for what is typed: the typed name when the server would take it, Brenda's while the field is empty,
 * else the last name that would be taken, so a preview never shows a name that cannot be saved. `fallback` stands in for
 * Brenda's (the welcome passes the saved name).
 */
export function useShownName(typedRaw: string, fallback: string = DEFAULT_ASSISTANT_NAME): string {
  const typed = normaliseAssistantName(typedRaw);
  const valid = typed && !assistantNameProblem(typed) ? typed : null;
  const [lastValid, setLastValid] = useState(valid ?? fallback);
  if (valid && valid !== lastValid) setLastValid(valid);
  return !typed ? fallback : valid ?? lastValid;
}
