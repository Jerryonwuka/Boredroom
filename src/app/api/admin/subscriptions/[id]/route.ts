import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { editSubscription, subscriptionEditSchema } from "@/server/admin/billing";

export const PATCH = adminRoute<{ id: string }>("subscription.edit", async (req, { params, admin }) => {
  await editSubscription(admin, params.id, await parseBody(req, subscriptionEditSchema));
  return ok({ ok: true });
});
