import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { NATURAL_VOICE_BODY_MAX, naturalVoiceSchema, naturalVoiceView, saveMyNaturalVoice } from "@/server/services/natural-voice";

/**
 * The person's own assistant's voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract B.4). Any
 * member. GET → the choice, whether it would be used right now and if not why (`NaturalVoiceView`); PUT `{ voiceId }`
 * (one of the eight voices, or null for "Computer voice", the default) saves it as the person and answers the new view.
 * Saved to the account, so the desktop app uses it too. Refused while someone else is signed in as them (403), 503
 * before migration 0053. Not logged: a personal preference.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await naturalVoiceView(ctx));
});

export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await saveMyNaturalVoice(ctx, await parseBody(req, naturalVoiceSchema, { maxBytes: NATURAL_VOICE_BODY_MAX })));
});
