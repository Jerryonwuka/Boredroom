import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { resolveIncident } from "@/server/services/recording";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ disposition: z.enum(["deleted", "released"]), note: z.string().trim().min(1).max(2000) }));
  await resolveIncident(ctx, params.id, body);
  return ok({ ok: true });
});
