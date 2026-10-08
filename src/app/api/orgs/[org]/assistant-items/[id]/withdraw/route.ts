import { route, orgContext, idempotent } from "@/server/lib/api";
import { withdrawReportNote } from "@/server/services/assistant-items";

/**
 * Withdraw the person's note from today's team report (owner decision, 8 October 2026: personal assistants, phase 6),
 * before the report is written. Anyone else 404; after the report's time 409 TOO_LATE ("…the note stays in it."); 503
 * before migration 0043.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  // A retry after a lost response (same Idempotency-Key) gets the first answer, never a false "already answered".
  return idempotent(req, ctx.user, "assistant_items.withdraw", { id: params.id }, async () => ({ status: 200, body: { item: await withdrawReportNote(ctx, params.id) } }));
});
