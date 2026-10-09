import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { checkAiBurst } from "@/server/services/ai-usage";
import { commitmentsReady } from "@/server/services/commitments";
import { scanLooseEnds } from "@/server/services/loose-end-detect";
import { LOOP_LIMITS, LOOPS_NOT_READY_SHORT } from "@/lib/commitments";

const bodySchema = z.object({ days: z.number().int().min(1).max(LOOP_LIMITS.looseEndDaysMax).optional() });

/**
 * "Look for loose ends" (owner decisions, 8 October 2026: phase 7b): the person's own assistant looks through the
 * conversations they can read (`days` back, 1 to 14, 7 by default; one of their daily requests when the AI is on, else
 * only the clearest ones) and keeps what it found, privately. Answers `LooseEndScanResult`. 429 within two minutes of
 * the last look (or past the minute's burst), 503 before migration 0048.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, bodySchema, { maxBytes: 8192 });
  if (!(await commitmentsReady(ctx))) throw new AppError(503, "NOT_READY", LOOPS_NOT_READY_SHORT);
  await checkAiBurst(ctx);
  return ok(await scanLooseEnds(ctx, { days: body.days, source: "on_demand" }));
});
