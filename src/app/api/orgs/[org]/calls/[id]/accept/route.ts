import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { acceptCall } from "@/server/services/calls";

const schema = z.object({ leaveOther: z.boolean().optional() });

/**
 * Accepts a ring without a token (owner decisions, 8 October 2026: phase 8, calls): the notch's Accept, which then opens
 * the call page in the person's browser, where Join connects (the device has 90 seconds to). `{ leaveOther?: true }`
 * leaves their other live call first. Answers `{ call }`. 404; 409 CALL_ENDED, CALL_FULL, IN_ANOTHER_CALL `{ details: {
 * callId, where } }`; 403 while someone else is signed in as the person; 503 NOT_READY before migration 0054 and
 * CALLS_NOT_CONFIGURED without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, schema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.accept", { id: params.id, ...body }, async () => ({ status: 200, body: await acceptCall(ctx, params.id, { leaveOther: body.leaveOther === true }) }));
});
