import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { resetPassword } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

export const POST = route(async (req) => {
  const { token, password } = await parseBody(req, z.object({ token: z.string().min(10), password: z.string().min(10).max(200) }));
  wakeTag("auth"); // owner request, 23 October 2026: realtime plan, phase 0
  await resetPassword(token, password);
  return ok({ ok: true });
});
