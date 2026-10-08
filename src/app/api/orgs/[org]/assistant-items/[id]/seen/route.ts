import { route, orgContext, idempotent } from "@/server/lib/api";
import { markItemSeen } from "@/server/services/assistant-items";

/**
 * "Mark as seen" (owner decision, 8 October 2026: personal assistants, phase 6): the recipient of a message, a reply or
 * a request, on the web or the notch (bearer token). Already seen or answered: 200 as it is. Anyone else 404; refused
 * (403) while someone else is signed in as the person; 503 before migration 0043.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.seen", { id: params.id }, async () => ({ status: 200, body: { item: await markItemSeen(ctx, params.id) } }));
});
