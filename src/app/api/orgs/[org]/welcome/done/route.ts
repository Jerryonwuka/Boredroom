import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { finishWelcome, welcomeDoneSchema } from "@/server/services/welcome";
import { WELCOME_BODY_MAX } from "@/lib/welcome";

/**
 * Finishes the welcome, "done" or "skipped" (owner request, 11 October 2026: the first-run welcome). Marks the assistant's
 * setup done too, before migration 0056 as well; a second call changes nothing. 403 while impersonated.
 */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await finishWelcome(ctx, await parseBody(req, welcomeDoneSchema, { maxBytes: WELCOME_BODY_MAX })));
});
