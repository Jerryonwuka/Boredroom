import { z } from "zod";
import { route, parseBody, orgContext, idempotent } from "@/server/lib/api";
import { setCallNoteConsent } from "@/server/services/call-notes";

const bodySchema = z.object({ consent: z.enum(["yes", "no"]) });

/**
 * The person's own answer to notes on this call (owner decisions, 8 October 2026: phase 8): `{ consent: "yes" | "no" }`
 * ("Include me" or "Not me"; "no" deletes their lines on the call at once). `{ call }`. 404 for anyone who was never in
 * the call, 409 CALL_ENDED, 422, 403 while someone else is signed in as the person, 503 before migration 0054.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.consent", { id: params.id, consent: body.consent }, async () => ({ status: 200, body: await setCallNoteConsent(ctx, params.id, body.consent) }));
});
