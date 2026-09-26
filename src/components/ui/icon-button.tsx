import * as React from "react";
import { cn } from "@/lib/utils";

/** The round 40px icon button used top right: the button surface, an icon, an accessible name. */
export const ICON_BUTTON = "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-[linear-gradient(180deg,var(--btn-top),var(--btn-bottom))] text-fg-muted shadow-[inset_0_1px_0_var(--highlight)] transition-[color,border-color] duration-[var(--duration-fast)] hover:border-border-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-[var(--border-strong)] focus-visible:outline-offset-2";

export const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }>(function IconButton({ className, ...props }, ref) {
  return <button ref={ref} type="button" className={cn(ICON_BUTTON, className)} {...props} />;
});
