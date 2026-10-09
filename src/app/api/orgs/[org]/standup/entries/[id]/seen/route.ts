import { route, orgContext, ok } from "@/server/lib/api";
import { markStandupSeen } from "@/server/services/standup";

/** The person opened their standup card (owner decisions, 8–9 October 2026: phase 7c): `{ ok: true }`; 404 not theirs. */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => ok(await markStandupSeen(await orgContext(params.org), params.id)));
