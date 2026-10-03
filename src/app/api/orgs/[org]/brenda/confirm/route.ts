import { z } from "zod";
import { route, parseBody, orgContext, ok, requireFeature } from "@/server/lib/api";
import { confirmAction } from "@/server/services/copilot";

/** Runs an action Brenda prepared and the person approved. The token is signed, short-lived and bound to the person. */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireFeature(ctx, "AI_ASSISTANT");
  const body = await parseBody(req, z.object({ token: z.string().min(10).max(8000) }));
  return ok(await confirmAction(ctx, body.token));
});
