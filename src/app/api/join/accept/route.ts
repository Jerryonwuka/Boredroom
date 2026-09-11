import { z } from "zod";
import { route, parseBody, ok, requireAuth } from "@/server/lib/api";
import { joinWithCode } from "@/server/services/orgs";
import { forbidden } from "@/server/lib/errors";

export const POST = route(async (req) => {
  const user = await requireAuth();
  if (!user.emailVerified) throw forbidden("Verify your email before joining an organisation.");
  const { code } = await parseBody(req, z.object({ code: z.string().trim().min(6).max(20) }));
  return ok(await joinWithCode(user.profileId, code));
});
