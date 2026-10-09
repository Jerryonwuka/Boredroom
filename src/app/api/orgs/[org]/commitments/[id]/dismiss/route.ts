import { route, orgContext, idempotent } from "@/server/lib/api";
import { dismissCommitment } from "@/server/services/commitments";

/**
 * "Not a commitment" (owner decisions, 8 October 2026: phase 7b): closed, the message's label says so, and the person who
 * asked is not told. `{ commitment }`. Anyone else 404, already answered 409 ITEM_CLOSED, past its time 409
 * ITEM_EXPIRED, 403 while someone else is signed in as the person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "commitments.dismiss", { id: params.id }, async () => ({ status: 200, body: { commitment: await dismissCommitment(ctx, params.id) } }));
});
