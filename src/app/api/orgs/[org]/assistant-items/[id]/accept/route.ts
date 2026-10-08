import { route, orgContext, idempotent } from "@/server/lib/api";
import { acceptItem } from "@/server/services/assistant-items";

/**
 * Accept a request (owner decision, 8 October 2026: personal assistants, phase 6: the recipient always approves). The
 * recipient alone, while it is open: their own assistant then does exactly the request's validated payload, as them,
 * through the same services their buttons use. 200 with `{ item }` even when it could not be done (its status is failed
 * and `result` says why); anyone else 404, already answered 409 ITEM_CLOSED, past its time 409 ITEM_EXPIRED, 403 while
 * someone else is signed in as the person, 503 before migration 0043.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.accept", { id: params.id }, async () => ({ status: 200, body: { item: await acceptItem(ctx, params.id) } }));
});
