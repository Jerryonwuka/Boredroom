import { route, orgContext, idempotent } from "@/server/lib/api";
import { notMeBlock } from "@/server/services/task-blocks";

/**
 * "Not me" (owner decisions, 8 October 2026: phase 7b): the person waited on says it isn't theirs; the blocked person is
 * told. `{ block }`. Anyone else 404, already answered 409 ITEM_CLOSED, 403 while someone else is signed in as the
 * person, 503 before migration 0048.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "task_blocks.not_me", { id: params.id }, async () => ({ status: 200, body: { block: await notMeBlock(ctx, params.id) } }));
});
