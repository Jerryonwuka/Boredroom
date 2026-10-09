import { route, orgContext, ok } from "@/server/lib/api";
import { openerSeen } from "@/server/services/routines";
import { morningOpener, openerOn } from "@/server/services/opener";
import type { Opener } from "@/lib/opener";

/**
 * The morning opener (owner decision, 8 October 2026: phase 7a): `Opener`, the counts waiting on the person (requests,
 * overdue tasks, answers to their follow-ups, items from other assistants, reviews for leads) and 3 to 6 one-tap
 * actions, built from existing data with no model. `firstVisit`: whether the person has not seen it today (in their own
 * zone), counted since they last did; `null` before migration 0046 (the page keeps the mark per browser then).
 *
 * Phase 7c (owner decisions, 8–9 October 2026: the abilities catalogue): `null` when the morning opener is switched off
 * for the person (by the workspace or by them); actions whose ability is off are left out.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!(await openerOn(ctx))) return ok(null);
  const seen = await openerSeen(ctx);
  const o = await morningOpener(ctx, { since: seen.seenAt, firstVisit: seen.ready ? !seen.seenToday : null, timeZone: seen.timeZone });
  // The lists behind the counts stay on the server (the morning brief routine uses them).
  return ok(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "detail")) as Opener);
});
