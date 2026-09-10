import { route, orgContext, ok } from "@/server/lib/api";
import { heartbeat } from "@/server/services/sessions";

export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await heartbeat(ctx, params.id));
});
