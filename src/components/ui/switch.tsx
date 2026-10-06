import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A toggle, v4: a checkbox drawn as a 36×20 pill (globals.css `input.switch`): on = the foreground, off = 16% grey, the
 * 16px thumb in the canvas colour slides in 150ms. Submits like any checkbox ("on" under its name).
 * With `children` it is a settings row: the label (14/20 medium) and `hint` (13px, secondary) on the left, the switch
 * on the right, the whole row clickable. Without children it is the bare switch (give it an `aria-label`), for tables.
 */
export function Switch({ className, children, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { hint?: React.ReactNode }) {
  if (!children) return <input type="checkbox" role="switch" className={cn("switch", className)} {...props} />;
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-4 py-2", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{children}</span>
        {hint ? <span className="block text-meta font-normal text-secondary">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" className="switch" {...props} />
    </label>
  );
}

/**
 * A checkbox with its label (14/20 medium) and an optional `hint` under it. The box is drawn by globals.css (16px, r4;
 * checked = the foreground with the mark in the canvas colour), so a bare <input type="checkbox"> matches too.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { hint?: React.ReactNode }>(function Checkbox({ className, children, hint, ...props }, ref) {
  if (!children) return <input ref={ref} type="checkbox" className={className} {...props} />;
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input ref={ref} type="checkbox" className="mt-0.5" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{children}</span>
        {hint ? <span className="block text-meta font-normal text-secondary">{hint}</span> : null}
      </span>
    </label>
  );
});

/** A radio with its label, drawn like the checkbox (a dot in the foreground when chosen). */
export const Radio = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { hint?: React.ReactNode }>(function Radio({ className, children, hint, ...props }, ref) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input ref={ref} type="radio" className="mt-0.5" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{children}</span>
        {hint ? <span className="block text-meta font-normal text-secondary">{hint}</span> : null}
      </span>
    </label>
  );
});
