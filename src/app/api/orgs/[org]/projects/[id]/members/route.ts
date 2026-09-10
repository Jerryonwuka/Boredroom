import { z } from "zod";
import { route, parseBody, orgContext, ok } from "@/server/lib/api";
import { setProjectMember } from "@/server/services/tasks";

export const POST = route<{ org: string; id: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  const body = await parseBody(req, z.object({ membershipId: z.string().uuid(), accessRole: z.enum(["lead", "contributor", "viewer", "remove"]) }));
  await setProjectMember(ctx, params.id, body.membershipId, body.accessRole);
  return ok({ ok: true });
});
