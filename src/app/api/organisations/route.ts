import { route, parseBody, ok, requireAuth } from "@/server/lib/api";
import { createOrganisation, createOrgSchema, listMyWorkspaces } from "@/server/services/orgs";
import { forbidden } from "@/server/lib/errors";

export const GET = route(async () => {
  const user = await requireAuth();
  return ok({ workspaces: await listMyWorkspaces(user.profileId) });
});

export const POST = route(async (req) => {
  const user = await requireAuth();
  if (!user.emailVerified) throw forbidden("Verify your email before creating a workspace.");
  const body = await parseBody(req, createOrgSchema);
  const result = await createOrganisation(user.profileId, body);
  return ok(result, 201);
});
