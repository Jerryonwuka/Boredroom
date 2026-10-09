import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { looseEndFollowUpLater, looseEndFollowUpSchema } from "@/server/services/loose-ends";

/**
 * "Follow up later" (owner decisions, 8 October 2026: phase 7b): `{ at }` (at least 5 minutes ahead, at most 60 days):
 * on that time the person's assistant asks the other person's assistant about it. `{ looseEnd }`. A time out of range or
 * nobody to ask 422; not theirs 404; already acted on 409 ITEM_CLOSED; 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, looseEndFollowUpSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "loose_ends.follow_up", { id: params.id, ...body }, async () => ({ status: 200, body: { looseEnd: await looseEndFollowUpLater(ctx, params.id, body) } }));
});
