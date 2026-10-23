import { z } from "zod";
import { route, orgContext, idempotent, parseBody } from "@/server/lib/api";
import { postStandup } from "@/server/services/standup";

// Connected apps (security fix, 22 October 2026): `alsoTo` is the connected-app channel the card showed and the person
// left ticked; their standup goes there too only then (and only while it is still that channel).
const Body = z.object({ alsoTo: z.string().trim().min(1).max(200).nullish() });

/**
 * Post the person's standup to their team's channel (owner decisions, 8–9 October 2026: phase 7c). This press IS their
 * consent (a broadcast to a team: nothing posts on its own, ever): their approved words, as theirs, sent by their
 * assistant. `{ entry, message: { id, conversationId, href }, already? }`; a second press (or a retry without an
 * Idempotency-Key) gets the first post back with `already: true`, never a second message. 403 while someone else is
 * signed in as them; 404 not theirs; 409 STANDUP_CLOSED, STANDUP_NOT_IN_TEAM, STANDUP_OFF, CONVERSATION_ARCHIVED; 503
 * before migration 0050.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, Body);
  return idempotent(req, ctx.user, "standup.post", { id: params.id, alsoTo: body.alsoTo ?? null }, async () => ({ status: 200, body: await postStandup(ctx, params.id, { alsoTo: body.alsoTo ?? null }) }));
});
