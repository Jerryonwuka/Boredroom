import { route, orgContext, ok } from "@/server/lib/api";
import { getStandupRollup } from "@/server/services/standup";

/**
 * One team's standup rollup the person receives (owner decisions, 8–9 October 2026: phase 7c): `StandupRollupView`
 * (who posted, the blockers they named, who has no update, posted late); 404 for anyone who does not receive it.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => ok(await getStandupRollup(await orgContext(params.org), params.id)));
