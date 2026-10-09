import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { blockFor, cancelBlock, setBlock, setBlockSchema } from "@/server/services/task-blocks";

/**
 * Blocked on whom (owner decisions, 8 October 2026: phase 7b). GET: the task's open block, the newest answered or "not
 * me" one, and who it may wait on (`{ ready, block, last, people }`; `ready: false` before migration 0048, when the
 * editor hides "Waiting on"); 404 when the person cannot see the task.
 */
export const GET = route<{ org: string; task: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await blockFor(ctx, params.task));
});

/**
 * PUT `{ waitingOn, question }`: the person the task is assigned to names who it waits on (the task must be Blocked:
 * 409 NOT_BLOCKED; anyone else 403); an open block is replaced. `{ block }`. Themself or someone who is not an active
 * member 422; 503 before migration 0048.
 */
export const PUT = route<{ org: string; task: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, setBlockSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "task_blocks.set", { task: params.task, ...body }, async () => ({ status: 200, body: { block: await setBlock(ctx, params.task, body) } }));
});

/** DELETE: "Stop waiting": the person who named someone withdraws it. `{ cancelled }` (false when nothing was open). 503 before 0048. */
export const DELETE = route<{ org: string; task: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await cancelBlock(ctx, params.task));
});
