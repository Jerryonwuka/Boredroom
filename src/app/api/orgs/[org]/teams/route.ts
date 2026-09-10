import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { createTeam } from "@/server/services/orgs";

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(120) }));
  return ok(await createTeam(ctx, name), 201);
});
