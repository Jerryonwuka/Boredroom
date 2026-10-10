import { z } from "zod";
import { route, parseBody, orgContext, idempotent, ok } from "@/server/lib/api";
import { addCallLines, callTranscript } from "@/server/services/call-notes";

// Shape only here; the service checks the limits (1–10 lines, seq, at, 1–1000 characters after trimming).
const bodySchema = z.object({ lines: z.array(z.object({ seq: z.number(), at: z.number(), text: z.string() })).min(1).max(10) });

/**
 * Lines a consenting person's own device wrote down from their own microphone (owner decisions, 8 October 2026: phase 8):
 * `{ lines: { seq, at, text }[] }` (16 KiB at most; text only, never audio). `{ accepted, refused }`. 403 NO_CONSENT,
 * 409 NOTES_OFF / NOT_IN_CALL / TOO_MANY_LINES, 422, 429, 403 while someone else is signed in as the person, 503 before
 * migration 0054. The text is never logged.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 16_384 });
  return idempotent(req, ctx.user, "calls.lines", { id: params.id, lines: body.lines }, async () => ({ status: 200, body: await addCallLines(ctx, params.id, body.lines) }));
});

/**
 * The call's transcript (owner decisions, 8 October 2026: phase 8): `{ lines, deleteAfter, deleted }` for the people who
 * were on the call only; anyone else (owners, HR and team leads included) 404; 403 while someone else is signed in as
 * the person; 503 before migration 0054.
 */
export const GET = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await callTranscript(ctx, params.id));
});
