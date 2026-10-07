"use client";

/**
 * The assistant editor (owner decision, 7 October 2026: personal assistants): the controls and the live preview shared by
 * "Meet your assistant" (assistant-setup) and Settings' "Your assistant" and "Workspace assistant" (assistant-settings).
 *
 * - The preview is the animated character with the name under it and the three small faces beside it, so a choice shows
 *   at every size it is drawn. It sits on the canvas colour: no gradient and no glow (the home panel's exception does not
 *   reach here). A new colour, visor or eyes pleases her for a moment; under reduced motion she is redrawn still.
 * - Name: a text field checked on blur and on save with the server's own rule and words (lib/assistant-look), so the
 *   message the person sees before sending is the one the server would send back.
 * - Colour, visor and eyes are native radio groups (Tab into the group, arrow keys move the choice) with visually hidden
 *   radios: ten swatches named by their colour ("Orange", also as the swatch's title and as a word beside the legend, so
 *   colour never carries the meaning alone), and three cards each drawing that option on a small face in the current
 *   colour. The chosen swatch has the orange ring with a gap (accent rule: a chosen radio is an orange ring); the chosen
 *   card is fill-1 with a 1px orange edge. Keyboard focus draws the focus ring outside either.
 * - `layout="stack"` (the dialog) puts each label over its control; `layout="rows"` (Settings) renders settings rows,
 *   the label on the left and the control on the right, as direct children of a settings card. The rows go side by side
 *   by the card's own width (the card is an `@container`, 42rem and up), not the window's: beside the sidebar and the
 *   settings menu a 960px window leaves the visor and eye cards too narrow for their words (review, 7 October 2026).
 * - Her voice (owner decision, 7 October 2026: phase 2): the preview is her, so it talks while she speaks (the Voice
 *   sample in Settings, or a reply read aloud); the small faces on the visor and eye cards are options, not her, and stay
 *   still (`quiet`). `quiet` on the preview keeps someone else's assistant still (the workspace's, in Settings).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace } from "@/components/app/brenda-face";
import { AssistantScope } from "@/components/app/assistant-context";
import { SettingsRow } from "@/components/app/settings-forms";
import { Field, Input } from "@/components/ui/input";
import { isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  ASSISTANT_COLOURS, ASSISTANT_EYES, ASSISTANT_VISORS, DEFAULT_ASSISTANT_NAME, EYES, PALETTE, VISORS,
  assistantNameProblem, lookOf, normaliseAssistantName, type AssistantLook, type AssistantProfile,
} from "@/lib/assistant-look";

type FieldKey = "name" | "colour" | "visor" | "eyes";
export type AssistantFieldErrors = Partial<Record<FieldKey, string>>;
const FIELDS: FieldKey[] = ["name", "colour", "visor", "eyes"];

export const NAME_HINT = "Up to 24 characters: letters, numbers, spaces, apostrophes, hyphens and full stops.";
const REDUCE = "(prefers-reduced-motion: reduce)";

// ---- Helpers shared by the dialog and Settings -----------------------------------------------------------------------

/** What a save sends: the name as the server will store it (it normalises and checks it again). */
export const assistantBody = (p: AssistantProfile) => ({ name: normaliseAssistantName(p.name), colour: p.colour, visor: p.visor, eyes: p.eyes });

/** A profile as one comparable string (the name normalised), to tell whether a draft differs from what is saved. */
export const profileKey = (p: AssistantProfile) => `${normaliseAssistantName(p.name)}|${p.colour}|${p.visor}|${p.eyes}`;

/** The server's field errors (422) for the four fields, first message each; null when the failure was not about them. */
export function assistantFieldErrors(err: unknown): AssistantFieldErrors | null {
  if (!isApiFailure(err) || !err.error.fieldErrors) return null;
  const out: AssistantFieldErrors = {};
  for (const k of FIELDS) { const m = err.error.fieldErrors[k]?.[0]; if (m) out[k] = m; }
  return Object.keys(out).length ? out : null;
}

/** Errors that still apply after a change: a field the person just changed loses its error. */
export function keepErrors(errors: AssistantFieldErrors, prev: AssistantProfile, next: AssistantProfile): AssistantFieldErrors {
  const out: AssistantFieldErrors = {};
  for (const k of FIELDS) if (errors[k] && prev[k] === next[k]) out[k] = errors[k];
  return out;
}

