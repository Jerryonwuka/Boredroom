import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { callsAvailability, liveCalls } from "@/server/services/calls";
import { CALL_WORDS } from "@/lib/calls";

const liveQuery = z.object({ conversation: z.uuid().optional() });

/**
 * Live calls in conversations the person reads (owner decisions, 8 October 2026: phase 8, calls): `{ live:
 * LiveCallSummary[] }`, at most one per conversation; `conversation` narrows it to one thread (its header's "Join (n)").
 * 503 NOT_READY before migration 0054 (contract B.3; the pages read `liveCalls` directly and get none).
 */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const q = parseQuery(req, liveQuery);
  if (!(await callsAvailability()).ready) throw new AppError(503, "NOT_READY", CALL_WORDS.notReady);
  return ok({ live: await liveCalls(ctx, { conversationId: q.conversation }) });
});
