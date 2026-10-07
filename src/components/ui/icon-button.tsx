import * as React from "react";
import { cn } from "@/lib/utils";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

/**
 * Icon-only buttons, v4. Every one needs an accessible name (`aria-label`); the page-wide tooltip layer shows it on
 * hover and keyboard focus.
 * - `ghost` (default): 32×32 r10, secondary icon, fill-1 and the foreground on hover. The top bar, table rows ("…").
 * - `outline`: 40×40 r12 with a 10% hairline (the top-right action on a stat card).
 * - `round`: 36px circle, ghost (the prompt's microphone and "+").
 * Sizes for ghost: `xs` 28 (r8), `sm` 32 (default), `md` 36. Small sizes grow to 40px on touch screens.
 * A lucide icon given as its child plays its animated twin on hover and keyboard focus (components/ui/animated-icons).
 */
export const ICON_BUTTON = "relative inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-secondary transition-[color,background-color,border-color] duration-75 hover:bg-fill-1 hover:text-foreground aria-expanded:bg-fill-1 aria-expanded:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-10 [&_svg]:size-4 [&_svg]:shrink-0";

const VARIANT = {
  ghost: "",
  outline: "size-10 rounded-xl border border-border-input bg-background text-foreground hover:border-border-input-hover hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))] [&_svg]:size-[18px]",
  round: "size-9 rounded-full [&_svg]:size-[18px]",
} as const;
const SIZE = { xs: "size-7 rounded-lg [&_svg]:size-3.5", sm: "", md: "size-9 [&_svg]:size-[18px]" } as const;

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string; variant?: keyof typeof VARIANT; size?: keyof typeof SIZE };

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ className, variant = "ghost", size = "sm", type = "button", children, ...props }, ref) {
  return <button ref={ref} type={type} className={cn(ICON_BUTTON, variant === "ghost" ? SIZE[size] : VARIANT[variant], className)} {...props}>{withAnimatedIcons(children)}</button>;
});
