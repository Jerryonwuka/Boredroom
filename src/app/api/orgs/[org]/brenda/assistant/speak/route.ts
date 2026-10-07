import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { ASSISTANT_BODY_MAX, assistantSpeakSchema, saveMySpeak } from "@/server/services/assistant-profile";

/** When the person's own assistant reads replies aloud: voice, always or never (owner decision, 7 October 2026: her voice). No plan check. */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await saveMySpeak(ctx, await parseBody(req, assistantSpeakSchema, { maxBytes: ASSISTANT_BODY_MAX })));
});
