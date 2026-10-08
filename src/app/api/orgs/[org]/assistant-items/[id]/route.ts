import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { assistantItemsReady, getAssistantItem } from "@/server/services/assistant-items";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";

/**
 * One item between assistants (owner decision, 8 October 2026: personal assistants, phase 6), for its sender, its
 * recipient, or (a note for the team report) someone who may read its author's records. Anyone else: 404. Reading it
 * never marks it seen (the item page and the notch say so with `/seen`). Before migration 0043: `{ ready: false, item: null }`.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!(await assistantItemsReady(ctx))) return ok({ ready: false, item: null });
  const item = await getAssistantItem(ctx, params.id);
  if (!item) throw notFound(ASSISTANT_ITEM_WORDS.steps.notHere);
  return ok({ item });
});
