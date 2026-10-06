import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { listDocs, createDoc, createDocSchema } from "@/server/services/docs";

/**
 * The documents library. GET lists what the caller can read (?q= searches titles and text, ?folder= narrows to one
 * folder; either left out or empty means everything) with the folder list. POST writes a new document (201).
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const sp = new URL(req.url).searchParams;
  return ok(await listDocs(ctx, { q: sp.get("q") ?? undefined, folder: sp.get("folder") || undefined }));
});

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, createDocSchema);
  return idempotent(req, ctx.user, "docs.create", body, async () => ({ status: 201, body: await createDoc(ctx, body, requestId) }));
});
