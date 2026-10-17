import type { Metadata } from "next";
import { getPage, type MarketingPath, type RegistryPage } from "@/lib/marketing/registry";
import { OG_IMAGE_SIZE, SITE_NAME, absoluteUrl, ogImagePath } from "@/lib/marketing/site";

/** The words on a page's Open Graph image, for its alt text. */
export function ogImageAlt(page: RegistryPage): string {
  return `${SITE_NAME}: ${page.h1}`;
}

/**
 * A public page's metadata from the registry (owner request, 17 October 2026: SEO analysis, Section A): its own title
 * (as is, no template), the description, a self-referencing absolute canonical on the www host, and the full Open Graph
 * and Twitter sets with the page's 1200×630 image (app/og). Every field is set here because metadata merges shallowly:
 * a page that sets `openGraph` replaces the root layout's whole object, image included.
 *
 *   export const metadata = pageMetadata("/blog/end-of-day-report");
 *
 * Every URL is absolute already. On the home page `metadataBase` is cleared for that reason: resolved against a base,
 * Next.js writes the site's root as its bare origin (https://www.boredroom.cc), and the analysis asks for the canonical
 * and og:url exactly as https://www.boredroom.cc/ (the same address; the slash keeps the checks literal).
 */
export function pageMetadata(path: MarketingPath): Metadata {
  const page = getPage(path);
  const url = absoluteUrl(path);
  const image = { url: absoluteUrl(ogImagePath(path)), ...OG_IMAGE_SIZE, alt: ogImageAlt(page), type: "image/png" };
  const article = page.kind === "post";
  return {
    ...(path === "/" ? { metadataBase: null } : {}),
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.title,
      description: page.description,
      url,
      siteName: SITE_NAME,
      locale: "en_GB",
      images: [image],
      ...(article
        ? { type: "article" as const, publishedTime: page.published ?? page.updated, modifiedTime: page.updated, authors: [SITE_NAME] }
        : { type: "website" as const }),
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}
