import { Plus } from "lucide-react";
import { WRAP } from "@/components/landing/parts";
import { JsonLd } from "@/components/marketing/json-ld";
import { SectionHead } from "@/components/marketing/section";
import type { MarketingPath } from "@/lib/marketing/registry";
import { faqPageJsonLd, type FaqItem } from "@/lib/marketing/schema";
import { absoluteUrl } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * A product page's questions (owner feedback, 17 October 2026: pages v2; the home page's FAQ look): the FAQPage JSON-LD
 * built from the same list it shows, exactly as FaqSection (`faqPageJsonLd(items, absoluteUrl(path))`), so the two
 * match word for word; answers plain text. Each question a native <details> (the first open) whose summary holds the
 * h3 and a Plus that turns to ×, hairlines between; works without script and every answer is in the HTML.
 * `layout="split"`: the head holds on the left from 768px while the questions scroll (the home page's FAQ); `stacked`:
 * the head above. Blog posts keep FaqSection (an open list inside the article).
 *
 *   <FaqAccordion path={PATH} items={FAQ} label="Questions" />
 */
export function FaqAccordion({ path, items, id = "faq", title = "Frequently asked questions", label, sub, layout = "split", tone = "plain", className }: {
  path: MarketingPath;
  items: readonly FaqItem[];
  id?: string;
  title?: React.ReactNode;
  label?: React.ReactNode;
  sub?: React.ReactNode;
  layout?: "split" | "stacked";
  tone?: "plain" | "tint";
  className?: string;
}) {
  const split = layout === "split";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-20 sm:py-28", tone === "tint" && "border-y border-border bg-fill-0", className)}>
      <JsonLd data={{ "@context": "https://schema.org", ...faqPageJsonLd(items, absoluteUrl(path)) }} />
      <div className={cn(WRAP, split ? "grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-16" : "max-w-[calc(48rem+48px)]")}>
        <div className={cn("min-w-0", split && "lp-sticky-col")}>
          <SectionHead id={`${id}-title`} label={label} title={title} sub={sub} className={split ? "lp-sticky" : undefined} />
        </div>
        <div className={cn("mk-acc min-w-0 divide-y divide-border border-y border-border", !split && "mt-12")}>
          {items.map(({ question, answer }, i) => (
            <details key={question} open={i === 0} className="group">
              <summary className="flex cursor-pointer items-start gap-4 rounded-lg py-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                <h3 className="min-w-0 flex-1 text-base font-medium text-foreground text-pretty">{question}</h3>
                <Plus aria-hidden className="mk-acc-plus mt-0.5 size-5 shrink-0 text-secondary transition-colors duration-75 group-hover:text-foreground" />
              </summary>
              <p className="lp-text pb-5 pr-10">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
