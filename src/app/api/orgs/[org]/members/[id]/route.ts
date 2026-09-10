import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { changeRole, revokeMembership, ROLES } from "@/server/services/orgs";

export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const { role } = await parseBody(req, z.object({ role: z.enum(ROLES) }));
  await changeRole(ctx, params.id, role);
  return ok({ ok: true });
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  await revokeMembership(ctx, params.id);
  return ok({ ok: true });
});
