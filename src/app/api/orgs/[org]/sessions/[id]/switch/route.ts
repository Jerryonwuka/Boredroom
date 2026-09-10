import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { switchSession, switchSchema } from "@/server/services/sessions";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, switchSchema);
  return idempotent(req, ctx.user, `sessions.switch:${params.id}`, body, async () => ({ status: 200, body: await switchSession(ctx, params.id, body, requestId) }));
});
