"use client";

/**
 * "Meet your assistant" (owner request, 11 October 2026: "select brands", their Brendas; contract 5.3). The same editor as
 * Settings (name, ten colours with their words under them, visor, eyes), with a "3 of 24" counter under the name, while
 * the stage shows the draft live: the character in the chosen look, the name as it is typed, the look in words and the
 * small faces. Opens on the saved profile (Brenda, white, bean visor, pill eyes on a first run), so Continue keeps it;
 * "Keep Brenda" puts the saved profile back and moves on. The editor stays enabled while it saves: disabling the focused
 * name field (Enter continues from it) would drop focus to the page (review, 11 October 2026).
 */
import type { ReactNode } from "react";
import { AssistantEditor, type AssistantFieldErrors } from "@/components/app/assistant-editor";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { WELCOME_WORDS } from "@/lib/welcome";
import type { AssistantProfile } from "@/lib/assistant-look";

const A = WELCOME_WORDS.assistant;
export const ASSISTANT_ID_PREFIX = "welcome";
export const ASSISTANT_NAME_ID = `${ASSISTANT_ID_PREFIX}-name`;

export function StepAssistant({ stepLabel, note, focusTitle, savedName, draft, onDraft, fieldErrors, error, busy, onBack, onKeep, onContinue, onNameFocus }: {
  stepLabel: string | null; note?: ReactNode; focusTitle: boolean;
  /** The saved name ("Keep Brenda"). */
  savedName: string;
  draft: AssistantProfile; onDraft: (next: AssistantProfile) => void;
  fieldErrors: AssistantFieldErrors; error: string | null; busy: boolean;
  onBack: () => void; onKeep: () => void; onContinue: () => void;
  /** The name field gained or lost focus (the stage's caret). */
  onNameFocus: (focused: boolean) => void;
}) {
  return (
    <StepFrame stepLabel={stepLabel} title={A.title} lede={A.lede(savedName)} note={note} focusTitle={focusTitle} error={error}
      onSubmit={onContinue} onBack={onBack} secondary={{ label: A.keep(savedName), onClick: onKeep, disabled: busy }}
      primary={{ label: WELCOME_WORDS.buttons.continue, loading: busy }}>
      <div
        onFocus={(e) => { if ((e.target as HTMLElement).id === ASSISTANT_NAME_ID) onNameFocus(true); }}
        onBlur={(e) => { if ((e.target as HTMLElement).id === ASSISTANT_NAME_ID) onNameFocus(false); }}>
        <AssistantEditor value={draft} onChange={onDraft} idPrefix={ASSISTANT_ID_PREFIX} error={fieldErrors} layout="stack"
          nameCounter={A.counter} swatchLabels />
      </div>
    </StepFrame>
  );
}
