import { z } from "zod";
import { route, orgContext, parseBody, idempotent, uuid } from "@/server/lib/api";
import { requireConnectors } from "@/server/connectors/connections";
import { trackItem } from "@/server/connectors/items";

const schema = z.object({ taskId: z.string().uuid().optional(), newTodo: z.object({ title: z.string().trim().max(200).optional() }).optional(), startTimer: z.boolean().optional() })
  .refine((b) => !!b.taskId !== !!b.newTodo, { message: "Choose a to-do, or make a new one." });

/**
 * Track an item as a to-do (staff and team leads; spec §11.5): link it to one of their own open to-dos, or make a new one
 * (their team lead sees it like any to-do), and optionally start its timer. `{ taskId, linked: true, session? }`.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const id = uuid.parse(params.id);
  const body = await parseBody(req, schema, { maxBytes: 1024 });
  return idempotent(req, ctx.user, "connectors.track", { id, ...body }, async () => {
    const r = await trackItem(ctx, id, body);
    return { status: 200, body: { taskId: r.taskId, linked: true, ...(r.session ? { session: r.session } : {}) } };
  });
});
