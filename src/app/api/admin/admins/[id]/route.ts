import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { updateAdmin } from "@/server/admin/ops";
import { ADMIN_ROLES } from "@/server/admin/permissions";

export const PATCH = adminRoute<{ id: string }>("admin.edit", async (req, { params, admin }) => {
  const body = await parseBody(req, z.object({ role: z.enum(ADMIN_ROLES).optional(), status: z.enum(["active", "disabled"]).optional(), revokeSessions: z.boolean().optional(), reason: z.string().max(1000).optional() }));
  await updateAdmin(admin, params.id, body);
  return ok({ ok: true });
});
