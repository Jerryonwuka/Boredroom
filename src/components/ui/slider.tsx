"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A slider, v4 with the accent rules (6 October 2026): a native range input drawn by globals.css `.range`: a 4px fill-150
 * track filled in orange up to the value, a 16px white thumb with a hairline, the keyboard ring on the thumb. Every
 * native behaviour stays (arrow keys, Page Up/Down, Home/End, form submission under `name`). Controlled (`value`) or
 * uncontrolled (`defaultValue`): the component keeps the fill's length (`--range-pct`) in step either way.
 */
type SliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const pct = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isFinite(n) || max <= min) return 0;
  return Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
};

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider({ className, style, min = 0, max = 100, value, defaultValue, onInput, ...props }, ref) {
  const lo = Number(min);
  const hi = Number(max);
  const start = pct(value ?? defaultValue ?? lo, lo, hi);
  return (
    <input ref={ref} type="range" min={min} max={max} value={value} defaultValue={defaultValue}
      className={cn("range", className)} style={{ ...style, ["--range-pct" as string]: `${start}%` }}
      // Uncontrolled sliders move without a re-render: the fill follows the thumb here.
      onInput={(e) => { e.currentTarget.style.setProperty("--range-pct", `${pct(e.currentTarget.value, lo, hi)}%`); onInput?.(e); }}
      {...props} />
  );
});
