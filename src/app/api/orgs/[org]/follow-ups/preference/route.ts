import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { FOLLOW_UP_BODY_MAX, followUpPreference, preferenceSchema, saveFollowUpPreference } from "@/server/services/follow-ups";

/**
 * "When someone's assistant asks about your work" (owner decision, 8 October 2026: personal assistants, phase 4):
 * `auto` (answer from my work, ask me only if it can't; the default) or `ask_first`. The person's own; not gated by the
 * plan. Before migration 0039 the read says `ready: false` and a save is 503.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await followUpPreference(await orgContext(params.org))));

/** Refused while someone else is signed in as the person. */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, preferenceSchema, { maxBytes: FOLLOW_UP_BODY_MAX });
  return ok(await saveFollowUpPreference(ctx, body.preference));
});
