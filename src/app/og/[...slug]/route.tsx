import { PAGES } from "@/lib/marketing/registry";
import { ogImageResponse } from "../render";

/**
 * /og/<page path>: each registered page's Open Graph and Twitter image (owner request, 17 October 2026: SEO analysis,
 * A8), e.g. /og/blog/end-of-day-report. One per page in the registry, generated at build time; any other path is a 404.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return PAGES.filter((p) => p.path !== "/").map((p) => ({ slug: p.path.slice(1).split("/") }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return ogImageResponse(`/${slug.join("/")}`);
}
