import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { sendMessage, sendSchema } from "@/server/services/messaging";

/** Posts a message into a conversation the caller can read. Row-level security decides who can. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, sendSchema);
  return ok(await sendMessage(ctx, body));
});
