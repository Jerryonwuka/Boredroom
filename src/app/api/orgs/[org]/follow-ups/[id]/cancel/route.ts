import { route, orgContext, ok } from "@/server/lib/api";
import { cancelFollowUp } from "@/server/services/follow-ups";

/**
 * The person who asked cancels a follow-up while it is still open (owner decision, 8 October 2026: personal assistants,
 * phase 4): nothing more is asked or shared. Anyone else 404; already closed 409.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok({ followUp: await cancelFollowUp(ctx, params.id) });
});
