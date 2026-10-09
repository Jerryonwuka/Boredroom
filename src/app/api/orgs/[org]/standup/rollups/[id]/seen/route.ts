import { route, orgContext, ok } from "@/server/lib/api";
import { markRollupSeen } from "@/server/services/standup";

/** The lead opened their rollup (owner decisions, 8–9 October 2026: phase 7c): `{ ok: true }`; 404 when not a recipient. */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => ok(await markRollupSeen(await orgContext(params.org), params.id)));
