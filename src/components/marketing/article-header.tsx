import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { JsonLd } from "@/components/marketing/json-ld";
import { HERO_TITLE, TwoToneTitle } from "@/components/marketing/product-hero";
import { VisualStage } from "@/components/marketing/hero-visual";
import { KIND_LABEL } from "@/components/marketing/related-links";
import { WRAP } from "@/components/landing/parts";
import { getPage, type MarketingPath } from "@/lib/marketing/registry";
import { pageJsonLd, type JsonLdNode } from "@/lib/marketing/schema";
import { formatDate } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/**
 * The top of a blog post (owner feedback, 17 October 2026: pages v2; the reference's post header, with a product cover
 * in place of a photograph): the post's structured data (exactly as PageHero: `pageJsonLd(path, jsonLd)`, so the
 * BlogPosting is unchanged), the breadcrumb pill, the H1 in two tones, the dek (the registry description unless `lead`),
 * the meta line ("Guide, updated 17 October 2026") and the cover: a coded product picture on a tray, beside the text
 * from 1024px and under the dek below that. `after` sits under the header's grid (a StatBand of the post's figures).
 *
 *   <ArticleHeader path="/blog/end-of-day-report" cover={<EndOfDayReportMock />} />
 */
export function ArticleHeader({ path, lead, cover, bareCover = false, after, jsonLd, className }: {
  path: MarketingPath;
  lead?: React.ReactNode;
  /** A mock that brings its own card (EndOfDayReportMock, StandupCardMock, SampleReport). */
  cover?: React.ReactNode;
  /** The cover has its own stage: not put on a tray. */
  bareCover?: boolean;
  after?: React.ReactNode;
  jsonLd?: readonly JsonLdNode[];
  className?: string;
}) {
  const page = getPage(path);
  return (
    <header className={cn(WRAP, "pb-6 pt-10 sm:pt-14 lg:pt-16", className)}>
      <JsonLd data={pageJsonLd(path, jsonLd)} />
      <div className={cn(cover && "grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-14")}>
        <div className="min-w-0 max-w-3xl">
          <Breadcrumbs path={path} variant="pill" className="mb-6 sm:mb-8" />
          <TwoToneTitle text={page.h1} className={HERO_TITLE.split} />
          <div className="mk-links mt-5 text-[17px] leading-[26px] text-secondary text-pretty sm:text-lg sm:leading-7 [&>*+*]:mt-3">{lead ?? <p>{page.description}</p>}</div>
          <p className="mt-6 text-meta font-normal text-secondary">
            {KIND_LABEL[page.kind]}, updated <time dateTime={page.updated}>{formatDate(page.updated)}</time>
          </p>
        </div>
        {cover ? <div className="min-w-0">{bareCover ? cover : <VisualStage>{cover}</VisualStage>}</div> : null}
      </div>
      {after ? <div className="mt-10 sm:mt-12">{after}</div> : null}
    </header>
  );
}
