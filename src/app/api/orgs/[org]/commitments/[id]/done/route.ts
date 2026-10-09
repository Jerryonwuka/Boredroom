import { route, orgContext, idempotent } from "@/server/lib/api";
import { markCommitmentDone } from "@/server/services/commitments";

/**
 * "Mark done" (owner decisions, 8 October 2026: phase 7b): the committer, on an open commitment (with or without its
 * to-do); done already reads as it is. `{ commitment }`. Anyone else 404, not open 409 ITEM_CLOSED, 403 while someone
 * else is signed in as the person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "commitments.done", { id: params.id }, async () => ({ status: 200, body: { commitment: await markCommitmentDone(ctx, params.id) } }));
});
