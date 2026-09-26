import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { updateChannel, deleteConversation } from "@/server/services/messaging";

/** PATCH renames, re-peoples, archives or restores a channel. DELETE removes a channel, or hides a direct thread for the caller. */
export const PATCH = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ title: z.string().trim().min(1).max(80).optional(), memberIds: z.array(z.uuid()).max(500).optional(), archived: z.boolean().optional() }));
  return ok(await updateChannel(ctx, params.id, body));
});

export const DELETE = route<{ org: string; id: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await deleteConversation(ctx, params.id));
});
