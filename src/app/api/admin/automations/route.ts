import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { saveAutomation, automationSchema } from "@/server/admin/marketing";

export const POST = adminRoute("marketing.create", async (req, { admin }) => {
  const body = await parseBody(req, automationSchema.extend({ id: z.string().uuid().nullable().optional() }));
  return ok(await saveAutomation(admin, body.id ?? null, body), 201);
});
