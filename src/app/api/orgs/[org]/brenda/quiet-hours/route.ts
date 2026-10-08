import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, quietHoursFor, quietHoursSchema, saveQuietHours } from "@/server/services/routines";

/**
 * The person's quiet hours and time zone (owner decision, 8 October 2026: phase 7a): `QuietHours & { ready, state }`,
 * with whether they are quiet now. Before migration 0046: `{ ready: false, enabled: false, … }` (never quiet).
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await quietHoursFor(await orgContext(params.org))));

/**
 * `{ enabled, start?, end?, days?, timezone? }` (times "HH:MM" in the person's zone; days 0 = Sunday … 6 = Saturday, the
 * days a quiet window starts on, all seven when left out; timezone null: the workspace's, left out: unchanged). 400
 * "Pick a time zone from the list." for an unknown zone; 403 while someone else is signed in as the person; 503
 * NOT_READY before 0046. Held routine deliveries are looked at again at the next sweep.
 */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, quietHoursSchema, { maxBytes: ROUTINE_BODY_MAX });
  return ok(await saveQuietHours(ctx, body));
});
