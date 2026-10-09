import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { looseEndRemind, looseEndRemindSchema } from "@/server/services/loose-ends";

/**
 * "Remind me" (owner decisions, 8 October 2026: phase 7b): `{ at, text? }` → `{ looseEnd }` with a reminder for the
 * person. A time in the past 422; not theirs 404; already acted on 409 ITEM_CLOSED; 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, looseEndRemindSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "loose_ends.remind", { id: params.id, ...body }, async () => ({ status: 200, body: { looseEnd: await looseEndRemind(ctx, params.id, body) } }));
});
