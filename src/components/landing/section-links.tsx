import Link from "next/link";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import type { MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * Links from a home page section to the pages that cover it in full (owner request, 17 October 2026: SEO analysis,
 * Section D: hub and spoke; the home page links to each section and to its most important pages, at most 15 in all).
 * Quiet ghost links in the foreground colour with the chevron twin (it nudges on hover and keyboard focus); the words
 * name the destination, never "read more".
 */
export function SectionLinks({ links, align = "center", className }: {
  links: readonly { href: MarketingPath; label: string }[];
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <ul className={cn("mt-8 flex flex-wrap gap-x-1 gap-y-1", align === "center" ? "justify-center" : "-ml-2.5 justify-start", className)}>
      {links.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-auto min-h-8 gap-1 py-1 text-left text-sm text-foreground")}>
            {l.label}<AnimatedChevronRight aria-hidden className="shrink-0 text-secondary" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
