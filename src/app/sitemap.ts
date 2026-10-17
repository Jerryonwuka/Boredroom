import type { MetadataRoute } from "next";
import { PAGES } from "@/lib/marketing/registry";
import { absoluteUrl } from "@/lib/marketing/site";

/**
 * /sitemap.xml (owner request, 17 October 2026: SEO analysis, A5): every public page in the registry
 * (lib/marketing/registry.ts), so a page is listed the moment it is registered. URLs on the canonical www host; lastmod is
 * the page's own `updated` date, not the build time, so search engines see real changes only.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: absoluteUrl(p.path),
    lastModified: p.updated,
    changeFrequency: p.kind === "home" || p.kind === "hub" ? "weekly" : "monthly",
    priority: p.kind === "home" ? 1 : p.kind === "pricing" ? 0.9 : p.kind === "hub" ? 0.8 : 0.7,
  }));
}
