"use client";

/**
 * The assistant's live preview (owner decision, 7 October 2026: personal assistants), moved out of assistant-editor
 * unchanged (owner request, 11 October 2026: the first-run welcome; contract 4.5), so the editor's controls no longer
 * pull in the canvas character: the welcome loads the character on its own, after the page. "Meet your assistant"
 * (assistant-setup) and Settings (assistant-settings) still show this preview.
 *
 * `useShownName` (welcome/shown-name, re-exported here) is the preview's name rule, shared with the welcome's stage: an
 * empty field shows Brenda's name; a name the server would refuse shows the last one it would take (Brenda until there
 * is one), so a preview never shows a name that cannot be saved (review, 7 October 2026).
 */
import { useEffect, useRef } from "react";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace } from "@/components/app/brenda-face";
import { AssistantScope } from "@/components/app/assistant-context";
import { cn } from "@/lib/utils";
import { lookOf, type AssistantProfile } from "@/lib/assistant-look";
import { useShownName } from "@/components/app/welcome/shown-name";

export { useShownName };

const REDUCE = "(prefers-reduced-motion: reduce)";

/**
 * The live preview: the character (not interactive, idle) with the name under it and the faces at 18, 26 and 34px beside
 * it, all drawn as `profile` (an AssistantScope, so anything inside names and draws this assistant). The name follows
 * `useShownName`. `quiet`: it never talks while the person's own assistant speaks (a preview of another assistant).
 */
export function AssistantPreview({ profile, size = 72, className, quiet = false }: { profile: AssistantProfile; size?: number; className?: string; quiet?: boolean }) {
  const character = useRef<BrendaCharacterHandle>(null);
  const name = useShownName(profile.name);
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
