import { templateDownload } from "@/components/marketing/blog/templates";

/**
 * /blog/end-of-day-report-template/end-of-day-report-template.md: the template as a Markdown file to download
 * (owner request, 17 October 2026: SEO analysis; Content Plan page 2: downloads that are ungated links). Made from the
 * same text the page shows (components/marketing/blog/templates.ts), built once at build time.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(templateDownload(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="end-of-day-report-template.md"',
    },
  });
}
