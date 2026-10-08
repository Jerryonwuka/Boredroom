import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ROUTINE_BODY_MAX, previewRoutine, routineInputSchema } from "@/server/services/routines";

/**
 * What a routine not saved yet would send now (`routineInputSchema`, a draft), with nothing sent or recorded, and the
 * lines Enable would consent to (owner decision, 8 October 2026: phase 7a): `{ output, consent: { hash, lines } }`.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, routineInputSchema, { maxBytes: ROUTINE_BODY_MAX });
  return ok(await previewRoutine(ctx, body));
});
