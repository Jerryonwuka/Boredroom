import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { savePlan, planSchema, listPlans } from "@/server/admin/billing";

export const GET = adminRoute("plan.view", async () => ok(await listPlans()));
export const POST = adminRoute("plan.create", async (req, { admin }) => {
  const body = await parseBody(req, planSchema.extend({ id: z.string().uuid().nullable().optional() }));
  return ok(await savePlan(admin, body.id ?? null, body), body.id ? 200 : 201);
});
