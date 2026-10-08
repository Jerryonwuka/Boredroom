import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { FOLLOW_UP_BODY_MAX, replySchema, replyToFollowUp } from "@/server/services/follow-ups";

/**
 * The person's reply to their own assistant's ask (owner decision, 8 October 2026: personal assistants, phase 4):
 * `{ choice: "on_track" | "blocked" | "done" | "not_started" | "not_now", note?: string (≤ 280) }`. Only the person the
 * follow-up is about, only while their assistant is asking them: anyone else 404, closed 409, a long note 422. Not gated
 * by the plan (the ask came from someone else). The notch sends it with its bearer token.
 */
export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, replySchema, { maxBytes: FOLLOW_UP_BODY_MAX });
  return ok({ followUp: await replyToFollowUp(ctx, params.id, { choice: body.choice, note: body.note ?? null }) });
});
