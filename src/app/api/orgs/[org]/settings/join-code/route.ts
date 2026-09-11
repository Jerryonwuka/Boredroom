import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { updateJoinCode, joinCodeSchema, joinCodeView } from "@/server/services/orgs";

export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await joinCodeView(ctx));
});

export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, joinCodeSchema);
  return ok(await updateJoinCode(ctx, body));
});
