import { route, orgContext, idempotent } from "@/server/lib/api";
import { dismissLooseEnd } from "@/server/services/loose-ends";

/**
 * "Not a commitment" (owner decisions, 8 October 2026: phase 7b): closed, and the message is never suggested again.
 * `{ looseEnd }`. Not theirs 404; already acted on 409 ITEM_CLOSED; 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "loose_ends.dismiss", { id: params.id }, async () => ({ status: 200, body: { looseEnd: await dismissLooseEnd(ctx, params.id) } }));
});
