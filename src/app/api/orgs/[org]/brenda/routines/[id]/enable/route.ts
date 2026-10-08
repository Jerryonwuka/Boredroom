import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, enableRoutine, enableSchema } from "@/server/services/routines";

/**
 * The person's Enable press (owner decision, 8 October 2026: phase 7a): `{ consentHash }` from the preview they saw.
 * Turning a routine on is their standing consent for exactly the lines that preview showed. `RoutineView`; 409
 * CONSENT_CHANGED when the routine changed since its preview; 403 for a chase that lost its lead rights.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, enableSchema, { maxBytes: ROUTINE_BODY_MAX });
  return ok(await enableRoutine(ctx, params.id, body));
});
