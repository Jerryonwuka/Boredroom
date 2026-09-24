import { z } from "zod";
import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { setContactStatus } from "@/server/admin/marketing";

export const PATCH = adminRoute<{ id: string }>("waitlist.edit", async (req, { params, admin }) => {
  const body = await parseBody(req, z.object({ status: z.enum(["waiting", "invited", "registered", "activated", "trial", "paid", "unsubscribed"]), reason: z.string().max(1000).optional() }));
  await setContactStatus(admin, params.id, body.status, body.reason ?? null);
  return ok({ ok: true });
});
