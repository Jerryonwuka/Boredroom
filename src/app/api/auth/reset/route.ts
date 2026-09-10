import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { resetPassword } from "@/server/auth";

export const POST = route(async (req) => {
  const { token, password } = await parseBody(req, z.object({ token: z.string().min(10), password: z.string().min(10).max(200) }));
  await resetPassword(token, password);
  return ok({ ok: true });
});
