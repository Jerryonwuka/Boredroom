"use client";

/**
 * The welcome's stage (owner request, 11 October 2026: the first-run welcome; contract 4.2 and 4.5): the quiet panel
 * where the person's own assistant stands while they set up, changing with every choice. From 860px it is the left
 * column, a full-height panel (r22, hairline, the sidebar's grey; no glow, no tint: the home panel's exception does not
 * reach here) with her at 160px, her name in the display face under her, then her speech bubble. Below 860px it is a
 * band above the card: her at 88px on the left, her name and the bubble beside her.
 *
 * - She is loaded after the page (stage-character, `ssr: false`) into a box already at her final size, so nothing moves
 *   when she arrives and the step's words paint first. She stays the same canvas from step to step.
 * - "Meet your assistant": her name follows the typing (the preview's rule), with a still 2px caret while the name field
 *   has focus; a caption names the look ("Teal, band visor, round eyes"); from 860px the three small faces show how she
 *   looks in chat, lists and the notch, and the stage's foot says what colleagues see.
 * - "You're all set": from 860px she perches at 120px on the summary card (`done`); on phones the card follows the
 *   action in the card column instead (the flow puts it there), and the band stays.
 * - Her bubble is a plain paragraph read in order, never a live region; three typing dots stand in for a moment before a
 *   new line (the flow decides, and never under reduced motion).
 */
import dynamic from "next/dynamic";
import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { BrendaCharacterHandle } from "@/components/app/brenda-character";
import type { AssistantLook } from "@/lib/assistant-look";
import { LazyFace } from "@/components/app/welcome/lazy-face";
import { cn } from "@/lib/utils";

const StageCharacter = dynamic(() => import("@/components/app/welcome/stage-character"), { ssr: false });

