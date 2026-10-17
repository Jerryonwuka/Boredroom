import { Check } from "lucide-react";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { JsonLd } from "@/components/marketing/json-ld";
import { WRAP } from "@/components/landing/parts";
import { getPage, type MarketingPath } from "@/lib/marketing/registry";
import { pageJsonLd, type JsonLdNode } from "@/lib/marketing/schema";
import { formatDate } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * Splits an H1 once, at the first ": " or "? ", into the part up to and including the colon or question mark and the
 * rest (owner feedback, 17 October 2026: pages v2: a two-tone headline, the highlighted phrase of the reference in
 * Boredroom's monochrome). Joined by one space the two parts are the H1, byte for byte. No split character: all head.
 */
export function splitTitle(h1: string): { head: string; rest: string } {
  const hits = [h1.indexOf(": "), h1.indexOf("? ")].filter((i) => i > 0);
  if (!hits.length) return { head: h1, rest: "" };
  const at = Math.min(...hits) + 1;
  return { head: h1.slice(0, at), rest: h1.slice(at + 1) };
}

/** The H1 sizes: the split hero's (a text column beside a picture) and the centred hero's. */
export const HERO_TITLE = {
  split: "font-display text-[34px] font-normal leading-[40px] tracking-[-0.025em] text-balance text-foreground sm:text-[42px] sm:leading-[48px] lg:text-[48px] lg:leading-[54px]",
  center: "font-display text-[34px] font-normal leading-[40px] tracking-[-0.025em] text-balance text-foreground sm:text-[44px] sm:leading-[50px] lg:text-[52px] lg:leading-[58px]",
} as const;

/** The page's H1 in two tones: the foreground up to the split, the secondary grey after it. Never orange. */
export function TwoToneTitle({ text, className }: { text: string; className?: string }) {
  const { head, rest } = splitTitle(text);
  return (
    <h1 id="page-title" className={className}>
      {rest ? <><span>{head}</span>{" "}<span className="text-secondary">{rest}</span></> : head}
    </h1>
  );
}

/** Check chips: a few true words each, a tick beside every one (POSITIONING_POINTS, a tool's facts). */
export function PointChips({ points, className }: { points: readonly React.ReactNode[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2", className)}>
      {points.map((p, i) => (
        <li key={i} className="inline-flex items-center gap-1.5 text-meta font-medium text-secondary">
          <Check aria-hidden className="size-3.5 shrink-0 text-foreground" strokeWidth={2.5} />{p}
        </li>
      ))}
    </ul>
  );
}

/**
 * The top of a product-style public page (owner feedback, 17 October 2026: pages v2: "like actual product pages, like
 * the homepage"; the reference's two-column hero). A `<header>` with the page's structured data (exactly as PageHero:
 * `pageJsonLd(path, jsonLd)`), the breadcrumb pill, the page's one H1 from the registry in two tones, a lead in the
 * foreground (the registry description unless given), an optional sub in the secondary grey, "Updated {date}" (posts
 * and comparisons by default), the actions (`<PrimaryCta secondary={…} />`), check chips and the picture.
 *
 * `layout="split"`: text left, picture right from 1024px (under the text below). `layout="center"`: everything centred,
 * the picture or `footer` (a VersusLockup, a Definition card) under it. `compact` tightens the foot (a tool page, whose
 * tool must sit above the fold). Exactly one per page, first in the page; never write another <h1>.
 *
 *   <ProductHero path="/features/ai-assistant" lead={<>{ENTITY_SENTENCE}</>} sub="…"
 *     actions={<PrimaryCta secondary={{ href: "/pricing", label: "See pricing" }} />} points={POSITIONING_POINTS}
 *     visual={<HeroCluster primary={<FollowUpMock />} />} />
 */
export function ProductHero({ path, layout = "split", lead, sub, actions, points, visual, footer, updated, jsonLd, compact = false, className }: {
  path: MarketingPath;
  layout?: "split" | "center";
  /** 18/28 in the foreground, one or two sentences; the registry description when absent. */
  lead?: React.ReactNode;
  /** 16/26 in the secondary grey, under the lead. */
  sub?: React.ReactNode;
  /** The buttons: `<PrimaryCta secondary={…} />`. */
  actions?: React.ReactNode;
  /** Check chips under the actions (POSITIONING_POINTS, a tool's facts). */
  points?: readonly React.ReactNode[];
  /** Split: the right-hand column. Center: under the text, full width. */
  visual?: React.ReactNode;
  /** Center only: under the actions (a VersusLockup, a Definition card …). */
  footer?: React.ReactNode;
  /** "Updated {date}" from the registry; on by default for posts and comparisons. */
  updated?: boolean;
  /** Extra JSON-LD nodes for the page's graph (comparisonArticle, toolJsonLd …). */
  jsonLd?: readonly JsonLdNode[];
  compact?: boolean;
  className?: string;
}) {
  const page = getPage(path);
  const centred = layout === "center";
  const showUpdated = updated ?? (page.kind === "post" || page.kind === "comparison");
  const text = (
    <div className={cn("min-w-0", centred ? "mx-auto max-w-3xl text-center" : "max-w-[640px]")}>
      <Breadcrumbs path={path} variant="pill" className={cn("mb-6 sm:mb-8", centred && "justify-center")} />
      <TwoToneTitle text={page.h1} className={HERO_TITLE[layout]} />
      <div className={cn("mk-links mt-5 text-[17px] leading-[26px] text-foreground text-pretty sm:text-lg sm:leading-7 [&>*+*]:mt-3", centred && "mx-auto max-w-2xl")}>
        {lead ?? <p>{page.description}</p>}
      </div>
      {sub ? <div className={cn("mk-links mt-3 text-base leading-[26px] text-secondary text-pretty [&>*+*]:mt-3", centred && "mx-auto max-w-2xl")}>{sub}</div> : null}
      {showUpdated ? <p className="mt-5 text-meta font-normal text-secondary">Updated <time dateTime={page.updated}>{formatDate(page.updated)}</time></p> : null}
      {actions ? <div className={cn("mt-8 flex flex-wrap items-center gap-3", centred && "justify-center")}>{actions}</div> : null}
      {points?.length ? <PointChips points={points} className={cn(actions ? "mt-6" : "mt-7", centred && "justify-center")} /> : null}
    </div>
  );
  return (
    <header className={cn(WRAP, "pt-10 sm:pt-14 lg:pt-16", compact ? "pb-8" : "pb-16 sm:pb-20", className)}>
      <JsonLd data={pageJsonLd(path, jsonLd)} />
      {centred ? (
        <>
          {text}
          {footer ? <div className="mx-auto mt-10 flex max-w-3xl justify-center">{footer}</div> : null}
          {visual ? <div className="mt-12 min-w-0">{visual}</div> : null}
        </>
      ) : (
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-14">
          {text}
          {visual ? <div className="min-w-0">{visual}</div> : null}
        </div>
      )}
    </header>
  );
}