// ---- The preview ---------------------------------------------------------------------------------------------------

/**
 * The live preview: the character (not interactive, idle) with the name under it and the faces at 18, 26 and 34px beside
 * it, all drawn as `profile` (an AssistantScope, so anything inside names and draws this assistant). While the name field
 * is empty it shows Brenda's name; while it holds a name that would be refused, the last name that would not (Brenda
 * until there is one), so the preview never shows a name that cannot be saved (review, 7 October 2026). `quiet`: it never
 * talks while the person's own assistant speaks (a preview of another assistant).
 */
export function AssistantPreview({ profile, size = 72, className, quiet = false }: { profile: AssistantProfile; size?: number; className?: string; quiet?: boolean }) {
  const character = useRef<BrendaCharacterHandle>(null);
  const typed = normaliseAssistantName(profile.name);
  const valid = typed && !assistantNameProblem(typed) ? typed : null;
  const [lastValid, setLastValid] = useState(valid ?? DEFAULT_ASSISTANT_NAME);
  if (valid && valid !== lastValid) setLastValid(valid);
  const name = !typed ? DEFAULT_ASSISTANT_NAME : valid ?? lastValid;
  const look = lookOf(profile);
  const shown: AssistantProfile = { ...look, name };
  // A new choice pleases her for a moment (compared with the last look, so React's development double mount does not).
  const key = `${look.colour}|${look.visor}|${look.eyes}`;
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (!window.matchMedia(REDUCE).matches) character.current?.emote("pleased");
  }, [key]);
  return (
    <AssistantScope profile={shown}>
      <div className={cn("flex min-w-0 items-center gap-3", className)}>
        <div className="flex min-w-0 max-w-56 flex-col items-center">
          <BrendaCharacter ref={character} size={size} look={look} label={`${name}, preview`} state="idle" quiet={quiet} />
          <p className="type-dialog-title -mt-1 max-w-full truncate text-center text-foreground">{name}</p>
        </div>
        <div aria-hidden className="flex shrink-0 items-end gap-3 pb-7">
          <BrendaFace size="sm" look={look} quiet={quiet} />
          <BrendaFace size="md" look={look} quiet={quiet} />
          <BrendaFace size="lg" look={look} quiet={quiet} />
        </div>
      </div>
    </AssistantScope>
  );
}

// ---- The editor ----------------------------------------------------------------------------------------------------

/** One radio group: a fieldset named by its legend, with the chosen option's word beside it where the options are colours. */
function Group({ layout, legend, chosen, error, errorId, children }: { layout: "stack" | "rows"; legend: string; chosen?: string; error?: string; errorId: string; children: ReactNode }) {
  const word = chosen ? <span className="font-normal text-secondary">: {chosen}</span> : null;
  const message = error ? <p id={errorId} role="alert" className="mt-1.5 text-meta font-medium text-danger">{error}</p> : null;
  if (layout === "rows") {
    // The settings row's grid (SettingsRow), as a fieldset: the legend names the group for screen readers, the same words
    // stand in the label column for the eye.
    return (
      <fieldset aria-describedby={error ? errorId : undefined} className="grid min-w-0 gap-x-8 gap-y-2 px-5 py-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start">
        <legend className="sr-only">{legend}</legend>
        <p aria-hidden className="min-w-0 text-sm font-medium text-foreground @2xl:pt-1.5">{legend}{word}</p>
        <div className="min-w-0">{children}{message}</div>
      </fieldset>
    );
  }
  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="min-w-0">
      <legend className="mb-2 p-0 text-sm font-medium text-foreground">{legend}{chosen ? <span aria-hidden>{word}</span> : null}</legend>
      {children}
      {message}
    </fieldset>
  );
}

/** The ring a focused option draws outside its chosen ring (both are orange; the gap keeps them apart). */
const FOCUS_OUTSIDE = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-[var(--ring)]";
/** A radio laid over its whole option, invisible: the option is what you see and press, the radio what you tab to. */
const HIDDEN_RADIO = "absolute inset-0 m-0 size-full cursor-pointer border-0 opacity-0 disabled:cursor-not-allowed";

