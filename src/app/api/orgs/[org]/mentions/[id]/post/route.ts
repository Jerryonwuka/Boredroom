import { route, orgContext, ok } from "@/server/lib/api";
import { postMention } from "@/server/services/mentions";

/**
 * Post to channel (owner decision, 8 October 2026: personal assistants, phase 5): the person who tagged publishes their
 * assistant's private answer, exactly as shown, as their own message sent through their assistant. Anyone else 404;
 * already posted or dismissed, or the conversation archived, 409; 503 before migration 0041.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await postMention(ctx, params.id));
});
