import { route, orgContext, ok, parseBody } from "@/server/lib/api";
import { notFound } from "@/server/lib/errors";
import { lookEligible, saveScreenHelp, screenHelpPutSchema, screenHelpView } from "@/server/services/screen-help";

/**
 * Settings › Brenda's screen help card (owner decisions, 11 October 2026: screen help on Brenda for Mac; contract D.5).
 * GET: any member reads the workspace's switch, notice and never-look list (`ScreenHelpView`; `{ ready: false }` before
 * 0057). PUT: owners and HR only (403 otherwise): `allowed`, `neverLook` (at most 50, repeats dropped) or `startNow`.
 * Phase 2 (owner request, 12 October 2026; contract D.13): PUT also takes `actionsAllowed` (on-screen actions and file
 * work on Brenda for Mac; 503 NOT_READY before migration 0058), which can only ever switch them off for everyone.
 * A workspace that is not offered screen help (the pilot list) answers 404. Who uses it is never here.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  if (!lookEligible(ctx.org.slug)) throw notFound();
  return ok(await screenHelpView(ctx));
});

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, screenHelpPutSchema, { maxBytes: 64_000 });
  return ok(await saveScreenHelp(ctx, body));
});
