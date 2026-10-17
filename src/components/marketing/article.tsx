import { ChevronDown } from "lucide-react";
import { WRAP } from "@/components/landing/parts";
import { cn } from "@/lib/utils";
import s from "./prose.module.css";

/**
 * Long-form text (owner request, 17 October 2026: SEO analysis): plain h2, h3, p, ul, ol, table, blockquote, code and
 * figure inside, styled by prose.module.css. Give every h2 an `id` (the table of contents links to it).
 */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(s.prose, className)}>{children}</div>;
}

export type TocItem = { id: string; label: string };

const TOC_LINK = "block rounded-md py-1 text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

/**
 * "On this page": the page's h2s. From 1024px up a quiet list that holds beside the text as it scrolls (clear of the
 * notch); below that, a closed disclosure above the text.
 */
export function Toc({ items }: { items: readonly TocItem[] }) {
  const list = (
    <ol className="mt-2 space-y-0.5">
      {items.map((i) => <li key={i.id}><a href={`#${i.id}`} className={TOC_LINK}>{i.label}</a></li>)}
    </ol>
  );
  return (
    <>
      <nav aria-label="On this page" className="mb-10 lg:hidden">
        <details className="group rounded-xl border border-border bg-fill-0 px-4 py-1">
          <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            On this page<ChevronDown aria-hidden className="size-4 text-secondary transition-transform duration-150 group-open:rotate-180" />
          </summary>
          <div className="pb-3">{list}</div>
        </details>
      </nav>
      <nav aria-label="On this page" className="hidden lg:block">
        <div className="sticky top-[calc(var(--lp-sticky-top)+24px)]">
          <p className="text-sm font-medium text-foreground">On this page</p>
          {list}
        </div>
      </nav>
    </>
  );
}

/**
 * The body of a long page: the text column (Prose) and, with `toc`, the table of contents beside it from 1024px up
 * (above it on smaller screens). Use it under PageHero.
 *
 *   <ArticleBody toc={[{ id: "what-is-it", label: "What is an end-of-day report?" }, …]}>
 *     <h2 id="what-is-it">What is an end-of-day report?</h2> …
 *   </ArticleBody>
 */
export function ArticleBody({ toc, children, className }: { toc?: readonly TocItem[]; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(WRAP, "mt-12 sm:mt-16", className)}>
      {toc?.length ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16">
          <div className="min-w-0 lg:order-2"><Toc items={toc} /></div>
          <Prose className="lg:order-1">{children}</Prose>
        </div>
      ) : <Prose>{children}</Prose>}
    </div>
  );
}
