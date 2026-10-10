import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { joinCall } from "@/server/services/calls";

const schema = z.object({ leaveOther: z.boolean().optional() });

/**
 * Joins a live call (owner decisions, 8 October 2026: phase 8, calls): the person's ring, a call they declined or missed,
 * or a group call in a conversation they read. `{ leaveOther?: true }` leaves their other live call first. Answers
 * `{ call, connection }` (their LiveKit token, 10 minutes). 404; 409 CALL_ENDED, CALL_FULL (50 people), IN_ANOTHER_CALL
 * `{ details: { callId, where } }`; 403 while someone else is signed in as the person; 503 NOT_READY before migration
 * 0054 and CALLS_NOT_CONFIGURED without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, schema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.join", { id: params.id, ...body }, async () => ({ status: 200, body: await joinCall(ctx, params.id, { leaveOther: body.leaveOther === true }) }));
});
