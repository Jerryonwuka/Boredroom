import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { createAdmin, adminCreateSchema } from "@/server/admin/ops";

export const POST = adminRoute("admin.create", async (req, { admin }) => ok(await createAdmin(admin, await parseBody(req, adminCreateSchema)), 201));
