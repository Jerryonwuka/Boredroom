import { z } from "zod";
import { route, parseBody, orgContext, ok, requireRole } from "@/server/lib/api";
import { setRecordingMode } from "@/server/services/orgs";

/** One-click recording switch (publishes a policy version that changes only the recording mode). */
export const POST = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  requireRole(ctx, "owner");
  const body = await parseBody(req, z.object({ mode: z.enum(["disabled", "optional", "required_on_designated_tasks"]) }));
  return ok(await setRecordingMode(ctx, body.mode));
});
