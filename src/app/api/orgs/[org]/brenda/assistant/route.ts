import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ASSISTANT_BODY_MAX, assistantProfiles, assistantProfileSchema, saveMyAssistant } from "@/server/services/assistant-profile";

/** The person's own assistant, the workspace's, and whether "Meet your assistant" is done (owner decision, 7 October 2026: personal assistants). */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await assistantProfiles(ctx));
});

/** Saves the person's own assistant (name, colour, visor, eyes) and marks setup done. No plan check: a name and a look are harmless without the AI. */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await saveMyAssistant(ctx, await parseBody(req, assistantProfileSchema, { maxBytes: ASSISTANT_BODY_MAX })));
});
