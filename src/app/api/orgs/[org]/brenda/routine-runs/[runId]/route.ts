import { route, orgContext, ok } from "@/server/lib/api";
import { getRun } from "@/server/services/routines";

/** One of the person's routine runs with its output (owner decision, 8 October 2026: phase 7a): `RoutineRunView`; 404 when it is not theirs. */
export const GET = route<{ org: string; runId: string }>(async (_req, { params }) => ok(await getRun(await orgContext(params.org), params.runId)));
