import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { followUpsReady, getFollowUpBatch } from "@/server/services/follow-ups";

/**
 * One ask and its follow-ups (owner decision, 8 October 2026: personal assistants, phase 4): the requester's own, or the
 * workspace's collection for someone who may read some of it. The chat's live status card polls this and refetches it on
 * realtime changes. Anyone else: 404. Before migration 0039: `{ ready: false, batch: null }`.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!(await followUpsReady(ctx))) return ok({ ready: false, batch: null });
  const batch = await getFollowUpBatch(ctx, params.id);
  if (!batch) throw notFound("Follow-up not found.");
  return ok({ batch });
});
