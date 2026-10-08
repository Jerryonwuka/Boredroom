import { route, orgContext, ok } from "@/server/lib/api";
import { dismissMention } from "@/server/services/mentions";

/**
 * Dismiss (owner decision, 8 October 2026: personal assistants, phase 5): the person who tagged puts away their
 * assistant's private answer; any Confirm still open on it is declined. Anyone else 404; 503 before migration 0041.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await dismissMention(ctx, params.id));
});
