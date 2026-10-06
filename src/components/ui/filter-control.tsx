"use client";

/**
 * Filter controls for toolbars, v4 (spec §7 "Filter control"): a small strip, min-height 32, r10, fill-0, padding
 * 4px 6px, 8px gap, holding a 12/16 medium label in the subtle grey and an outline trigger (h24 px8 r8 12/16 medium).
 *
 * - `FilterControl` is the strip: put any 24px trigger in it (a FilterSelect, a DatePicker size="xs", a Button
 *   size="xs" variant="secondary" that opens a Popover).
 * - `FilterSelect` is the usual trigger: a native select (keyboard and screen readers work as everywhere), labelled by
 *   the strip's text. `autoSubmit` submits the enclosing GET form the moment it changes (no Show buttons).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function FilterControl({ label, htmlFor, children, className }: { label: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("inline-flex min-h-8 max-w-full items-center gap-2 rounded-[10px] bg-fill-0 px-1.5 py-1", className)}>
      {htmlFor ? <label htmlFor={htmlFor} className="shrink-0 pl-0.5 text-xs font-medium text-subtle">{label}</label> : <span className="shrink-0 pl-0.5 text-xs font-medium text-subtle">{label}</span>}
      {children}
    </div>
  );
}

export const FilterSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { label: React.ReactNode; options?: { value: string; label: string }[]; autoSubmit?: boolean; wrapperClassName?: string }>(
  function FilterSelect({ label, options, autoSubmit = false, id, className, wrapperClassName, onChange, children, ...props }, ref) {
    const auto = React.useId();
    const selectId = id ?? auto;
    return (
      <FilterControl label={label} htmlFor={selectId} className={wrapperClassName}>
        <select ref={ref} id={selectId} className={cn("field field-xs w-auto max-w-[14rem]", className)}
          onChange={(e) => { onChange?.(e); if (autoSubmit) e.currentTarget.form?.requestSubmit(); }} {...props}>
          {options ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : children}
        </select>
      </FilterControl>
    );
  },
);

/** A row of filter controls with the gaps the spec uses (8px), wrapping on narrow screens. */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
