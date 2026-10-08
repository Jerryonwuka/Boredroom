import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { sendMessage, sendSchema } from "@/server/services/messaging";

/**
 * Posts a message into a conversation the caller can read. Row-level security decides who can.
 *
 * `mentions` (owner decision, 8 October 2026: personal assistants, phase 5): the composer's tokens beside the body, each
 * checked against the body and the conversation; the valid ones are stored and notify (a person) or start the sender's
 * own assistant (an assistant). Invalid ones are dropped, never refused. The answer adds `mentionId` (the assistant's
 * queue row, or null) and `mentioned` (who was mentioned).
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, sendSchema);
  return ok(await sendMessage(ctx, body));
});
