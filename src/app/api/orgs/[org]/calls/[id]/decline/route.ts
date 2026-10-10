import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { declineCall } from "@/server/services/calls";
import { CALL_LIMITS } from "@/lib/calls";

const schema = z.object({ message: z.string().max(CALL_LIMITS.declineMessageMax * 2).nullable().optional() });

/**
 * Declines the person's own ring (owner decisions, 8 October 2026: phase 8, calls). `{ message? }`: the person's OWN
 * message (D7), sent in the call's direct thread, or for a group call as a direct message to the caller; at most 280
 * characters once trimmed (422). Answers `{ call, messageId }`. 404; 409 CALL_ENDED, ALREADY_ANSWERED; 403 while someone
 * else is signed in as the person; 503 NOT_READY before migration 0054 and CALLS_NOT_CONFIGURED without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, schema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.decline", { id: params.id, ...body }, async () => ({ status: 200, body: await declineCall(ctx, params.id, body.message ?? null) }));
});
