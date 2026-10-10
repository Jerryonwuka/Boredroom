import { route, orgContext, ok } from "@/server/lib/api";
import { getCallRecap } from "@/server/services/call-recap";

/**
 * A call's notes (owner decisions, 8 October 2026: phase 8): `{ state, recap }`: the state for anyone who can see the
 * call, the recap (summary, decisions, action items) only for the people who were on it. 404 for a call the person
 * cannot see; 503 before migration 0054.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await getCallRecap(ctx, params.id));
});
