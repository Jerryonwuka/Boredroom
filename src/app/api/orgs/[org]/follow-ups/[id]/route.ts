import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { followUpsReady, getFollowUp } from "@/server/services/follow-ups";

/**
 * One follow-up, for the person who asked, the person it is about, or someone who may read the workspace's own
 * collection about that person (owner decision, 8 October 2026: personal assistants, phase 4). Anyone else: 404.
 * Before migration 0039: `{ ready: false, followUp: null }`.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!(await followUpsReady(ctx))) return ok({ ready: false, followUp: null });
  const followUp = await getFollowUp(ctx, params.id);
  if (!followUp) throw notFound("Follow-up not found.");
  return ok({ followUp });
});
