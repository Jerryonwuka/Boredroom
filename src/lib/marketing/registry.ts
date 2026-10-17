import type { MarketingPage } from "@/lib/marketing/types";
import { HOME_PAGES } from "@/lib/marketing/pages/home";
import { PRODUCT_PAGES } from "@/lib/marketing/pages/product";
import { COMPARE_PAGES } from "@/lib/marketing/pages/compare";
import { TOOLS_PAGES } from "@/lib/marketing/pages/tools";
import { BLOG_PAGES } from "@/lib/marketing/pages/blog";

/**
 * The registry of public marketing pages (owner request, 17 October 2026: SEO analysis). One list, kept in one file per
 * owner (lib/marketing/pages/*.ts) so the people writing the pages never edit the same file, merged here. Everything
 * public is derived from it: app/sitemap.ts, pageMetadata(), the breadcrumbs and JSON-LD (PageHero), the hub pages'
 * lists (HubPage), the related links, the Open Graph images (app/og) and tests/unit/marketing-registry.test.ts.
 *
 * `MarketingPath` is the union of the registered paths, so a link to a page that does not exist is a type error.
 */
const ALL = [...HOME_PAGES, ...PRODUCT_PAGES, ...COMPARE_PAGES, ...TOOLS_PAGES, ...BLOG_PAGES] as const;

export type MarketingPath = (typeof ALL)[number]["path"];
export type RegistryPage = MarketingPage & { readonly path: MarketingPath };

/** Every public page, in the registry's order (the hub pages list their children in this order). */
export const PAGES: readonly RegistryPage[] = ALL;

const BY_PATH = new Map<string, RegistryPage>(PAGES.map((p) => [p.path, p]));

export function isMarketingPath(path: string): path is MarketingPath {
  return BY_PATH.has(path);
}

/** The page registered at `path` (throws for an unknown path: a page renders only what the registry knows). */
export function getPage(path: MarketingPath): RegistryPage {
  const page = BY_PATH.get(path);
  if (!page) throw new Error(`No marketing page is registered at ${path}`);
  return page;
}

/** The pages whose breadcrumb parent is `path`, in registry order (a hub's own pages; "/" gives the hubs and /pricing). */
export function childrenOf(path: MarketingPath): RegistryPage[] {
  return PAGES.filter((p) => p.parent === path);
}

/** The breadcrumb trail from the home page down to `path`, both included. */
export function trailOf(path: MarketingPath): RegistryPage[] {
  const trail: RegistryPage[] = [];
  let at: RegistryPage | undefined = getPage(path);
  while (at) {
    trail.unshift(at);
    at = at.parent ? BY_PATH.get(at.parent) : undefined;
  }
  return trail;
}

/** The pages a hub lists under its own (its `related` cross-links), resolved; unknown paths are dropped (the tests catch them). */
export function relatedOf(path: MarketingPath): RegistryPage[] {
  return (getPage(path).related ?? []).flatMap((p) => BY_PATH.get(p) ?? []);
}
