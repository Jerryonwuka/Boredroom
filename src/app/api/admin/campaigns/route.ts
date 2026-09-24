import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { saveCampaign, campaignSchema } from "@/server/admin/marketing";

export const POST = adminRoute("marketing.create", async (req, { admin }) => {
  const body = await parseBody(req, campaignSchema.extend({ id: z.string().uuid().nullable().optional() }));
  return ok(await saveCampaign(admin, body.id ?? null, body), 201);
});
