import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { authoriseChunk, authoriseChunkSchema } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, authoriseChunkSchema);
  return ok(await authoriseChunk(ctx, params.id, body));
});
