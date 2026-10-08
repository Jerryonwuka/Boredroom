import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, routineSettingsFor, routineSettingsSchema, saveRoutineSettings } from "@/server/services/routines";

/**
 * "Only leads can schedule routines that chase other people" (owner decision, 8 October 2026: phase 7a): `{ ready,
 * chaseLeadsOnly }`, on by default. Members may read it; before migration 0046 it reads `{ ready: false, chaseLeadsOnly: true }`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await routineSettingsFor(await orgContext(params.org))));

/**
 * Owners and HR: `{ chaseLeadsOnly: boolean }` → `{ ready: true, chaseLeadsOnly }`, under the organisation's Brenda
 * settings lock, logged in Brenda's log. 503 NOT_READY before 0046. Routines that lose their rights pause at their next run.
 */
export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, routineSettingsSchema, { maxBytes: ROUTINE_BODY_MAX });
  return ok(await saveRoutineSettings(ctx, body));
});
