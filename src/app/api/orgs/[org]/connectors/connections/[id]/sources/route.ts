import { z } from "zod";
import { route, orgContext, parseBody, ok, uuid } from "@/server/lib/api";
import { listSources, requireConnectors, setSources } from "@/server/connectors/connections";

/** The connection's sources; `?refresh=1` reads them again from the app (at most once a minute). */
export const GET = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  return ok(await listSources(ctx, uuid.parse(params.id), { refresh }));
});

const schema = z.object({ selected: z.array(z.object({ id: z.string().uuid(), audienceTeamId: z.string().uuid().nullable().optional() })).max(200) });

/**
 * Which sources Boredroom reads, and who sees each one's items (a team, or everyone). Items take the new audience at once;
 * an unselected source's items are deleted; a sync is queued.
 */
export const PUT = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const body = await parseBody(req, schema, { maxBytes: 32_000 });
  return ok(await setSources(ctx, uuid.parse(params.id), body.selected));
});
