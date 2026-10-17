import { ProductHero } from "@/components/marketing/product-hero";
import type { MarketingPath } from "@/lib/marketing/registry";
import type { JsonLdNode } from "@/lib/marketing/schema";

/** The H1 of a public page as the first build drew it (kept for anything that still imports it; heroes use HERO_TITLE). */
export const PAGE_TITLE = "font-display text-[34px] font-normal leading-[40px] tracking-[-0.025em] text-balance text-foreground sm:text-[44px] sm:leading-[50px] lg:text-[52px] lg:leading-[58px]";

/**
 * The top of a public page as the first build wrote it (owner request, 17 October 2026: SEO analysis): breadcrumbs, the
 * page's one H1 from the registry, the lead, "Updated …" on posts and comparisons, then `children` (the call to action).
 * It writes the page's structured data: WebPage (CollectionPage for a hub, plus BlogPosting for a post),
 * BreadcrumbList, Organization and WebSite, plus your `jsonLd` nodes.
 *
 * Pages v2 (owner feedback, 17 October 2026): drawn by ProductHero (the breadcrumb pill, the two-tone H1), same props,
 * same JSON-LD, so a page not yet rebuilt still matches the rest. New pages use ProductHero or ArticleHeader directly.
 */
export function PageHero({ path, lead, updated, align = "left", jsonLd, className, children }: {
  path: MarketingPath;
  /** Under the H1; the registry description when absent. */
  lead?: React.ReactNode;
  /** Show "Updated {date}" from the registry's `updated`; on by default for posts and comparisons. */
  updated?: boolean;
  align?: "left" | "center";
  /** Extra JSON-LD nodes for the page's graph (a tool's WebApplication, the pricing page's offers …). */
  jsonLd?: readonly JsonLdNode[];
  className?: string;
  /** Under the lead: usually the call to action. */
  children?: React.ReactNode;
}) {
  return (
    <ProductHero path={path} layout={align === "center" ? "center" : "split"} lead={lead} updated={updated} jsonLd={jsonLd}
      actions={children} className={className} compact />
  );
}
