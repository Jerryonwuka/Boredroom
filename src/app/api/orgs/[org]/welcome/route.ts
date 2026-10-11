import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { markWelcome, welcomePatchSchema, welcomeState } from "@/server/services/welcome";
import { WELCOME_BODY_MAX } from "@/lib/welcome";

/**
 * The person's own welcome progress in this workspace (owner request, 11 October 2026: the first-run welcome). GET reads
 * it; PATCH saves the screen reached, the steps skipped, a page view or Next steps hidden (403 while impersonated, 503
 * before migration 0056, 413 over 1 KB). Nobody else can read or write it.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await welcomeState(ctx));
});

export const PATCH = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await markWelcome(ctx, await parseBody(req, welcomePatchSchema, { maxBytes: WELCOME_BODY_MAX })));
});
