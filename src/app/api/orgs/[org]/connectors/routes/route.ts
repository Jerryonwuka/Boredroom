import { z } from "zod";
import { route, orgContext, parseBody, ok } from "@/server/lib/api";
import { requireConnectors, setRoute } from "@/server/connectors/connections";

const schema = z.object({ purpose: z.enum(["daily_digest", "standup", "reminders"]), teamId: z.string().uuid().nullable(), sourceId: z.string().uuid().nullable() });

/**
 * Where Boredroom posts (owners and HR; spec §10.1): `{ purpose, teamId, sourceId }` (a null source removes it). A new or
 * changed channel is saved off: it posts only once someone turns it on after seeing its preview.
 */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  return ok(await setRoute(ctx, await parseBody(req, schema, { maxBytes: 512 })));
});
