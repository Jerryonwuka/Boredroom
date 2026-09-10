import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { stopSession, stopSchema } from "@/server/services/sessions";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, stopSchema);
  return idempotent(req, ctx.user, `sessions.stop:${params.id}`, body, async () => ({ status: 200, body: await stopSession(ctx, params.id, body, requestId) }));
});
