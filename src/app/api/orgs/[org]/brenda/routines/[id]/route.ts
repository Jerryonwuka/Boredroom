import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, deleteRoutine, getRoutine, routinePatchSchema, updateRoutine } from "@/server/services/routines";

/** One of the person's routines (owner decision, 8 October 2026: phase 7a): `RoutineView`; 404 when it is not theirs. */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => ok(await getRoutine(await orgContext(params.org), params.id)));

/**
 * Changes a routine (`routinePatchSchema`: any of name, cadence, time, quietWhenEmpty, teamIds; never its template).
 * Changing a chase's teams turns it off until the person previews and enables it again; anything else keeps it as it
 * is. `RoutineView`.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, routinePatchSchema, { maxBytes: ROUTINE_BODY_MAX });
  return ok(await updateRoutine(ctx, params.id, body));
});

/** Deletes a routine (soft: it stops; its runs stay readable): `{ deleted: true }`. */
export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => ok(await deleteRoutine(await orgContext(params.org), params.id)));
