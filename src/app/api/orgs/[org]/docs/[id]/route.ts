import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { getDoc, updateDoc, updateDocSchema, archiveDoc } from "@/server/services/docs";
import { notFound } from "@/server/lib/errors";

/** One document: read it (404 when it is not shared with the caller), change it (409 on a stale save), or archive it. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const doc = await getDoc(await orgContext(params.org), params.id);
  if (!doc) throw notFound("Document not found.");
  return ok(doc);
});

export const PATCH = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  return ok(await updateDoc(ctx, params.id, await parseBody(req, updateDocSchema), requestId));
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params, requestId }) => ok(await archiveDoc(await orgContext(params.org), params.id, requestId)));
