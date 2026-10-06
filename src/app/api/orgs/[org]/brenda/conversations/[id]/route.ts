import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { getConversation, updateConversation, deleteConversation, updateConversationSchema, parseConversationBody } from "@/server/services/brenda-history";
import { notFound } from "@/server/lib/errors";

/**
 * One past chat: read it to carry on, replace its messages after a new exchange, or delete it for good. Anyone else's is
 * 404. A PUT carries `expectedUpdatedAt`, the updatedAt of the copy it was made from; when the chat has been saved from
 * somewhere else since, it is 409 VERSION_CONFLICT with the chat as it is now (`details.conversation`).
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const conversation = await getConversation(await orgContext(params.org), params.id);
  if (!conversation) throw notFound("Conversation not found.");
  return ok(conversation);
});

export const PUT = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  return ok(await updateConversation(ctx, params.id, await parseConversationBody(req, updateConversationSchema)));
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => ok(await deleteConversation(await orgContext(params.org), params.id)));
