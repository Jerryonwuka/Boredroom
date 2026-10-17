import { ogImageResponse } from "./render";

/**
 * /og: the home page's Open Graph and Twitter image, and the site's default (owner request, 17 October 2026: SEO
 * analysis, A8). 1200×630 PNG, generated at build time (render.tsx).
 */
export const dynamic = "force-static";

export function GET() {
  return ogImageResponse("/");
}
