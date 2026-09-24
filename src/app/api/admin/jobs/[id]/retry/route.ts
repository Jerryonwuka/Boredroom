import { adminRoute, ok } from "@/server/admin/auth";
import { retryJob } from "@/server/admin/ops";

export const POST = adminRoute<{ id: string }>("system.configure", async (_req, { params, admin }) => { await retryJob(admin, params.id); return ok({ ok: true }); });
