import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { verifyEmail } from "@/server/auth";

export const POST = route(async (req) => {
  const { token } = await parseBody(req, z.object({ token: z.string().min(10) }));
  await verifyEmail(token);
  return ok({ ok: true });
});
