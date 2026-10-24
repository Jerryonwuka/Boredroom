import Link from "next/link";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { WRAP, arrive } from "@/components/landing/parts";
import { PageIcon } from "@/components/marketing/page-icon";
import { SectionHead } from "@/components/marketing/section";
import { pageIcon } from "@/lib/marketing/menus";
import { getPage, type MarketingPath, type RegistryPage } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/** What a card says a page is, beside its title. */
export const KIND_LABEL: Record<RegistryPage["kind"], string> = {
  home: "Home", hub: "Section", post: "Guide", feature: "Feature", solution: "Solution", usecase: "Use case", comparison: "Comparison", tool: "Free tool", pricing: "Pricing", download: "Download",
};

export type RelatedLink = MarketingPath | { href: MarketingPath; /** The anchor text; the page's label when absent. */ label?: string; /** The line under it; the page's summary when absent. */ summary?: string };

/** The page's icon in a hairline square (36px, or the 40px tool square size for `lg`). */
export function PageIconSquare({ path, size = "md", className }: { path: MarketingPath; size?: "md" | "lg"; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center border border-border bg-background text-secondary transition-colors duration-75 group-hover:text-foreground group-has-[a:focus-visible]:text-foreground",
      size === "lg" ? "size-10 rounded-xl [&_svg]:size-5" : "size-9 rounded-[10px] [&_svg]:size-[18px]", className)}>
      <PageIcon name={pageIcon(path)} />
    </span>
  );
}

/**
 * A card that links one page (owner feedback, 17 October 2026: pages v2): the page's icon in a hairline square, its kind
 * as a quiet chip, its title as the link (the whole card is clickable; the link's words name the destination), the
 * summary, a chevron that nudges on hover and focus. r20 hairline on fill-0, as the home page's cards. `as` sets the
 * title's heading level so the outline never skips one; `size="lg"` is an index page's larger card.
 */
export function PageCard({ link, as: Heading = "h3", size = "md", className, style }: { link: RelatedLink; as?: "h2" | "h3"; size?: "md" | "lg"; className?: string; style?: React.CSSProperties }) {
  const { href, label, summary } = typeof link === "string" ? { href: link, label: undefined, summary: undefined } : link;
  const page = getPage(href);
  const lg = size === "lg";
  return (
    <article style={style} className={cn("group relative flex min-w-0 flex-col rounded-[20px] border border-border bg-fill-0 transition-colors duration-75 hover:border-border-input-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-[var(--ring)]", lg ? "p-6 sm:p-7" : "p-5 sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <PageIconSquare path={href} size={lg ? "lg" : "md"} />
        <span className="inline-flex h-6 items-center rounded-full bg-fill-1 px-2.5 text-xs font-medium text-secondary">{KIND_LABEL[page.kind]}</span>
      </div>
      <Heading className={cn("font-display font-normal tracking-[-0.01em] text-balance text-foreground", lg ? "mt-6 text-[22px] leading-[28px]" : "mt-5 text-[20px] leading-[26px]")}>
        <Link href={href} className="outline-none after:absolute after:inset-0 after:rounded-[20px]">{label ?? page.label}</Link>
      </Heading>
      <p className="lp-text mt-2 flex-1">{summary ?? page.summary}</p>
      <AnimatedChevronRight aria-hidden className="mt-5 size-4 text-secondary transition-colors duration-75 group-hover:text-foreground" />
    </article>
  );
}

/**
 * Related pages at the end of a page (owner request, 17 October 2026: SEO analysis, Section D: hub and spoke; every page
 * links on to the pages a reader needs next, at least one of them a product page). Pages v2: a section with a centred
 * head (an optional label chip and line) and a grid of PageCards, three across from 1024px. Registry paths only (a typo
 * is a type error); pass `{ href, label }` to vary the anchor text for the same destination across pages.
 *
 *   <RelatedLinks title="Keep reading" label="Keep exploring" links={["/blog/end-of-day-report-template", { href: "/features/ai-assistant", label: "…" }]} />
 */
export function RelatedLinks({ title = "Related", label, sub, links, id = "related", className }: {
  title?: string;
  label?: React.ReactNode;
  sub?: React.ReactNode;
  links: readonly RelatedLink[];
  id?: string;
  className?: string;
}) {
  if (!links.length) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 py-20 sm:py-28", className)}>
      <div className={WRAP}>
        <SectionHead id={`${id}-title`} label={label} title={title} sub={sub} align="center" />
        <div className={cn("mt-12 grid gap-3 sm:grid-cols-2", links.length === 2 ? "lg:mx-auto lg:max-w-4xl" : links.length >= 3 && "lg:grid-cols-3", links.length === 4 && "lg:grid-cols-2 lg:mx-auto lg:max-w-4xl")}>
          {links.map((l, i) => <PageCard key={typeof l === "string" ? l : l.href} link={l} className="lp-reveal" style={arrive(i % 3)} />)}
        </div>
      </div>
    </section>
  );
}
