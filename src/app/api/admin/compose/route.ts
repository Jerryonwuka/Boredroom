import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { composeAndSend, composeSchema } from "@/server/admin/marketing";

export const POST = adminRoute("communications.send", async (req, { admin }) => ok(await composeAndSend(admin, await parseBody(req, composeSchema)), 201));
