import { route, orgContext, idempotent } from "@/server/lib/api";
import { endCall } from "@/server/services/calls";

/**
 * Ends the call for everyone (owner decisions, 8 October 2026: phase 8, calls): either person of a one-to-one call, or a
 * group call's starter, while in it. Answers `{ call }` (also when it already ended). 403 FORBIDDEN for anyone else (and
 * while someone else is signed in as the person); 404; 503 NOT_READY before migration 0054 and CALLS_NOT_CONFIGURED
 * without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "calls.end", { id: params.id }, async () => ({ status: 200, body: await endCall(ctx, params.id) }));
});
