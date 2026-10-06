import { route, orgContext, ok, idempotent, requireFeature } from "@/server/lib/api";
import { listConversations, createConversation, createConversationSchema, parseConversationBody, CREATE_ROUTE } from "@/server/services/brenda-history";

/**
 * The person's past chats with Brenda, private to them. GET lists them, the most recently active first; POST keeps a
 * new one (201). Reading and deleting stay open when the plan no longer includes Brenda, so a person can always see
 * and remove what was kept about them; only saving needs her.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok({ conversations: await listConversations(await orgContext(params.org)) }));

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseConversationBody(req, createConversationSchema);
  return idempotent(req, ctx.user, CREATE_ROUTE, body, async () => ({ status: 201, body: await createConversation(ctx, body) }));
});
