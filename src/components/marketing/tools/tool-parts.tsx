import { getPage, type MarketingPath } from "@/lib/marketing/registry";
import { ORGANIZATION, ref, type JsonLdNode } from "@/lib/marketing/schema";
import { absoluteUrl } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * Parts the free tools' pages share (owner request, 17 October 2026: SEO analysis, Content Plan pages 13 and 14). The tool
 * itself sits in the kit's ToolShell (pages v2, owner feedback the same day), which replaced this file's ToolSection.
 */

/**
 * A tool's WebApplication node for PageHero's `jsonLd`: free, in the browser, published by Boredroom (the Organization
 * node PageHero already writes), so a search engine can tell the page is a working tool and not an article about one.
 */
export function toolJsonLd(path: MarketingPath, name: string, featureList: readonly string[]): JsonLdNode {
  const page = getPage(path);
  const url = absoluteUrl(path);
  return {
    "@type": "WebApplication",
    "@id": `${url}#app`,
    name,
    url,
    description: page.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (runs in a web browser)",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    inLanguage: "en-GB",
    featureList: [...featureList],
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: ref(ORGANIZATION),
    mainEntityOfPage: { "@id": `${url}#webpage` },
  };
}

/** Text as someone typed it (an example's input), in a hairline box, wrapping rather than scrolling. */
export function TypedBlock({ title, text, className }: { title: string; text: string; className?: string }) {
  return (
    <div data-plain className={cn("overflow-hidden rounded-2xl border border-border bg-fill-0", className)}>
      <p data-plain className="border-b border-border px-4 py-2.5 text-sm font-medium text-foreground">{title}</p>
      <pre data-plain className="whitespace-pre-wrap break-words p-4 font-mono text-[13.6px] leading-[21px] text-secondary sm:p-5">{text}</pre>
    </div>
  );
}
