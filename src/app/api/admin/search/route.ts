import { adminRoute, ok } from "@/server/admin/auth";
import { globalSearch } from "@/server/admin/ops";

export const GET = adminRoute("dashboard.view", async (req) => ok(await globalSearch(new URL(req.url).searchParams.get("q") ?? "")));
