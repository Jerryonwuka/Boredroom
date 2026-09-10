import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { resumeSession, versionSchema } from "@/server/services/sessions";

export const POST = route<{ org: string; id: string }>(async (req, { params, requestId }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, versionSchema);
  return idempotent(req, ctx.user, `sessions.resume:${params.id}`, body, async () => ({ status: 200, body: await resumeSession(ctx, params.id, body.expectedVersion, requestId) }));
});
