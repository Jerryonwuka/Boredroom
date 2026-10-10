import { z } from "zod";
import { route, parseBody, parseQuery, orgContext, ok, idempotent } from "@/server/lib/api";
import { callHistory, startCall } from "@/server/services/calls";
import { CALL_LIMITS } from "@/lib/calls";

const historyQuery = z.object({
  filter: z.enum(["all", "missed"]).default("all"),
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * The person's calls, newest first (owner decisions, 8 October 2026: phase 8, calls): `CallHistoryList` (who, when, how
 * long, joined or missed, from their side). `filter=missed` lists the calls they were rung for and never joined, and
 * marks their missed-call notifications read. `before` pages (the last item's `startedAt`); `limit` 1 to 50 (30). Before
 * migration 0054: `{ ready: false, items: [], nextBefore: null }`.
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, historyQuery);
  return ok(await callHistory(ctx, { filter: q.filter, before: q.before ?? null, limit: q.limit ?? CALL_LIMITS.historyPageSize }));
});

const startSchema = z.object({ conversationId: z.uuid().optional(), to: z.uuid().optional() })
  .refine((b) => !!b.conversationId !== !!b.to, { message: "Send exactly one of conversationId and to." });

/**
 * Starts a call (phase 8): `{ conversationId }` (a direct thread, a team channel or a named channel the person reads) or
 * `{ to }` (a person: their direct thread, opened on first use). 201 `{ call, existing: false, connection }` (the
 * person's LiveKit token); 200 `{ call, existing: true, connection: null }` when a call is already live there (join it
 * instead). 409 IN_ANOTHER_CALL `{ details: { callId, where } }`, 409 CALL_NOT_HERE (Everyone, an archived channel), 404,
 * 429 (30 an hour, 10 an hour in one conversation), 403 while someone else is signed in as the person, 503 NOT_READY
 * before migration 0054 and CALLS_NOT_CONFIGURED without LiveKit.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, startSchema, { maxBytes: 8192 });
  return idempotent(req, ctx.user, "calls.start", body, async () => {
    const r = await startCall(ctx, body);
    return { status: r.existing ? 200 : 201, body: r };
  });
});
