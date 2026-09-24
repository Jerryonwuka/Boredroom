import { adminRoute, ok } from "@/server/admin/auth";
import { deleteSegment } from "@/server/admin/marketing";

export const DELETE = adminRoute<{ id: string }>("marketing.create", async (_req, { params, admin }) => { await deleteSegment(admin, params.id); return ok({ ok: true }); });
