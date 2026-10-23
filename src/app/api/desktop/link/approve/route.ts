import { route, parseBody, ok } from "@/server/lib/api";
import { requireUser } from "@/server/auth";
import { approveLink, approveSchema } from "@/server/services/desktop";
import { wakeTag } from "@/server/lib/wake-tag";

/** The signed-in person approves a code for one of their workspaces. */
export const POST = route(async (req) => {
  wakeTag("link"); // owner request, 23 October 2026: realtime plan, phase 0
  const user = await requireUser();
  return ok(await approveLink(user, await parseBody(req, approveSchema)));
});
