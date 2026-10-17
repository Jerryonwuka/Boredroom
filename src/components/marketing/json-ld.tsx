import { jsonLdString } from "@/lib/marketing/schema";

/**
 * Structured data in the page's HTML (owner request, 17 October 2026: SEO analysis): a plain `<script
 * type="application/ld+json">` (data, not code, so not next/script), rendered on the server, `<` escaped.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
