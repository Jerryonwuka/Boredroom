import { z } from "zod";
import { adminRoute, ok, requireReason } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { setUserStatus, forceLogout, forcePasswordReset, changeMembershipRole, roleChangeSchema } from "@/server/admin/users";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string() }),
  z.object({ action: z.literal("reinstate"), reason: z.string() }),
  z.object({ action: z.literal("ban"), reason: z.string() }),
  z.object({ action: z.literal("delete"), reason: z.string() }),
  z.object({ action: z.literal("force_logout"), reason: z.string() }),
  z.object({ action: z.literal("force_password_reset"), reason: z.string() }),
  roleChangeSchema.extend({ action: z.literal("change_role") }),
]);

export const POST = adminRoute<{ id: string }>("user.view", async (req, { params, admin }) => {
  const body = await parseBody(req, schema);
  const need = (p: Parameters<typeof admin.permissions.has>[0]) => { if (!admin.permissions.has(p)) throw forbidden(`Your role does not include ${p}.`); };
  switch (body.action) {
    case "suspend": need("user.suspend"); await setUserStatus(admin, params.id, "suspended", requireReason(body.reason)); break;
    case "reinstate": need("user.suspend"); await setUserStatus(admin, params.id, "active", requireReason(body.reason)); break;
    case "ban": need("user.suspend"); await setUserStatus(admin, params.id, "banned", requireReason(body.reason)); break;
    case "delete": need("user.delete"); await setUserStatus(admin, params.id, "deleted", requireReason(body.reason)); break;
    case "force_logout": need("support.act"); await forceLogout(admin, params.id, requireReason(body.reason)); break;
    case "force_password_reset": need("support.act"); await forcePasswordReset(admin, params.id, requireReason(body.reason)); break;
    case "change_role": need("user.edit"); await changeMembershipRole(admin, params.id, body); break;
  }
  return ok({ ok: true });
});
