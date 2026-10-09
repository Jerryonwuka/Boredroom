import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listCommitments } from "@/server/services/commitments";
import { LOOP_LIMITS } from "@/lib/commitments";

const querySchema = z.object({
  scope: z.enum(["mine", "team", "all"]).default("mine"),
  person: z.string().trim().max(160).optional(),
  status: z.enum(["waiting", "open", "overdue", "done", "declined", "dismissed", "all"]).default("all"),
  week: z.enum(["0", "1"]).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(LOOP_LIMITS.listMax).default(25),
});

/**
 * Commitments (owner decisions, 8 October 2026: phase 7b): `scope=mine` (the default: what the person owes or asked,
 * every status), `team` (team leads: the accepted ones of the people on their teams) or `all` (the owner and HR:
 * everyone's accepted ones); `person` (a membership id or an exact name), `status`, `week=1` (due this week), paged by
 * `before`. 403 for a scope the person may not read. Not gated by the plan. Before migration 0048:
 * `{ ready: false, items: [], … }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await listCommitments(ctx, { scope: q.scope, person: q.person ?? null, status: q.status, thisWeek: q.week === "1", before: q.before ?? null, limit: q.limit }));
});
