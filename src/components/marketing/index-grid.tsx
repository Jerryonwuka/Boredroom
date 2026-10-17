import Link from "next/link";
import { AnimatedChevronRight } from "@/components/ui/animated-icons";
import { arrive } from "@/components/landing/parts";
import { KIND_LABEL, PageCard, PageIconSquare } from "@/components/marketing/related-links";
import { getPage, type MarketingPath, type RegistryPage } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * Every page of a section as cards (owner feedback, 17 October 2026: pages v2; the reference's index grid): a page with
 * a picture in `visuals` gets the home page's feature card (the picture first, cut at a fixed height with a soft fade,
 * then the kind, the title as the link and the summary); without one, the larger PageCard (its icon in a tool square).
 * No "Learn more" text: the title is the link. `featured` spans two columns from 1024px (picture beside the text).
 * Cards without a picture arrive in reading order (a picture plays its own arrival). Every child of the hub must be listed (the hub links down to every page: D2).
 *
 *   <IndexGrid pages={childrenOf("/features")} visuals={{ "/features/ai-assistant": <FollowUpMock /> }} />
 */
export function IndexGrid({ pages, visuals = {}, featured, featuredSpan = 2, labels = {}, headingLevel = "h3", columns = 3, className }: {
  pages: readonly (RegistryPage | MarketingPath)[];
  visuals?: Partial<Record<MarketingPath, React.ReactNode>>;
  featured?: MarketingPath;
  /** How wide the featured card is from 1024px: two columns, or the whole row. */
  featuredSpan?: 2 | "row";
  /** Anchor text per page, when a hub's card should not repeat another page's words (D6); the page's label otherwise. */
  labels?: Partial<Record<MarketingPath, string>>;
  headingLevel?: "h2" | "h3";
  columns?: 2 | 3;
  className?: string;
}) {
  const list = pages.map((p) => (typeof p === "string" ? getPage(p) : p));
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3", className)}>
      {list.map((p, i) => {
        const visual = visuals[p.path];
        const isFeatured = p.path === featured;
        const span = isFeatured ? cn("sm:col-span-2", featuredSpan === "row" && columns === 3 && "lg:col-span-3") : undefined;
        const style = arrive(i % columns);
        if (!visual) return <PageCard key={p.path} link={{ href: p.path, label: labels[p.path] }} as={headingLevel} size="lg" style={style} className={cn("lp-reveal", span)} />;
        return (
          <VisualCard key={p.path} page={p} visual={visual} label={labels[p.path]} featured={isFeatured} span={span} headingLevel={headingLevel} style={style} />
        );
      })}
    </div>
  );
}

function VisualCard({ page, visual, label, featured, span, headingLevel: Heading, style }: { page: RegistryPage; visual: React.ReactNode; label?: string; featured: boolean; span?: string; headingLevel: "h2" | "h3"; style: React.CSSProperties }) {
  return (
    <article style={style} className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-fill-0 p-5 transition-colors duration-75 hover:border-border-input-hover has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-[var(--ring)] sm:p-6",
      featured && "lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-10", span)}>
      <div className={cn("mk-peek pointer-events-none relative overflow-hidden", featured ? "max-h-[340px] [--peek-h:340px] lg:order-2" : "max-h-[260px] [--peek-h:260px]")}>{visual}</div>
      <div className={cn("flex flex-1 flex-col", featured ? "mt-6 lg:order-1 lg:mt-0" : "mt-6")}>
        <div className="flex items-center justify-between gap-3">
          <PageIconSquare path={page.path} />
          <span className="inline-flex h-6 items-center rounded-full bg-fill-1 px-2.5 text-xs font-medium text-secondary">{KIND_LABEL[page.kind]}</span>
        </div>
        <Heading className={cn("mt-5 font-display font-normal tracking-[-0.01em] text-balance text-foreground", featured ? "text-[26px] leading-[32px] sm:text-[28px] sm:leading-[34px]" : "text-[22px] leading-[28px]")}>
          <Link href={page.path} className="outline-none after:absolute after:inset-0 after:rounded-[20px]">{label ?? page.label}</Link>
        </Heading>
        <p className="lp-text mt-2 flex-1">{page.summary}</p>
        <AnimatedChevronRight aria-hidden className="mt-5 size-4 text-secondary transition-colors duration-75 group-hover:text-foreground" />
      </div>
    </article>
  );
}
