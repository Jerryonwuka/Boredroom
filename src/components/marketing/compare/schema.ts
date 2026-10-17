import { getPage, type MarketingPath } from "@/lib/marketing/registry";
import { ORGANIZATION, SOFTWARE_APPLICATION, WEBSITE, ref, type JsonLdNode } from "@/lib/marketing/schema";
import { absoluteUrl, ogImagePath } from "@/lib/marketing/site";
import { TOOLS, sourcesFor, type SourceKey, type ToolId } from "@/components/marketing/compare/data";

/**
 * The Article node of a comparison page (owner request, 17 October 2026: SEO analysis: Article, BreadcrumbList and
 * FAQPage on the comparison pages). PageHero already writes the WebPage, the BreadcrumbList, the Organization, the
 * WebSite and the SoftwareApplication; FaqSection writes the FAQPage. This adds the Article with its dates from the
 * registry and, as `citation`, the vendor pages its facts came from (the same list the page shows under "Sources").
 *
 * `about` (review fix, 17 October 2026): Boredroom is the graph's own SoftwareApplication node, by reference, never a
 * second copy; each other tool is its vendor as a plain Organization with its official site, not a name-only
 * SoftwareApplication (which validators report as an incomplete Software App item: no offers, no rating).
 */
export function aboutNode(id: ToolId): JsonLdNode | { "@id": string } {
  if (id === "boredroom") return ref(SOFTWARE_APPLICATION);
  const tool = TOOLS[id];
  return { "@type": "Organization", name: tool.name, url: tool.site };
}

export function comparisonArticle(path: MarketingPath, sources: readonly SourceKey[], about: readonly ToolId[]): JsonLdNode {
  const page = getPage(path);
  const url = absoluteUrl(path);
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: page.h1,
    description: page.description,
    datePublished: page.published ?? page.updated,
    dateModified: page.updated,
    inLanguage: "en-GB",
    image: { "@type": "ImageObject", url: absoluteUrl(ogImagePath(path)), width: 1200, height: 630 },
    author: ref(ORGANIZATION),
    publisher: ref(ORGANIZATION),
    mainEntityOfPage: { "@id": `${url}#webpage` },
    isPartOf: ref(WEBSITE),
    about: about.map(aboutNode),
    citation: sourcesFor(sources).map((s) => ({ "@type": "CreativeWork", name: s.title, url: s.url, publisher: { "@type": "Organization", name: s.publisher } })),
  };
}
