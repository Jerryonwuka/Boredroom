import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { updateChannel, deleteConversation, setConversationPrefs } from "@/server/services/messaging";

/**
 * PATCH renames, re-peoples, archives or restores a channel (its manager), and sets the caller's own choices for any
 * conversation: unread and muted. DELETE removes a channel, or hides a direct thread for the caller.
 */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({
    title: z.string().trim().min(1).max(80).optional(), memberIds: z.array(z.uuid()).max(500).optional(), archived: z.boolean().optional(),
    unread: z.boolean().optional(), muted: z.boolean().optional(),
  }));
  const { unread, muted, ...channel } = body;
  const out: Record<string, unknown> = { id: params.id };
  if (channel.title !== undefined || channel.memberIds || channel.archived !== undefined) Object.assign(out, await updateChannel(ctx, params.id, channel));
  if (unread !== undefined || muted !== undefined) Object.assign(out, await setConversationPrefs(ctx, params.id, { unread, muted }));
  return ok(out);
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await deleteConversation(ctx, params.id));
});
