import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listLooseEnds } from "@/server/services/loose-ends";

const querySchema = z.object({
  status: z.enum(["open", "acted", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

/**
 * The person's loose ends (owner decisions, 8 October 2026: phase 7b; theirs alone): `status=open` (the default), `acted`
 * or `all`; open first, newest first, each message's words read live. Not gated by the plan. Before migration 0048:
 * `{ ready: false, items: [], counts: { open: 0 }, lastScanAt: null }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  return ok(await listLooseEnds(ctx, { status: q.status, limit: q.limit }));
});
