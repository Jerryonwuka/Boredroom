import { templateDownload } from "@/components/marketing/blog/templates";

/**
 * /blog/end-of-day-report-template/end-of-day-report-template.txt: the template as a plain-text file to download (owner
 * request, 17 October 2026: SEO analysis; Content Plan page 2), for Google Docs, Word or Notion. The same text as the
 * page and the Markdown file (components/marketing/blog/templates.ts), built once at build time.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(templateDownload(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="end-of-day-report-template.txt"',
    },
  });
}
