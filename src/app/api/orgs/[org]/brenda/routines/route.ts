import { route, parseBody, orgContext, ok, idempotent } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, createRoutine, listRoutines, routineInputSchema } from "@/server/services/routines";

/**
 * The person's routines (owner decision, 8 October 2026: phase 7a, routines): `{ ready, routines, limits, chase }`, the
 * routines they keep (oldest first), the most they may keep, and which teams a chase may cover for them. Always the
 * caller's own. Before migration 0046: `{ ready: false, routines: [] }`. Not plan-gated.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await listRoutines(await orgContext(params.org))));

/**
 * A new routine (`routineInputSchema`), saved paused (`pausedReason 'new'`): the person previews it and enables it.
 * 201 `RoutineView`; 409 ROUTINE_LIMIT past 20; 403 for a chase without lead rights (and while someone else is signed
 * in as the person); 402 while the assistant is off for the workspace; 422 for a team that is gone; 503 NOT_READY
 * before 0046. Idempotent with the client's Idempotency-Key (it retries a POST whose answer was lost), so a retry does
 * not save a second routine (review, 8 October 2026).
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, routineInputSchema, { maxBytes: ROUTINE_BODY_MAX });
  return idempotent(req, ctx.user, `routines.create:${ctx.org.id}`, body, async () => ({ status: 201, body: await createRoutine(ctx, body) }));
});
