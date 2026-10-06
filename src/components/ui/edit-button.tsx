"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * The one way to say "edit" on the platform (owner decision, 25 September 2026). v4: an xs outline button (28px, r8,
 * 13px) with a pencil, or the 28px icon-only version (`iconOnly`, named by `label` for screen readers and the tooltip).
 */
export const EditButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: React.ReactNode; iconOnly?: boolean }>(
  function EditButton({ className, label = "Edit", iconOnly = false, type = "button", ...props }, ref) {
    return (
      <button ref={ref} type={type} aria-label={iconOnly ? String(label) : undefined} className={cn(buttonVariants({ variant: "secondary", size: iconOnly ? "icon-xs" : "xs" }), iconOnly ? "border border-border-input" : "text-secondary hover:text-foreground", className)} {...props}>
        <Pencil aria-hidden />
        {iconOnly ? null : <span>{label}</span>}
      </button>
    );
  },
);
