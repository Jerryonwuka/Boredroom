import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { listFollowUpsAboutMe, listMyFollowUps } from "@/server/services/follow-ups";

const querySchema = z.object({
  view: z.enum(["mine", "about-me"]).default("mine"),
  status: z.enum(["open", "done", "all"]).default("all"),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  batch: z.string().uuid().optional(),
});

/**
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4). `?view=mine` (the
 * default): what the person asked other people's assistants, a batch at a time (`status=open|done|all`, `batch=<id>`);
 * `?view=about-me`: what was asked about them, with what waits for their reply. Newest first, paged by `before`.
 * Not gated by the plan: a record of what was shared stays readable. Before migration 0039: `ready: false`, empty.
 * There is no route that creates a follow-up: only the assistant's Confirm does.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, querySchema);
  if (q.view === "about-me") return ok(await listFollowUpsAboutMe(ctx, { before: q.before ?? null, limit: q.limit }));
  return ok(await listMyFollowUps(ctx, { status: q.status, before: q.before ?? null, limit: q.limit, batchId: q.batch ?? null }));
});
