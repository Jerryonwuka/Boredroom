import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { setTeamMember } from "@/server/services/orgs";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, z.object({ membershipId: z.string().uuid(), isManager: z.boolean().default(false), remove: z.boolean().default(false) }));
  await setTeamMember(ctx, params.id, body.membershipId, { isManager: body.isManager, remove: body.remove });
  return ok({ ok: true });
});
