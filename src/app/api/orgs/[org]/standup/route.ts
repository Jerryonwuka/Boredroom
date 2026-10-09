import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { standupToday } from "@/server/services/standup";

const querySchema = z.object({ days: z.coerce.number().int().min(1).max(7).optional() });

/**
 * The person's standup (owner decisions, 8–9 October 2026: phase 7c): `StandupToday`, their drafts for today in every
 * team that runs one (in any state) and the rollups they receive from the last `days` days (1 to 7; today by default).
 * `{ ready: false, off: false, entries: [], rollups: [] }` before migration 0050.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await standupToday(ctx, { days: q.days }));
});
