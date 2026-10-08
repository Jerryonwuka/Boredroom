import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listRuns } from "@/server/services/routines";

const querySchema = z.object({ before: z.string().datetime({ offset: true }).optional() });

/**
 * What the person's routines sent them, across routines (owner decision, 8 October 2026: phase 7a; the /home/routines
 * page): `{ ready, runs, nextBefore }`, newest first, 20 a page, without outputs. Before migration 0046: `{ ready: false, runs: [] }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await listRuns(ctx, { before: q.before ?? null }));
});
