"use client";

import { Slider } from "@/components/ui/slider";

const COMMIT_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

/**
 * "How far along" (owner decision, 28 September 2026): 0 to 100 in steps of 5, set by the person holding the task.
 * The value follows the thumb (`onChange`) and is saved when the pointer lets go or a key is released (`onCommit`), so a
 * drag sends one request, not twenty. v4 with the accent rules (6 October 2026): the `Slider`, a 4px track filled in
 * orange up to the value under a white thumb.
 * Used by My Day, the running timer and the task pop-up.
 */
export function ProgressSlider({ value, onChange, onCommit, disabled, label = "Percentage done", id, className }: {
  value: number; onChange: (v: number) => void; onCommit: (v: number) => void; disabled?: boolean; label?: string; id?: string; className?: string;
}) {
  const commit = (el: EventTarget) => onCommit(Number((el as HTMLInputElement).value));
  return (
    <Slider id={id} min={0} max={100} step={5} value={value} disabled={disabled} aria-label={label} aria-valuetext={`${value}% done`}
      className={className}
      onChange={(e) => onChange(Number(e.target.value))}
      onMouseUp={(e) => commit(e.target)} onTouchEnd={(e) => commit(e.target)}
      onKeyUp={(e) => { if (COMMIT_KEYS.includes(e.key)) commit(e.target); }} />
  );
}
