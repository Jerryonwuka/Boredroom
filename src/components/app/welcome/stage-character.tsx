"use client";

/**
 * Brenda on the welcome's stage (owner request, 11 October 2026: the first-run welcome; contract 4.5). The only importer of
 * `BrendaCharacter` on the welcome, loaded with `next/dynamic(…, { ssr: false })` by the stage, so the canvas engine is a
 * chunk of its own requested after the page has hydrated; the stage reserves her box at its final size, and she fades in
 * on her first frame (the character does that). She wears the look she is given (the draft on "Meet your assistant",
 * the saved one elsewhere), her resting light in her own colour (`glow="own"`), and she talks along when a voice sample
 * plays (never `quiet`). Her handle goes to `handle`, so the flow can make her react; `onReady` says her first frame is
 * drawn. Not interactive: the stage holds no controls.
 */
import type { RefObject } from "react";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import type { AssistantLook } from "@/lib/assistant-look";

export type StageCharacterProps = {
  look: AssistantLook;
  size: number;
  /** Her name for screen readers ("Max, your assistant"). */
  label: string;
  handle: RefObject<BrendaCharacterHandle | null>;
  onReady?: () => void;
};

export default function StageCharacter({ look, size, label, handle, onReady }: StageCharacterProps) {
  return <BrendaCharacter ref={handle} size={size} look={look} label={label} state="idle" glow="own" onReady={onReady} />;
}
