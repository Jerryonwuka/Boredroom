import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { publishPolicy, policySchema } from "@/server/services/orgs";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  const body = await parseBody(req, policySchema);
  return ok(await publishPolicy(ctx, body), 201);
});
