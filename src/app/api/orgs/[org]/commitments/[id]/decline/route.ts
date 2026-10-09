import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { declineCommitment } from "@/server/services/commitments";

const bodySchema = z.object({ reason: z.string().max(2000).nullable().optional() });

/**
 * Decline a commitment or an open ask (owner decisions, 8 October 2026: phase 7b): `{ reason?: string | null }` (at most
 * 280 characters); for an ask the person who asked is told privately, with the reason. `{ commitment }`. Anyone else
 * 404, already answered 409 ITEM_CLOSED, past its time 409 ITEM_EXPIRED, a long reason 422, 403 while someone else is
 * signed in as the person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "commitments.decline", { id: params.id, reason: body.reason ?? null }, async () => ({ status: 200, body: { commitment: await declineCommitment(ctx, params.id, body.reason ?? null) } }));
});
