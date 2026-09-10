import { route, orgContext, ok } from "@/server/lib/api";
import { receiveChunk, RECORDING_LIMITS } from "@/server/services/recording";
import { invalid } from "@/server/lib/errors";

export const PUT = route<{ org: string; id: string; chunk: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const token = req.headers.get("x-upload-token") ?? "";
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > RECORDING_LIMITS.maxChunkBytes) throw invalid("Chunk too large.");
  const bytes = Buffer.from(await req.arrayBuffer());
  return ok(await receiveChunk(ctx, params.id, params.chunk, token, bytes));
});
