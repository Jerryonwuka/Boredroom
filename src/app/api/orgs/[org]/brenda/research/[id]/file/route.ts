import { z } from "zod";
import { route, orgContext, parseQuery } from "@/server/lib/api";
import { researchFile } from "@/server/research/service";
import { RESEARCH_FORMATS } from "@/lib/research";

const schema = z.object({ format: z.enum(RESEARCH_FORMATS).default("pdf") });

/**
 * One finished research report as a file, for its owner only (owner decision, 28 October 2026: "give me a PDF when
 * you're done"): `?format=pdf` (the default), `docx` or `md`. Anyone else, an unfinished report or a database without
 * 0066 gets 404. Never cached; downloaded under the report's title.
 */
export const GET = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { format } = parseQuery(req, schema);
  const f = await researchFile(ctx, params.id, format);
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Buffer.from(f.bytes), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
