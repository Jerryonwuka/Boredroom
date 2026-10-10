import { route, orgContext, idempotent } from "@/server/lib/api";
import { leaveCall } from "@/server/services/calls";

/**
 * Leaves the call (owner decisions, 8 October 2026: phase 8, calls): a one-to-one call then ends (D5); the person's device
 * is taken out of the LiveKit room at once. Answers `{ call }` (also when already out). 404; 403 while someone else is
 * signed in as the person; 503 NOT_READY before migration 0054 and CALLS_NOT_CONFIGURED without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "calls.leave", { id: params.id }, async () => ({ status: 200, body: await leaveCall(ctx, params.id) }));
});
