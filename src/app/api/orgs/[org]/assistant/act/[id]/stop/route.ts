import { route, orgContext, ok } from "@/server/lib/api";
import { ACT_SMALL_BODY, readActBody, stopSchema, stopTask } from "@/server/services/act";

/**
 * Stop, always (owner permission rule, 12 October 2026; contract 0.7, D.7.5): ends a live task at once, whatever the
 * plan, the switches or the limit say; every later step answers 409 ACT_ENDED. Idempotent. A plan (phase 3) stops at
 * any step; its steps, lines and what the Mac found go with the person's words.
 *
 * Brenda and her helpers (contract G.7): a background job too, paused or running; its request row says it stopped, and its
 * Undo record stays on the Mac.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await readActBody(req, stopSchema, ACT_SMALL_BODY);
  return ok(await stopTask(ctx, params.id, body));
});
