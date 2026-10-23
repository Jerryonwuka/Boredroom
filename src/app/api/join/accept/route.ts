import { z } from "zod";
import { route, parseBody, ok, requireAuth } from "@/server/lib/api";
import { joinWithCode } from "@/server/services/orgs";
import { forbidden } from "@/server/lib/errors";
import { wakeTag } from "@/server/lib/wake-tag";

export const POST = route(async (req) => {
  wakeTag("join"); // owner request, 23 October 2026: realtime plan, phase 0
  const user = await requireAuth();
  if (!user.emailVerified) throw forbidden("Verify your email before joining an organisation.");
  const { code } = await parseBody(req, z.object({ code: z.string().trim().min(6).max(20) }));
  return ok(await joinWithCode(user.profileId, code));
});
