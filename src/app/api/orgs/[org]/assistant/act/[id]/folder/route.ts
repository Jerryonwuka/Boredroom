import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_LIMITS } from "@/lib/act";
import { readActBody } from "@/server/services/act";
import { folderFile, folderFileSchema } from "@/server/services/act-plan";

/**
 * One file of a folder job the person asked for and said yes to (Brenda for Mac, phase 3; owner request, 12 October 2026:
 * "look through my documents and summarise them"; contract C.2, D.5.2). Rust alone calls it, with the text Brenda for Mac
 * read from one file it counted before asking (a small PDF or a picture as itself), never one already read. The answer
 * is that file's section (or notes); nothing from the file is kept or logged.
 */
export const maxDuration = 180;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, folderFileSchema, ACT_LIMITS.folderFileBody);
  return ok(await folderFile(ctx, params.id, body));
});
