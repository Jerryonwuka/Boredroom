import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { VOICE_KEY_BODY_MAX, clearVoiceKey, setVoiceKey, voiceConnectionStatus, voiceKeySchema } from "@/server/services/natural-voice";

/**
 * The workspace's own ElevenLabs key (owner decision, 9 October 2026: natural voice (ElevenLabs), contract B.3). Owners
 * and HR. GET → the connection and this month's usage; POST `{ apiKey }` tests the key with one free request (its
 * subscription, which the caps need), stores it encrypted and answers the new status (a refusal is 422 on `apiKey`, with
 * words people can act on); DELETE removes it (Boredroom's key is used again within a daily share). The key is never
 * returned, logged or put in an error. Before migration 0053: GET says `ready: false`; POST and DELETE answer 503.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await voiceConnectionStatus(ctx));
});

export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  const body = await parseBody(req, voiceKeySchema, { maxBytes: VOICE_KEY_BODY_MAX });
  return ok(await setVoiceKey(ctx, body));
});

export const DELETE = route<{ org: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await clearVoiceKey(ctx));
});
