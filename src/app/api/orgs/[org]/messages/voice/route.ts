import { route, orgContext, ok } from "@/server/lib/api";
import { invalid } from "@/server/lib/errors";
import { sendVoiceMessage } from "@/server/services/messaging";

/** Posts a recorded voice note (multipart: file, conversationId, seconds) into a conversation the caller can read. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const conversationId = String(form?.get("conversationId") ?? "");
  const seconds = Number(form?.get("seconds") ?? 0);
  if (!(file instanceof File)) throw invalid("No recording was received.");
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw invalid("Pick a conversation first.");
  if (!Number.isFinite(seconds) || seconds < 1) throw invalid("The recording is too short.");
  const bytes = Buffer.from(await file.arrayBuffer());
  return ok(await sendVoiceMessage(ctx, { conversationId, type: file.type, bytes, seconds }), 201);
});
