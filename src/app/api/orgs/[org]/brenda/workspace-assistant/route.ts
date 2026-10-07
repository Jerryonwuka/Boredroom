import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { ASSISTANT_BODY_MAX, assistantProfileSchema, saveWorkspaceAssistant } from "@/server/services/assistant-profile";

/** The workspace's own assistant, which signs the end-of-day team report (owners and HR; owner decision, 7 October 2026: personal assistants). */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner", "hr");
  return ok(await saveWorkspaceAssistant(ctx, await parseBody(req, assistantProfileSchema, { maxBytes: ASSISTANT_BODY_MAX })));
});
