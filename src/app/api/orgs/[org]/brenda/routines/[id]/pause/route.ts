import { route, orgContext, ok } from "@/server/lib/api";
import { pauseRoutine } from "@/server/services/routines";

/** Pauses a routine (owner decision, 8 October 2026: phase 7a): `RoutineView` with `pausedReason 'person'`. No body. */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => ok(await pauseRoutine(await orgContext(params.org), params.id)));
