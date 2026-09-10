import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { reviewCaptureException } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ decision: z.enum(["accepted", "rejected"]), note: z.string().trim().max(2000).default("") }));
  await reviewCaptureException(ctx, params.id, body);
  return ok({ ok: true });
});
