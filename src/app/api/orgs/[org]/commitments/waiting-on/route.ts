import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { waitingOnList } from "@/server/services/task-blocks";

const querySchema = z.object({ scope: z.enum(["mine", "team", "all"]).default("mine") });

/**
 * Who is waiting on whom (owner decisions, 8 October 2026: phase 7b; the Commitments page's "Waiting on" tab): open
 * blocks, oldest first, with a count per person waited on. `scope=mine` (the default), `team` (team leads), `all` (the
 * owner and HR); 403 for a scope the person may not read. Before migration 0048: `{ ready: false, items: [], byPerson: [] }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await waitingOnList(ctx, { scope: q.scope }));
});
