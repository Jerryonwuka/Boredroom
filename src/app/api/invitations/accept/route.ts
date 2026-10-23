import { z } from "zod";
import { route, parseBody, ok, requireAuth } from "@/server/lib/api";
import { acceptInvitation } from "@/server/services/orgs";
import { forbidden } from "@/server/lib/errors";
import { wakeTag } from "@/server/lib/wake-tag";

export const POST = route(async (req) => {
  wakeTag("invite"); // owner request, 23 October 2026: realtime plan, phase 0
  const user = await requireAuth();
  if (!user.emailVerified) throw forbidden("Verify your email before accepting an invitation.");
  const { token } = await parseBody(req, z.object({ token: z.string().min(10) }));
  const result = await acceptInvitation(user.profileId, user.email, token);
  return ok(result);
});
