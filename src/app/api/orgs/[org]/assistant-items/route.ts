import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listAssistantItems } from "@/server/services/assistant-items";
import { ASSISTANT_ITEM_KINDS, ASSISTANT_ITEM_LIMITS } from "@/lib/assistant-items";

const querySchema = z.object({
  box: z.enum(["waiting", "sent", "received"]).default("waiting"),
  kind: z.enum(ASSISTANT_ITEM_KINDS).optional(),
  status: z.enum(["open", "done", "all"]).default("all"),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(ASSISTANT_ITEM_LIMITS.listMax).default(20),
});

/**
 * Between assistants (owner decision, 8 October 2026: personal assistants, phase 6): a box of the person's assistant
 * inbox. `box=waiting` (the default: open requests, unseen messages and replies brought to them; requests first, oldest
 * first), `sent` (what their assistant sent, newest first) or `received` (what others' assistants brought them, newest
 * first); `kind`, `status=open|done|all`, paged by `before`. Not gated by the plan: a record of what passed between
 * assistants stays readable. Before migration 0043: `{ ready: false, items: [], nextBefore: null }`. There is no route
 * that creates an item: only the assistant's Confirm does.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await listAssistantItems(ctx, { box: q.box, kind: q.kind ?? null, status: q.status, before: q.before ?? null, limit: q.limit }));
});
