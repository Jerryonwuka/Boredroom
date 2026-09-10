import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { startSession, startSchema } from "@/server/services/sessions";

export const POST = route<{ org: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, startSchema);
  return idempotent(req, ctx.user, "sessions.start", body, async () => ({ status: 201, body: await startSession(ctx, body, requestId) }));
});
