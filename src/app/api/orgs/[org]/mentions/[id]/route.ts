import { route, orgContext, ok } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { getMention } from "@/server/services/mentions";

/**
 * One assistant mention (owner decision, 8 October 2026: personal assistants, phase 5): its status for everyone who
 * reads the conversation, and its private part (the answer, a note, the Confirm cards without their tokens) for the
 * person who tagged only. Anyone else 404; 503 before migration 0041.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  const mention = await getMention(ctx, params.id);
  if (!mention) throw notFound("That mention is not visible to you.");
  return ok({ mention });
});
