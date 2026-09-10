import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { flagRecording } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const { reason } = await parseBody(req, z.object({ reason: z.string().trim().min(1).max(2000) }));
  return ok(await flagRecording(ctx, params.id, reason), 201);
});
