import { route, orgContext, ok } from "@/server/lib/api";
import { withdrawMentionReply } from "@/server/services/mentions";

/**
 * Withdraw an assistant's reply (owner decision, 8 October 2026: personal assistants, phase 5): the person who tagged, or
 * someone who runs the conversation. The reply is removed for everyone; the line stays. Others who read the conversation
 * 403, anyone else 404, already withdrawn 409; 503 before migration 0041.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withdrawMentionReply(ctx, params.id));
});
