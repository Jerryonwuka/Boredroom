import { z } from "zod";
import { route, orgContext, parseBody, ok, uuid } from "@/server/lib/api";
import { disconnect, requireConnectors, updateConnection } from "@/server/connectors/connections";

const patchSchema = z.object({
  canRead: z.boolean().optional(),
  canAct: z.boolean().optional(),
  settings: z.record(z.string().max(40), z.union([z.boolean(), z.string().max(200), z.number()])).optional(),
});

/**
 * One connection (spec §4.3): its person changes their own; owners and HR change the workspace's. Someone else's personal
 * connection is 404. PATCH `{ canRead?, canAct?, settings? }` → the view, or `{ needsConsent: true }` when acting needs
 * scopes the app hasn't granted yet (the client then starts with purpose "upgrade").
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const id = uuid.parse(params.id);
  const body = await parseBody(req, patchSchema, { maxBytes: 4096 });
  return ok(await updateConnection(ctx, id, body));
});

/** Disconnect (spec §5.6): Boredroom deletes what it copied and revokes at the app where it can. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  return ok(await disconnect(ctx, uuid.parse(params.id)));
});
