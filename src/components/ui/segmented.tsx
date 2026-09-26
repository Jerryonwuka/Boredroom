import * as React from "react";
import { cn } from "@/lib/utils";

/** A row of pills that behaves like a radio group and submits under `name` like one (globals.css `.segmented`). */
export function Segmented({ name, options, defaultValue, value, onChange, className, "aria-label": ariaLabel }: {
  name?: string; options: { value: string; label: React.ReactNode; tone?: "success" | "warning" | "danger" | "neutral" }[]; defaultValue?: string; value?: string; onChange?: (v: string) => void; className?: string; "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("segmented", className)}>
      {options.map((o) => (
        <label key={o.value} className="segmented-item" data-tone={o.tone}>
          <input type="radio" name={name} value={o.value} defaultChecked={value === undefined ? defaultValue === o.value : undefined} checked={value === undefined ? undefined : value === o.value} onChange={() => onChange?.(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
