import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { requestPasswordRecovery } from "@/server/auth";

export const POST = route(async (req) => {
  const { email } = await parseBody(req, z.object({ email: z.string().trim().email() }));
  await requestPasswordRecovery(email, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
  return ok({ ok: true });
});
