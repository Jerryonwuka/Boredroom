import { IndexGrid } from "@/components/marketing/index-grid";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { ProductHero } from "@/components/marketing/product-hero";
import { RelatedLinks } from "@/components/marketing/related-links";
import { Section } from "@/components/marketing/section";
import { childrenOf, getPage, relatedOf, type MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

/**
 * A section's index page (owner request, 17 October 2026: SEO analysis, Section B: "each folder needs an index route
 * that lists its child pages"; Section D: hubs link down to every page in the folder). Pages v2 (owner feedback the same
 * day: product pages, not documents): a centred hero from the registry with the call to action, the intro the hub
 * passes (`children`, kept in the page body: its links are load-bearing), a section with every page of the hub as cards
 * (IndexGrid: from the registry, so a new page appears the moment it is registered; titles h3 under the section's h2),
 * the sections the hub passes after it (`after`), then the hub's `related` cross-links ("Elsewhere on Boredroom").
 *
 *   export const metadata = pageMetadata("/blog");
 *   export default function Page() { return <HubPage path="/blog" grid={{ label: "Every guide", title: "…" }} />; }
 */
export function HubPage({ path, lead, sub, actions, secondary, points, grid, visuals, featured, featuredSpan, labels, children, after, className }: {
  path: MarketingPath;
  /** Under the H1; the registry description when absent. */
  lead?: React.ReactNode;
  sub?: React.ReactNode;
  /** The hero's buttons; by default the call to action and `secondary` (an outline link); `null` for none. */
  actions?: React.ReactNode;
  secondary?: { href: string; label: string };
  /** Check chips under the hero's buttons. */
  points?: readonly React.ReactNode[];
  /** The every-page section's head: a label chip, the h2 (the hub's label by default) and a line. */
  grid?: { label?: string; title?: string; sub?: React.ReactNode; id?: string; columns?: 2 | 3 };
  visuals?: Partial<Record<MarketingPath, React.ReactNode>>;
  featured?: MarketingPath;
  featuredSpan?: 2 | "row";
  labels?: Partial<Record<MarketingPath, string>>;
  /** Between the hero and the cards: the hub's intro. Use h2 for any heading in it. */
  children?: React.ReactNode;
  /** After the cards: "what they share". */
  after?: React.ReactNode;
  className?: string;
}) {
  const page = getPage(path);
  const gridId = grid?.id ?? "all";
  return (
    <div className={className}>
      <ProductHero path={path} layout="center" lead={lead} sub={sub} points={points}
        actions={actions === undefined ? <PrimaryCta secondary={secondary} /> : actions} />
      {children}
      <Section id={gridId} label={grid?.label ?? `Every page`} title={grid?.title ?? page.label} sub={grid?.sub} align="center"
        className={cn(children ? undefined : "pt-8 sm:pt-12")}>
        <IndexGrid pages={childrenOf(path)} visuals={visuals} featured={featured} featuredSpan={featuredSpan} labels={labels} columns={grid?.columns} />
      </Section>
      {after}
      <RelatedLinks title="Elsewhere on Boredroom" label="Keep exploring" id="elsewhere" links={relatedOf(path).map((p) => p.path)} />
    </div>
  );
}
