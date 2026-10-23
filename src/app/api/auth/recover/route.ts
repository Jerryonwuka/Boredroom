import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { requestPasswordRecovery } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

export const POST = route(async (req) => {
  const { email } = await parseBody(req, z.object({ email: z.string().trim().email() }));
  wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0
  await requestPasswordRecovery(email, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
  return ok({ ok: true });
});
