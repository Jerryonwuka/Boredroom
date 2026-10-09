import { route, orgContext, idempotent } from "@/server/lib/api";
import { skipStandup } from "@/server/services/standup";

/**
 * Skip today (owner decisions, 8–9 October 2026: phase 7c): the rollup lists the person under No update, like anyone who
 * did not post. `StandupEntryView` (also when already skipped). 403 while someone else is signed in as them; 404 not
 * theirs; 409 STANDUP_CLOSED once posted or past; 503 before migration 0050.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return idempotent(req, ctx.user, "standup.skip", { id: params.id }, async () => ({ status: 200, body: await skipStandup(ctx, params.id) }));
});
