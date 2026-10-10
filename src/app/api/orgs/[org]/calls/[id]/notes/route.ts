import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { setCallNotes } from "@/server/services/call-notes";

const bodySchema = z.object({ on: z.boolean() });

/**
 * "Brenda takes notes" on or off (owner decisions, 8 October 2026: phase 8, Brenda's notes on calls): `{ on: boolean }`
 * by anyone in the call; switching on includes them. `{ call }`. 403 NOTES_NOT_AVAILABLE (plan, AI connection, the
 * workspace's switch), 404 for anyone without a row on the call, 409 CALL_ENDED / NOT_IN_CALL, 403 while someone else is
 * signed in as the person, 429, 503 before migration 0054 or without LiveKit.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.notes", { id: params.id, on: body.on }, async () => ({ status: 200, body: await setCallNotes(ctx, params.id, body.on) }));
});
