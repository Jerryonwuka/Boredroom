import { z } from "zod";
import { adminRoute, ok, requireReason } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { suspendOrganisation, unsuspendOrganisation, archiveOrganisation, changePlan, changePlanSchema, extendTrial, setFeatureOverrides, featureOverridesSchema } from "@/server/admin/organisations";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend"), reason: z.string() }),
  z.object({ action: z.literal("unsuspend"), reason: z.string() }),
  z.object({ action: z.literal("archive"), reason: z.string() }),
  changePlanSchema.extend({ action: z.literal("change_plan") }),
  z.object({ action: z.literal("extend_trial"), days: z.number().int(), reason: z.string() }),
  z.object({ action: z.literal("features"), overrides: featureOverridesSchema, reason: z.string().optional() }),
]);

/** Moderation and billing actions on one organisation. Every one is audited; most need a reason. */
export const POST = adminRoute<{ id: string }>("organization.view", async (req, { params, admin }) => {
  const body = await parseBody(req, schema);
  const need = (p: Parameters<typeof admin.permissions.has>[0]) => { if (!admin.permissions.has(p)) throw forbidden(`Your role does not include ${p}.`); };
  switch (body.action) {
    case "suspend": need("organization.suspend"); await suspendOrganisation(admin, params.id, requireReason(body.reason)); break;
    case "unsuspend": need("organization.suspend"); await unsuspendOrganisation(admin, params.id, requireReason(body.reason)); break;
    case "archive": need("organization.delete"); await archiveOrganisation(admin, params.id, requireReason(body.reason)); break;
    case "change_plan": need("subscription.edit"); await changePlan(admin, params.id, body); break;
    case "extend_trial": need("subscription.edit"); await extendTrial(admin, params.id, body.days, requireReason(body.reason)); break;
    case "features": need("organization.edit"); await setFeatureOverrides(admin, params.id, body.overrides, body.reason ?? null); break;
  }
  return ok({ ok: true });
});
