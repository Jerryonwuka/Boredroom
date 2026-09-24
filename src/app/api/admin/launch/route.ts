import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { setLaunchMode, launchSchema } from "@/server/admin/launch";

/** Switches WAITLIST, LIVE and MAINTENANCE. Needs launch.edit, a reason, and the browser's confirmation. */
export const POST = adminRoute("launch.edit", async (req, { admin }) => ok(await setLaunchMode(admin, await parseBody(req, launchSchema))));
