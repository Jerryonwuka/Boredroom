import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { replyToItem } from "@/server/services/assistant-items";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";

const bodySchema = z.object({ body: z.string({ error: ASSISTANT_ITEM_WORDS.steps.replyEmpty }).max(2000) });

/**
 * One line back to the person who passed on a message (owner decision, 8 October 2026: personal assistants, phase 6):
 * `{ body }` (1 to 280 characters, one line). The recipient of the message alone, once: anyone else 404, a second reply
 * 409 ALREADY_REPLIED, too long 422, 403 while someone else is signed in as the person, 503 before migration 0043.
 * Answers `{ item }`: the message, with its reply.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 4096 });
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.reply", { id: params.id, body: body.body }, async () => ({ status: 200, body: { item: await replyToItem(ctx, params.id, body.body) } }));
});