export function AssistantEditor({ value, onChange, idPrefix, disabled = false, error, layout = "stack" }: {
  value: AssistantProfile; onChange: (next: AssistantProfile) => void; idPrefix: string; disabled?: boolean;
  error?: AssistantFieldErrors;
  /** "stack" (the dialog): labels over controls. "rows" (Settings): settings rows, for a settings card. */
  layout?: "stack" | "rows";
}) {
  // The name is checked once the person leaves the field, then as they type; a save checks it too (the caller).
  const [touched, setTouched] = useState(false);
  if (error?.name && !touched) setTouched(true);
  const nameError = error?.name ?? (touched ? assistantNameProblem(value.name) ?? undefined : undefined);
  const set = (patch: Partial<AssistantProfile>) => onChange({ ...value, ...patch });
  const nameId = `${idPrefix}-name`;

  const nameInput = (
    <Input id={nameId} name="name" value={value.name} onChange={(e) => set({ name: e.target.value })} onBlur={() => setTouched(true)}
      maxLength={40} autoComplete="off" spellCheck={false} disabled={disabled} className={layout === "rows" ? "sm:max-w-72" : undefined} />
  );

  const colours = (
    <Group layout={layout} legend="Colour" chosen={PALETTE[value.colour].label} error={error?.colour} errorId={`${idPrefix}-colour-error`}>
      <div className="grid w-fit grid-cols-5 gap-2.5 p-1">
        {ASSISTANT_COLOURS.map((k) => {
          const p = PALETTE[k];
          const chosen = value.colour === k;
          return (
            <label key={k} title={p.label} className={cn("relative grid size-8 place-items-center rounded-full pointer-coarse:size-10", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
              <input type="radio" name={`${idPrefix}-colour`} value={k} checked={chosen} disabled={disabled} onChange={() => set({ colour: k })} className={cn(HIDDEN_RADIO, "peer rounded-full")} />
              <span aria-hidden
                className={cn("pointer-events-none size-8 rounded-full border transition-[border-color,box-shadow] duration-75",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[6px] peer-focus-visible:outline-[var(--ring)]",
                  chosen ? "border-border-input shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--accent)]" : "border-border-input peer-hover:border-border-input-hover")}
                style={{ background: `radial-gradient(circle at 32% 28%, ${p.face.hi} 0, ${p.face.mid} 62%)` }} />
              <span className="sr-only">{p.label}</span>
            </label>
          );
        })}
      </div>
    </Group>
  );

  const cards = <K extends string>(field: "visor" | "eyes", keys: readonly K[], labels: Record<K, { label: string }>, chosen: K, pick: (k: K) => void, faceLook: (k: K) => AssistantLook) => (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => {
        const on = chosen === k;
        return (
          <label key={k} className={cn("relative flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border px-1.5 py-3 text-center text-meta font-medium transition-colors duration-75", FOCUS_OUTSIDE,
            on ? "border-accent bg-fill-1 text-foreground" : "border-border bg-background text-secondary hover:bg-fill-0 hover:text-foreground",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
            <input type="radio" name={`${idPrefix}-${field}`} value={k} checked={on} disabled={disabled} onChange={() => pick(k)} className={cn(HIDDEN_RADIO, "rounded-xl")} />
            <BrendaFace size="md" look={faceLook(k)} quiet className="pointer-events-none" />
            <span className="pointer-events-none max-w-full">{labels[k].label}</span>
          </label>
        );
      })}
    </div>
  );

  const visors = (
    <Group layout={layout} legend="Visor" error={error?.visor} errorId={`${idPrefix}-visor-error`}>
      {cards("visor", ASSISTANT_VISORS, VISORS, value.visor, (visor) => set({ visor }), (visor) => ({ ...lookOf(value), visor }))}
    </Group>
  );
  const eyes = (
    <Group layout={layout} legend="Eyes" error={error?.eyes} errorId={`${idPrefix}-eyes-error`}>
      {cards("eyes", ASSISTANT_EYES, EYES, value.eyes, (e) => set({ eyes: e }), (e) => ({ ...lookOf(value), eyes: e }))}
    </Group>
  );

  if (layout === "rows") {
    return (
      <>
        <SettingsRow label="Name" hint={NAME_HINT} htmlFor={nameId} error={nameError} sideBySideAt="container">{nameInput}</SettingsRow>
        {colours}
        {visors}
        {eyes}
      </>
    );
  }
  return (
    <div className="grid gap-5">
      <Field label="Name" htmlFor={nameId} description={NAME_HINT} error={nameError}>{nameInput}</Field>
      {colours}
      {visors}
      {eyes}
    </div>
  );
}
