import { route, orgContext, uuid, idempotent } from "@/server/lib/api";
import { requireConnectors, setRouteEnabled } from "@/server/connectors/connections";

/**
 * Turns a channel route off. Owners and HR;
 * audited with ids only.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  await requireConnectors(ctx);
  const id = uuid.parse(params.id);
  return idempotent(req, ctx.user, "connectors.route.disable", { id }, async () => ({ status: 200, body: await setRouteEnabled(ctx, id, false) }));
});
