import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { assistantTalkPreferences, saveAssistantTalkPreferences } from "@/server/services/assistant-items";

/**
 * "Let people tag {name} in Messages" (owner decision, 8 October 2026: personal assistants, phase 6):
 * `{ ready, allowThreadReplies }`, on by default. The person's own; before migration 0043 it reads `ready: false`.
 */
export const GET = route<{ org: string }>(async (_req, { params }) => ok(await assistantTalkPreferences(await orgContext(params.org))));

/** `{ allowThreadReplies: boolean }`, saved at once. Refused (403) while someone else is signed in as the person; 503 before 0043. */
export const PUT = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ allowThreadReplies: z.boolean({ error: "Say whether people may tag your assistant." }) }), { maxBytes: 4096 });
  const saved = await saveAssistantTalkPreferences(ctx, body);
  return ok({ ready: true, ...saved });
});
