import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { paymentsSchema, savePaymentsSettings, testPaystack, paystackStatus } from "@/server/admin/paystack-config";

/** GET the status, PUT the keys, POST { action: "test", mode? } to try a key against Paystack. */
export const GET = adminRoute("settings.view", async () => ok(await paystackStatus()));

export const PUT = adminRoute("settings.edit", async (req, { admin }) => {
  const body = await parseBody(req, z.object({ value: paymentsSchema, reason: z.string().max(1000).optional() }));
  return ok(await savePaymentsSettings(admin, body.value, body.reason ?? null));
});

export const POST = adminRoute("settings.edit", async (req) => {
  const body = await parseBody(req, z.object({ action: z.literal("test"), mode: z.enum(["test", "live"]).optional() }));
  return ok(await testPaystack(body.mode));
});
