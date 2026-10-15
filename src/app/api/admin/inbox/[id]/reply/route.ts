import { adminRoute, ok } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { replyInbound, replySchema } from "@/server/admin/inbox";

export const POST = adminRoute<{ id: string }>("communications.send", async (req, { params, admin }) => {
  const body = await parseBody(req, replySchema);
  return ok(await replyInbound(admin, params.id, body));
});
