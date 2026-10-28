import { route, orgContext, ok } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { ResearchRefusal, stopResearch } from "@/server/research/service";

/**
 * Stop one of the person's own queued or running research (owner decision, 28 October 2026). 404 when it isn't theirs,
 * 409 RESEARCH_ENDED when it already ended, 503 RESEARCH_NOT_READY before 0066.
 */
export const POST = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  try {
    return ok({ research: await stopResearch(ctx, params.id) });
  } catch (err) {
    if (err instanceof ResearchRefusal) {
      const status = err.code === "RESEARCH_NOT_FOUND" ? 404 : err.code === "RESEARCH_ENDED" ? 409 : 503;
      throw new AppError(status, err.code, err.message);
    }
    throw err;
  }
});
