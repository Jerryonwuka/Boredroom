import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { activityQuerySchema, listActivity } from "@/server/services/assistant-activity";

/**
 * What the person's own assistant did or read for them, newest first, a page at a time (owner decision, 8 October 2026:
 * personal assistants, phase 3). `?kind=all|actions|reads|problems&cursor=<opaque>&limit=30`. Always the caller's own,
 * whatever their role. Not gated by the plan: a record of what happened stays readable, as past chats are.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, activityQuerySchema);
  return ok(await listActivity(ctx, { kind: q.kind, cursor: q.cursor ?? null, limit: q.limit }));
});
