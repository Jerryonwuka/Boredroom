import { route, orgContext, ok, requireRole } from "@/server/lib/api";
import { revokeRecordingAccess } from "@/server/services/orgs";

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  await revokeRecordingAccess(ctx, params.id);
  return ok({ ok: true });
});
