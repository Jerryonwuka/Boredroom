import { route, orgContext, idempotent } from "@/server/lib/api";
import { unskipStandup } from "@/server/services/standup";

/**
 * Undo a skip while the day's rollup is still open (owner decisions, 8–9 October 2026: phase 7c): `StandupEntryView`.
 * 409 STANDUP_TOO_LATE once the rollup has gone ("you can still write in #Design"); 409 STANDUP_CLOSED when it is not
 * skipped; 403 while someone else is signed in as them; 404 not theirs; 503 before migration 0050.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "standup.unskip", { id: params.id }, async () => ({ status: 200, body: await unskipStandup(ctx, params.id) }));
});
