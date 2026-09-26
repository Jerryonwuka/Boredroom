"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A select that submits its form the moment it changes (owner decision, 26 September 2026: no Show buttons).
 * Server pages keep their plain GET forms; this is the only client piece they need.
 */
export function AutoSubmitSelect({ className, onChange, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("field field-sm", className)} onChange={(e) => { onChange?.(e); e.currentTarget.form?.requestSubmit(); }} />;
}
