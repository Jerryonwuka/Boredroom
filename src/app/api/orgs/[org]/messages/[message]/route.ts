import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { withdrawMessage, editMessage } from "@/server/services/messaging";

/** Withdraws one of the caller's own messages. */
export const DELETE = route<{ org: string; message: string }>(async (_req, { params }) => {
  const ctx = await orgContext(params.org);
  return ok(await withdrawMessage(ctx, params.message));
});

/** Changes the text of one of the caller's own messages. */
export const PATCH = route<{ org: string; message: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ body: z.string().trim().min(1).max(4000) }));
  return ok(await editMessage(ctx, params.message, body.body));
});
