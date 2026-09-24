import { z } from "zod";
import { adminRoute, ok, requireReason } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { markRefunded } from "@/server/admin/billing";

export const POST = adminRoute<{ id: string }>("payment.refund", async (req, { params, admin }) => {
  const body = await parseBody(req, z.object({ action: z.literal("refund"), reason: z.string() }));
  await markRefunded(admin, params.id, requireReason(body.reason));
  return ok({ ok: true });
});
