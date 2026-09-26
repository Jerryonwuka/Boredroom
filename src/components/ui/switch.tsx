import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A toggle: a checkbox drawn as a pill with a sliding knob (globals.css `.switch`). Submits like any checkbox
 * ("on" under its name), so forms read it the same way. Put the label text in `children`; `hint` sits under it.
 */
export function Switch({ className, children, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { hint?: React.ReactNode }) {
  return (
    <label className={cn("group flex cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-sm)] px-3 py-2.5 transition-colors duration-[var(--duration-fast)] hover:bg-wash", className)}>
      <span className="min-w-0"><span className="block text-sm font-medium text-fg">{children}</span>{hint ? <span className="block text-xs text-fg-subtle">{hint}</span> : null}</span>
      <input type="checkbox" className="switch" {...props} />
    </label>
  );
}
