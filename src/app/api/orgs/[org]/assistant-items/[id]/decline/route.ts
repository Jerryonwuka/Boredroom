import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { declineItem } from "@/server/services/assistant-items";

const bodySchema = z.object({ reason: z.string().max(2000).nullable().optional() });

/**
 * Decline a request (owner decision, 8 October 2026: personal assistants, phase 6): `{ reason?: string | null }` (at
 * most 280 characters, shown to the sender as written). Nothing changes on the recipient's account. Anyone else 404,
 * already answered 409 ITEM_CLOSED, past its time 409 ITEM_EXPIRED, a long reason 422, 403 while someone else is signed
 * in as the person, 503 before migration 0043.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 4096 });
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.decline", { id: params.id, reason: body.reason ?? null }, async () => ({ status: 200, body: { item: await declineItem(ctx, params.id, body.reason ?? null) } }));
});
