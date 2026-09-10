import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { updateOrganisation, orgSettingsSchema } from "@/server/services/orgs";

export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, orgSettingsSchema);
  await updateOrganisation(ctx, body);
  return ok({ ok: true });
});
