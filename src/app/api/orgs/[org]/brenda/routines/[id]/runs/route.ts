import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listRuns } from "@/server/services/routines";

const querySchema = z.object({ before: z.string().datetime({ offset: true }).optional() });

/**
 * A routine's history (owner decision, 8 October 2026: phase 7a): `{ ready, runs, nextBefore }`, newest first, 20 a
 * page (`?before=` the last page's `nextBefore`), without outputs (the run page has them). Kept after the routine was
 * deleted. 404 when it is not the person's. Before migration 0046: `{ ready: false, runs: [] }`.
 */
export const GET = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await listRuns(ctx, { routineId: params.id, before: q.before ?? null }));
});
