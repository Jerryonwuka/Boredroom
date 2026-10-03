import { route, parseBody, ok } from "@/server/lib/api";
import { requireUser } from "@/server/auth";
import { approveLink, approveSchema } from "@/server/services/desktop";

/** The signed-in person approves a code for one of their workspaces. */
export const POST = route(async (req) => {
  const user = await requireUser();
  return ok(await approveLink(user, await parseBody(req, approveSchema)));
});
