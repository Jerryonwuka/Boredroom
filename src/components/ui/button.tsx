import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

/**
 * Buttons, v4 (measured from the ElevenLabs app, 6 October 2026). Inter 14/20 medium, colours change in 75ms, the
 * orange focus ring from the keyboard only, nothing scales or glows.
 *
 * - `primary`: solid white with near-black text (inverted in light). One per view.
 * - `secondary` (alias `outline`): the canvas colour with a 10% hairline; hover fill-0 and a 16% hairline.
 * - `ghost`: text only, secondary grey; hover fill-1 and the foreground.
 * - `subtle`: fill-1 with foreground text, no line (a quiet filled button).
 * - `accent`: Boredroom orange with near-black text, a lighter orange on hover (darker in light). THE STANDOUT ACTION:
 *   the one thing to do on a screen ("New document", "Add people", "Start" on the next to-do, an Upgrade) may be
 *   `variant="accent"` (on a Link: `buttonVariants({ variant: "accent" })`); every other primary stays white. Never
 *   two orange buttons on one screen (accent rules, owner decision 6 October 2026).
 * - `danger`: outline with red text. `destructive`: red fill, for the confirm step of a destructive action.
 * - `link`: inline text link in the secondary grey; its underline is orange on hover (in running text prefer the
 *   `.link-inline` class: the foreground with a hairline underline that turns orange).
 *
 * Sizes: xs 28 (px8 r8 13px), sm 32 (px10 r10 13px), md 36 (px12 r10), lg 40 (px16 r12), tile 56 (p16 r12, a 24px
 * icon then the label, left aligned). Icon-only: icon-xs 28, icon-sm 32 (r10), icon 40 (r12), icon-round 36 (round,
 * the prompt's actions). Small sizes grow to 40px on touch screens. `loading` shows a spinner and disables the button.
 *
 * A lucide icon among `Button`'s children that has an animated twin is swapped for it (components/ui/animated-icons):
 * it plays while the button is hovered or focused from the keyboard. `buttonVariants` on a link leaves its icons alone;
 * use the twin there (`AnimatedPlus`).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity] duration-75 ease-out select-none disabled:pointer-events-none aria-disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover disabled:bg-[var(--border-input-hover)] disabled:text-subtle",
        secondary: "border border-border-input bg-background text-foreground hover:border-border-input-hover hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))] disabled:opacity-50",
        outline: "border border-border-input bg-background text-foreground hover:border-border-input-hover hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))] disabled:opacity-50",
        ghost: "bg-transparent text-secondary hover:bg-fill-1 hover:text-foreground aria-expanded:bg-fill-1 aria-expanded:text-foreground disabled:opacity-50",
        subtle: "bg-fill-1 text-foreground hover:bg-fill-150 disabled:opacity-50",
        accent: "bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50",
        danger: "border border-border-input bg-background text-danger hover:border-danger/40 hover:bg-danger/10 disabled:opacity-50",
        destructive: "bg-danger-solid text-white hover:bg-danger-solid/90 disabled:opacity-50",
        link: "h-auto! p-0! text-secondary underline-offset-4 hover:text-foreground hover:underline hover:decoration-accent disabled:opacity-50",
      },
      size: {
        xs: "h-7 rounded-lg px-2 text-meta [&_svg]:size-3.5 pointer-coarse:h-10",
        sm: "h-8 rounded-[10px] px-2.5 text-meta [&_svg]:size-4 pointer-coarse:h-10",
        md: "h-9 rounded-[10px] px-3 text-sm [&_svg]:size-4",
        lg: "h-10 rounded-xl px-4 text-sm [&_svg]:size-[18px]",
        tile: "h-14 justify-start gap-2 rounded-xl p-4 text-sm [&_svg]:size-6 [&>svg:first-child]:-ml-[3px] [&>svg:first-child]:mr-0.5 [&>svg:first-child]:text-secondary",
        "icon-xs": "size-7 rounded-lg [&_svg]:size-3.5 pointer-coarse:size-10",
        "icon-sm": "size-8 rounded-[10px] [&_svg]:size-4 pointer-coarse:size-10",
        icon: "size-10 rounded-xl [&_svg]:size-[18px]",
        "icon-round": "size-9 rounded-full [&_svg]:size-[18px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner in place of the leading icon and disables the button while an action runs. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, type = "button", loading = false, disabled, children, ...props }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {withAnimatedIcons(children)}
    </button>
  );
});

export { buttonVariants };
