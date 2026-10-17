import { route, orgContext, ok, requireFeature } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { ACT_LIMITS } from "@/lib/act";
import { endTooBig, readActBody, stepSchema, stepTask } from "@/server/services/act";

/**
 * One step of a screen task the person asked for and said yes to (owner permission rule, 12 October 2026; contract
 * D.7.3, D.8). Rust alone calls it, with the computer-use transcript it holds (the server keeps only its SHA-256), the
 * results of the actions it ran and their screenshots. Refused without the recorded yes (403 ACT_NOT_CONFIRMED), after a
 * stop or the wall clock (409 ACT_ENDED), past the step cap (429), while a step waits for its own yes (409 ACT_STEP_ASK),
 * with a transcript that isn't the one this server answered (409 ACT_TRANSCRIPT), and when an app Brenda never works in is
 * in front (403 ACT_FORBIDDEN_APP; integration, 12 October 2026). A plan's screen part (phase 3, 12 October 2026) carries
 * its step's index `i` and runs only when it is the plan's current step (409 ACT_STEP_ORDER). Nothing in it is kept or
 * logged.
 *
 * Brenda and her helpers (owner brief, 12 October 2026; contract I, R.5): the Mac operator's job steps come here too
 * (`kind 'job'`, helper 'operator'): authorised by the person's own recorded request (or their yes), on claude-sonnet-5-5
 * moving to claude-opus-5-5 when it struggles, with no wall clock but the job's idle and age limits; every send, submit,
 * pay or delete still asks first.
 */
export const maxDuration = 180;

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  let body;
  try {
    body = await readActBody(req, stepSchema, ACT_LIMITS.bodyBytes);
  } catch (err) {
    // Too big to read: the task ends (too_big), so the Mac's next step finds it ended.
    if (err instanceof AppError && err.status === 413) await endTooBig(ctx, params.id);
    throw err;
  }
  return ok(await stepTask(ctx, params.id, body));
});
