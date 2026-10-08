import { route, orgContext, ok } from "@/server/lib/api";
import { previewRoutine } from "@/server/services/routines";

/**
 * What a saved routine would send now, with nothing sent or recorded, and what Enable consents to (owner decision,
 * 8 October 2026: phase 7a): `{ output, consent: { hash, lines } }`. No body.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => ok(await previewRoutine(await orgContext(params.org), params.id)));
