import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { looseEndHandOver, looseEndHandOverSchema } from "@/server/services/loose-ends";
import { getAssistantItem } from "@/server/services/assistant-items";

/**
 * "Hand it to {person}'s assistant" (owner decisions, 8 October 2026: phase 7b): `{ to, title, dueAt?, note? }` sends an
 * ordinary request (`add_todo`) the other person accepts first. `{ looseEnd, item }`. Refusals in the request's own
 * words (muted 403, limits 409, not a member or no to-dos 422); not theirs 404; already acted on 409 ITEM_CLOSED; 503
 * before migration 0048 (or 0043).
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, looseEndHandOverSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "loose_ends.hand_over", { id: params.id, ...body }, async () => {
    const looseEnd = await looseEndHandOver(ctx, params.id, body);
    const item = looseEnd.result?.itemId ? await getAssistantItem(ctx, looseEnd.result.itemId) : null;
    return { status: 200, body: { looseEnd, item } };
  });
});
