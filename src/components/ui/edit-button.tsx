"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one way to say "edit" on the platform (owner decision, 25 September 2026): a small pill with a pencil that
 * turns orange as you reach it. Use it for every affordance that opens something for editing.
 */
export const EditButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: React.ReactNode; iconOnly?: boolean }>(
  function EditButton({ className, label = "Edit", iconOnly = false, ...props }, ref) {
    return (
      <button ref={ref} type="button" aria-label={iconOnly ? String(label) : undefined} className={cn("edit-btn", iconOnly && "edit-btn-icon", className)} {...props}>
        <Pencil className="size-3.5" aria-hidden />
        {iconOnly ? null : <span>{label}</span>}
      </button>
    );
  },
);
