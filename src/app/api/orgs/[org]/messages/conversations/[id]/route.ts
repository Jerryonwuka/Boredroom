import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { updateChannel, deleteConversation, setConversationPrefs } from "@/server/services/messaging";
import { setConversationAssistantReplies } from "@/server/services/mentions";

/**
 * PATCH renames, re-peoples, archives or restores a channel (its manager), and sets the caller's own choices for any
 * conversation: unread and muted. DELETE removes a channel, or hides a direct thread for the caller.
 *
 * `assistantReplies` (owner decision, 8 October 2026: personal assistants, phase 5): "Assistants can reply here", for
 * whoever runs the conversation (a named channel's creator, owner or HR; either person in a direct thread; owners and HR
 * for Everyone; owners, HR and the team's leads for a team channel), 403 for anyone else, 503 before migration 0041.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({
    title: z.string().trim().min(1).max(80).optional(), memberIds: z.array(z.uuid()).max(500).optional(), archived: z.boolean().optional(),
    unread: z.boolean().optional(), muted: z.boolean().optional(), assistantReplies: z.boolean().optional(),
  }));
  const { unread, muted, assistantReplies, ...channel } = body;
  const out: Record<string, unknown> = { id: params.id };
  if (channel.title !== undefined || channel.memberIds || channel.archived !== undefined) Object.assign(out, await updateChannel(ctx, params.id, channel));
  if (unread !== undefined || muted !== undefined) Object.assign(out, await setConversationPrefs(ctx, params.id, { unread, muted }));
  if (assistantReplies !== undefined) Object.assign(out, await setConversationAssistantReplies(ctx, params.id, assistantReplies));
  return ok(out);
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await deleteConversation(ctx, params.id));
});
