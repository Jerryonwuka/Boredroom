/**
 * The public site's page registry types (owner request, 17 October 2026: SEO analysis). One typed list of every public
 * marketing page (lib/marketing/registry.ts) drives the sitemap, each page's metadata (title, description, canonical,
 * Open Graph), the breadcrumbs and their BreadcrumbList, the page's JSON-LD, the hub pages' lists, the Open Graph images
 * and the tests that hold the analysis's rules (keyword in the title and the H1, a 120–160 character description).
 */

/** What a page is: decides its JSON-LD type (a post is a BlogPosting, a hub a CollectionPage, the rest WebPage). The
 *  download page (24 October 2026) is a product page, as /pricing is. */
export type PageKind = "home" | "hub" | "post" | "feature" | "solution" | "usecase" | "comparison" | "tool" | "pricing" | "download";

export type MarketingPage = {
  /** The URL path: "/" for the home page, otherwise no trailing slash ("/blog/end-of-day-report"). Fixed once published. */
  readonly path: string;
  readonly kind: PageKind;
  /** The breadcrumb parent: "/" for the hubs, /pricing and /download, the hub for a hub's pages; none for the home page. */
  readonly parent?: string;
  /** The short name: breadcrumbs, the nav, hub cards and related links ("End-of-day report guide"). */
  readonly label: string;
  /** The <title>, as is (no template): at most 60 characters, containing `keyword`. */
  readonly title: string;
  /** The meta description (and og/twitter description): 120 to 160 characters, British English. */
  readonly description: string;
  /** The page's one H1 (PageHero draws it), containing `keyword`. Sentence case. */
  readonly h1: string;
  /** The target keyword from the analysis (Section C). Hyphens and case are ignored when it is matched. */
  readonly keyword: string;
  /** One line for hub cards and related links. */
  readonly summary: string;
  /** ISO date ("2026-10-17") of the last change to the page's content: the sitemap's lastmod and the JSON-LD dateModified. */
  readonly updated: string;
  /** ISO date first published (datePublished); `updated` when absent. */
  readonly published?: string;
  /** Hubs only: pages elsewhere on the site listed under the hub's own pages (cross-links; see the build spec's link plan). */
  readonly related?: readonly string[];
};
