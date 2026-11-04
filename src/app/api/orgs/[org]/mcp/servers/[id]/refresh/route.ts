import { route, orgContext, ok, uuid } from "@/server/lib/api";
import { refreshServer } from "@/server/connectors/mcp/servers";

/** Asks the server for its tools again; a tool it changed shows "Changed" and stays off until approved. Owners and HR. */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await refreshServer(ctx, uuid.parse(params.id)));
});
