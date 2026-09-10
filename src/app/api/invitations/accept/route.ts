import { z } from "zod";
import { route, parseBody, ok, requireAuth } from "@/server/lib/api";
import { acceptInvitation } from "@/server/services/orgs";
import { forbidden } from "@/server/lib/errors";

export const POST = route(async (req) => {
  const user = await requireAuth();
  if (!user.emailVerified) throw forbidden("Verify your email before accepting an invitation.");
  const { token } = await parseBody(req, z.object({ token: z.string().min(10) }));
  const result = await acceptInvitation(user.profileId, user.email, token);
  return ok(result);
});
