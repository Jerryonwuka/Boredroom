import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { ACT_LIMITS } from "@/lib/act";
import { readActBody } from "@/server/services/act";
import { folderFinish, folderFinishSchema } from "@/server/services/act-plan";

/**
 * The end of a folder job (Brenda for Mac, phase 3; owner request, 12 October 2026; contract C.2, K.6). Rust alone calls
 * it with the sections it kept: they become one new file for the Mac to save in that folder (never over anything), or a
 * private Boredroom document. Nothing from the files is kept or logged.
 */
export const maxDuration = 300;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await readActBody(req, folderFinishSchema, ACT_LIMITS.folderFinishBody);
  return ok(await folderFinish(ctx, params.id, body));
});
