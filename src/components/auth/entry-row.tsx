import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A way forward on the entry screens (the workspace list, "How are you joining?"): v4's list tile (spec §7) grown to
 * the 64px list row. A 40px leading mark, the title 14/20 semibold (truncates), a subtitle 13/19.5 regular in the
 * secondary grey, an optional trailing badge, and a chevron. Outline at rest (r12, the 10% input hairline); on hover
 * the hairline goes to 16% and the fill to fill-0. The whole row is one link.
 */
export function EntryRow({ href, leading, title, subtitle, trailing, className }: { href: string; leading?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn(
      "group flex min-h-16 items-center gap-3 rounded-xl border border-border-input bg-background px-3 py-3 transition-colors duration-75",
      "hover:border-border-input-hover hover:bg-[color-mix(in_srgb,var(--foreground)_2.4%,var(--background))]",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
      className,
    )}>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        {subtitle ? <span className="block text-meta font-normal text-secondary">{subtitle}</span> : null}
      </span>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-subtle transition-colors duration-75 group-hover:text-foreground" aria-hidden />
    </Link>
  );
}

/** An organisation's mark: its initial on a solid grey 40px square, r12 (no gradient, no colour). */
export function OrgMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 select-none place-items-center rounded-xl bg-grey-100 text-base font-semibold text-foreground", className)}>
      {name.trim().charAt(0).toUpperCase() || "B"}
    </span>
  );
}
