import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { trailOf, type MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * The breadcrumb trail of a public page (owner request, 17 October 2026: SEO analysis): Home, the section, the page,
 * from the registry, so it always matches the page's BreadcrumbList (the hero emits both). The app's top-bar breadcrumb
 * look: 13px, the secondary grey, chevrons, the current page in the foreground and marked `aria-current`.
 *
 * `variant="pill"` (owner feedback, 17 October 2026: pages v2): the same list drawn as the home hero's pill, the label
 * pill above a product page's H1. One line: the current page truncates when the pill would overflow (the H1 repeats it).
 */
export function Breadcrumbs({ path, variant = "plain", className }: { path: MarketingPath; variant?: "plain" | "pill"; className?: string }) {
  const trail = trailOf(path);
  const pill = variant === "pill";
  return (
    <nav aria-label="Breadcrumb" className={cn(pill && "flex min-w-0 max-w-full", className)}>
      <ol className={cn("flex items-center text-meta font-medium text-secondary",
        pill ? "inline-flex min-h-8 min-w-0 max-w-full gap-1 rounded-full border border-border-input bg-[color-mix(in_srgb,var(--background)_55%,transparent)] px-3"
          : "flex-wrap gap-x-1 gap-y-1")}>
        {trail.map((p, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={p.path} className={cn("flex items-center gap-1", last ? "min-w-0" : "shrink-0")}>
              {i > 0 ? <ChevronRight aria-hidden className={cn("shrink-0", pill ? "size-3 text-subtle" : "size-3.5")} /> : null}
              {last ? <span aria-current="page" className={cn("text-foreground", pill && "min-w-0 truncate")}>{p.label}</span>
                : <Link href={p.path} className="rounded-sm whitespace-nowrap transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{p.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
