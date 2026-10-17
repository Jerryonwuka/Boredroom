import { MotionRoot } from "@/components/ui/motion";
import { SiteNav } from "@/components/landing/site-nav";
import { SiteFooter } from "@/components/landing/footer";
import { ClosingCta } from "@/components/landing/closing-cta";
import { ArrivalObserver } from "@/components/landing/arrival";
import { getLaunchState } from "@/components/marketing/launch";

/**
 * The frame of every public page other than the home page (owner request, 17 October 2026: SEO analysis, Sections B and
 * D): the landing's notch nav (the seven section links and the launch-aware call to action), `main#main` (the skip
 * link's target), the page, then the site's closing call to action (in waitlist mode it carries the waitlist form, so the
 * nav's "Join the waitlist" always has somewhere to go; an entry records the page it came from), and the footer with the
 * site's links. The landing's canvas and type (`.lp`), and its arrivals for any `.lp-reveal` block.
 *
 * Pages under this group: export `metadata = pageMetadata(path)` and render the hero first (it is the page's H1,
 * breadcrumbs and JSON-LD): `ProductHero` on product, comparison, tool and index pages, `ArticleHeader` on posts (pages
 * v2, owner feedback 17 October 2026; `PageHero` still works and draws the same). Pages add one mid-page `CtaBand`; the
 * close below stays the site-wide one. See docs/design-system.md, "Public pages v2", for the parts.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { signedIn, waitlist, maintenance, copy } = await getLaunchState();
  return (
    <MotionRoot>
      <div className="lp min-h-dvh overflow-x-clip bg-background text-foreground">
        <SiteNav signedIn={signedIn} waitlist={waitlist} maintenance={maintenance} />
        <main id="main">
          {children}
          <div className="mt-12 sm:mt-16">
            <ClosingCta waitlist={waitlist} maintenance={maintenance} signedIn={signedIn} copy={copy} sourceFromPath />
          </div>
        </main>
        <SiteFooter waitlist={waitlist} />
        <ArrivalObserver />
      </div>
    </MotionRoot>
  );
}
