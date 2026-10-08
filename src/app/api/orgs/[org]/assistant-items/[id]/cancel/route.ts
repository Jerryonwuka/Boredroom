import { route, orgContext, idempotent } from "@/server/lib/api";
import { cancelItem } from "@/server/services/assistant-items";

/**
 * Cancel a request the person sent (owner decision, 8 October 2026: personal assistants, phase 6), while it is still
 * open: the recipient's notification closes and says so. Anyone else (the recipient included) 404; already answered 409
 * ITEM_CLOSED; 503 before migration 0043.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.cancel", { id: params.id }, async () => ({ status: 200, body: { item: await cancelItem(ctx, params.id) } }));
});
