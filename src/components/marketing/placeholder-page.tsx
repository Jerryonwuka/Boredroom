import { ArticleBody } from "@/components/marketing/article";
import { PageHero } from "@/components/marketing/page-hero";
import { PrimaryCta } from "@/components/marketing/primary-cta";
import { RelatedLinks, type RelatedLink } from "@/components/marketing/related-links";
import { getPage, type MarketingPath } from "@/lib/marketing/registry";

/**
 * A page that is registered but not written yet (owner request, 17 October 2026: SEO analysis: every route resolves from
 * the first release; the writing groups replace these). Honest and complete as far as it goes: the hero from the
 * registry with the call to action, the page's one-line summary, and the links it must carry (the build spec's link plan).
 */
export function PlaceholderPage({ path, links = [] }: { path: MarketingPath; links?: readonly RelatedLink[] }) {
  const page = getPage(path);
  return (
    <>
      <PageHero path={path}><PrimaryCta /></PageHero>
      <ArticleBody><p>{page.summary}</p></ArticleBody>
      <RelatedLinks links={links} />
    </>
  );
}
