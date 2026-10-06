import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented control, v4 (globals.css `.segmented`): fill-1 r10 p2 holding 28px items (r7, 14/20 medium, secondary);
 * the chosen one sits on the canvas colour with a hairline. Behaves like a radio group and submits under `name` like
 * one; with a `name`, arrow keys move the choice (native radio behaviour). Controlled (`value`/`onChange`) or not (`defaultValue`).
 * A tone colours the chosen item's label (a status choice).
 */
export function Segmented({ name, options, defaultValue, value, onChange, className, disabled, "aria-label": ariaLabel }: {
  name?: string; options: { value: string; label: React.ReactNode; tone?: "success" | "warning" | "danger" | "neutral"; disabled?: boolean }[];
  defaultValue?: string; value?: string; onChange?: (v: string) => void; className?: string; disabled?: boolean; "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("segmented", className)}>
      {options.map((o) => (
        <label key={o.value} className="segmented-item" data-tone={o.tone}>
          <input type="radio" name={name} value={o.value} disabled={disabled || o.disabled} defaultChecked={value === undefined ? defaultValue === o.value : undefined} checked={value === undefined ? undefined : value === o.value} onChange={() => onChange?.(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