const WIDE = "(min-width: 860px)";
const subscribeWide = (cb: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/** The two-column layout (860px and up); the server and hydration assume it, the character is drawn after either way. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
}

/** Her size on the stage, the band and the end card (contract 4.5). */
const SIZE = { panel: 160, band: 88, perch: 120 } as const;
/** The canvas is 1.5 × 1.25 her size (room for her light): the box is reserved at exactly that. */
const box = (size: number) => ({ width: size * 1.5, height: size * 1.25 });

export type WelcomeStageProps = {
  look: AssistantLook;
  /** Her name as shown (the draft's on "Meet your assistant", following the typing). */
  name: string;
  /** The name field has focus: a still caret after her name. */
  editingName?: boolean;
  /** Under her name: the look in words ("Teal, band visor, round eyes"). */
  caption?: string | null;
  /** From 860px, the three small faces with this line under them. */
  facesCaption?: string | null;
  /** At the stage's foot from 860px, beside an 18px face. */
  stageNote?: string | null;
  /** Her bubble's words, and whether she is "typing" them (three dots instead). */
  line: string;
  typing?: boolean;
  /** "You're all set" from 860px: the summary card she perches on. */
  done?: ReactNode;
  handle: RefObject<BrendaCharacterHandle | null>;
  onReady?: () => void;
};

/** Her bubble: a tail up on the panel, to the left in the band. Three dots while she "types". */
function Bubble({ line, typing, band }: { line: string; typing?: boolean; band: boolean }) {
  return (
    <div className={cn("relative max-w-[360px]", band ? "ml-1.5" : "mt-5")}>
      <span aria-hidden className={cn("absolute size-3 border-border bg-surface",
        band ? "-left-[6.5px] top-4 rotate-45 border-b border-l" : "-top-[6.5px] left-1/2 -ml-1.5 rotate-45 border-l border-t")} />
      <p className={cn("relative rounded-2xl border border-border bg-surface text-left font-normal text-foreground", band ? "px-3 py-2 text-sm" : "px-4 py-3 text-[15px] leading-[22px]")}>
        {typing ? (
          <span className={cn("inline-flex items-center gap-1", band ? "h-5" : "h-[22px]")} aria-hidden>
            <span className="size-1.5 animate-pulse rounded-full bg-secondary" />
            <span className="size-1.5 animate-pulse rounded-full bg-secondary [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-secondary [animation-delay:300ms]" />
          </span>
        ) : line}
        {/* The words are there for screen readers while the dots show. */}
        {typing ? <span className="sr-only">{line}</span> : null}
      </p>
    </div>
  );
}

export function WelcomeStage({ look, name, editingName = false, caption, facesCaption, stageNote, line, typing = false, done, handle, onReady }: WelcomeStageProps) {
  const wide = useWide();
  const perched = wide && !!done;
  const size = perched ? SIZE.perch : wide ? SIZE.panel : SIZE.band;
  const nameEl = (cls: string) => (
    <p className={cn("max-w-full truncate font-display font-normal text-foreground", cls)}>
      {name}
      {editingName ? <span aria-hidden className="ml-1 inline-block h-[0.82em] w-0.5 translate-y-[0.06em] bg-foreground align-baseline" /> : null}
    </p>
  );

  return (
    <aside aria-label={`${name}, your assistant`}
      className={cn("relative order-first min-w-0 rounded-[22px] border border-border bg-sidebar",
        "flex items-center gap-3 p-4",
        "min-[860px]:sticky min-[860px]:top-[72px] min-[860px]:h-[calc(100dvh-92px)] min-[860px]:min-h-[520px] min-[860px]:flex-col min-[860px]:justify-center min-[860px]:gap-0 min-[860px]:p-8")}>
      {/* Her box, at her final size from the first paint (the band's on phones, the panel's or the perch's from 860px). */}
      <div className={cn("relative z-[1] grid shrink-0 place-items-center",
        done ? "max-[859px]:h-[110px] max-[859px]:w-[132px] min-[860px]:h-[150px] min-[860px]:w-[180px]" : "max-[859px]:h-[110px] max-[859px]:w-[132px] min-[860px]:h-[200px] min-[860px]:w-[240px]",
        done && "min-[860px]:-mb-[52px]")}>
        <div style={box(size)} className="grid place-items-center">
          <StageCharacter look={look} size={size} label={`${name}, your assistant`} handle={handle} onReady={onReady} />
        </div>
      </div>

      {/* The words beside her (band) or under her (panel). On the end screen from 860px the summary card takes their place. */}
      <div className={cn("flex min-w-0 flex-1 flex-col items-start min-[860px]:flex-none min-[860px]:items-center min-[860px]:text-center", perched && "min-[860px]:hidden")}>
        {nameEl("text-2xl leading-[30px] min-[860px]:mt-1 min-[860px]:text-[40px] min-[860px]:leading-[48px]")}
        {caption ? <p className="mt-0.5 max-w-full truncate text-meta font-normal text-secondary min-[860px]:mt-1 min-[860px]:text-sm">{caption}</p> : null}
        {facesCaption ? (
          <div className="mt-4 hidden flex-col items-center gap-2 min-[860px]:flex">
            <div aria-hidden className="flex items-end gap-3">
              <LazyFace size="sm" look={look} quiet />
              <LazyFace size="md" look={look} quiet />
              <LazyFace size="lg" look={look} quiet />
            </div>
            <p className="text-meta font-normal text-secondary">{facesCaption}</p>
          </div>
        ) : null}
        <div className="hidden min-[860px]:block"><Bubble line={line} typing={typing} band={false} /></div>
        <div className="mt-2 min-[860px]:hidden"><Bubble line={line} typing={typing} band /></div>
      </div>

      {done ? (
        <div className="hidden w-full max-w-[360px] flex-col items-center min-[860px]:flex">
          {done}
          <Bubble line={line} typing={typing} band={false} />
        </div>
      ) : null}

      {stageNote ? (
        <p className="absolute inset-x-8 bottom-6 hidden items-center gap-2 text-meta font-normal text-secondary min-[860px]:flex">
          <LazyFace size="sm" look={look} quiet />
          <span className="min-w-0">{stageNote}</span>
        </p>
      ) : null}
    </aside>
  );
}
