import { JsonLd } from "@/components/marketing/json-ld";
import type { MarketingPath } from "@/lib/marketing/registry";
import { faqPageJsonLd, type FaqItem } from "@/lib/marketing/schema";
import { absoluteUrl } from "@/lib/marketing/site";

/**
 * A page's questions and answers (owner request, 17 October 2026: SEO analysis: "H2: FAQ, H3: each question"), always
 * visible (no accordion: the answers are what a featured snippet or an AI answer lifts), with the FAQPage JSON-LD built
 * from the same list, so the two match word for word. Answers are plain text for that reason. Put it inside ArticleBody
 * or Prose, usually last.
 *
 *   <FaqSection path="/blog/end-of-day-report" items={[{ question: "How long should an end-of-day report be?", answer: "…" }]} />
 */
export function FaqSection({ path, items, title = "Frequently asked questions", id = "faq" }: {
  path: MarketingPath;
  items: readonly FaqItem[];
  title?: string;
  /** The h2's id (the table of contents links to it). */
  id?: string;
}) {
  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", ...faqPageJsonLd(items, absoluteUrl(path)) }} />
      <h2 id={id}>{title}</h2>
      {items.map(({ question, answer }) => (
        <div key={question}>
          <h3>{question}</h3>
          <p className="mt-2">{answer}</p>
        </div>
      ))}
    </>
  );
}
