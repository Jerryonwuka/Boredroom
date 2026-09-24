import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { chat, chatSchema } from "@/server/services/copilot";

/**
 * The workspace assistant. Stateless: the browser sends the conversation so far. The reply may carry proposals
 * (to-dos, clock in or out, start a timer, open a page); each is confirmed by the person through the normal endpoint.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, chatSchema);
  return ok(await chat(ctx, body));
});
