/**
 * The public site's constants (owner request, 17 October 2026: SEO analysis). The canonical host is www: the apex
 * (boredroom.cc) answers with a permanent redirect to it, so every canonical, sitemap entry, Open Graph URL and JSON-LD
 * id names www. `SITE_ORIGIN` in lib/site.ts stays the apex: join links name the real domain (owner decision,
 * 26 September 2026) and the redirect carries them over.
 */
export const SITE_URL = "https://www.boredroom.cc";
export const SITE_NAME = "Boredroom";

/**
 * The one sentence that defines Boredroom (the analysis, GEO §15.1: the same sentence, in the same order, everywhere: the
 * pages, the footer and the Organization schema). AI answers build their picture of a product from that repetition.
 */
export const ENTITY_SENTENCE = "Boredroom is remote team management software with a personal AI assistant named Brenda for every team member.";

/** The positioning line, in the words the analysis asks for (GEO §15): the line an AI answer lifts. */
export const POSITIONING_LINE = "No productivity score, no screen recording, no call recording.";

/**
 * The positioning line as three short points (owner feedback, 17 October 2026: pages v2): the check chips under a
 * product page's hero buttons and the /solutions hub's limits. The same three facts as POSITIONING_LINE, in its order.
 */
export const POSITIONING_POINTS = ["No productivity score", "No screen recording", "No call recording"] as const;

/** Open Graph images are 1200×630 (the size every network crops to). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The absolute URL of a site path: the home page keeps its trailing slash (https://www.boredroom.cc/), others have none. */
export function absoluteUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/** The path of a page's Open Graph image (`/og` for the home page and as the site default, `/og/blog/…` for a page). */
export function ogImagePath(path: string): string {
  return path === "/" ? "/og" : `/og${path}`;
}

/** An ISO date ("2026-10-17") as the site writes dates: "17 October 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
