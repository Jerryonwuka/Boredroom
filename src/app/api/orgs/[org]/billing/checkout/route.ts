import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { startCheckout } from "@/server/admin/billing";

/** An organisation owner picks a plan; the answer is Paystack's checkout page (or an immediate switch to a free plan). */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ planId: z.string().uuid(), interval: z.enum(["monthly", "annual"]).default("monthly") }));
  return ok(await startCheckout(ctx, body));
});
