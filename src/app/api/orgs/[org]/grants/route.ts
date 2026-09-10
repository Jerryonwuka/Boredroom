import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { grantRecordingAccess } from "@/server/services/orgs";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  const body = await parseBody(req, z.object({ granteeMembershipId: z.string().uuid(), scopeType: z.enum(["organisation", "team", "privacy_admin"]), scopeId: z.string().uuid().nullable().optional() }));
  return ok(await grantRecordingAccess(ctx, body), 201);
});
