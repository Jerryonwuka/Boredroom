import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * One surface, five jobs: a dark bordered button with 16px corners (see .btn). `primary` adds an orange hairline,
 * `outline` and `subtle` are the plain surface, `ghost` is text only, `danger` reads red. Nothing animates on its own.
 */
const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-semibold transition-[background-color,border-color,color,transform,opacity,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--border-strong)] focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary: "btn-primary",
        outline: "",
        ghost: "btn-ghost",
        subtle: "",
        danger: "btn-danger",
      },
      size: {
        sm: "h-9 px-4 text-sm rounded-[10px]",
        md: "h-11 px-5 text-[15px]",
        lg: "h-14 px-7 text-base",
        icon: "size-10 rounded-[10px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { buttonVariants };
