import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { reportMessage } from "@/server/services/messaging";

/** Reports a message to the organisation owner and HR. */
export const POST = route<{ org: string; message: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ reason: z.string().trim().min(1).max(1000) }));
  return ok(await reportMessage(ctx, params.message, body.reason), 201);
});
