import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { forbidden, invalid } from "@/server/lib/errors";
import { setSetting } from "@/server/admin/settings";

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  general: z.object({ platform_name: z.string().trim().min(1).max(60), support_email: z.string().trim().email().or(z.literal("")), currency: z.string().trim().toUpperCase().length(3) }),
  landing: z.object({ headline: z.string().trim().max(120), subheadline: z.string().trim().max(300), cta: z.string().trim().max(40) }),
  billing: z.object({ trial_days: z.number().int().min(0).max(365), grace_days: z.number().int().min(0).max(60) }),
  feature_flags: z.record(z.string().regex(/^[A-Z_]{3,40}$/), z.boolean()),
};

export const PUT = adminRoute<{ key: string }>("settings.edit", async (req, { params, admin }) => {
  const schema = SCHEMAS[params.key];
  if (!schema) throw invalid("Unknown setting.");
  if (params.key === "feature_flags" && !admin.permissions.has("flags.edit")) throw forbidden("Your role does not include flags.edit.");
  const body = await parseBody(req, z.object({ value: schema, reason: z.string().max(1000).optional() }));
  await setSetting(admin, params.key, body.value, body.reason ?? null);
  return ok({ ok: true });
});
