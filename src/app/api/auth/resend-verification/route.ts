import { route, ok, requireAuth } from "@/server/lib/api";
import { resendVerification } from "@/server/auth";

export const POST = route(async () => {
  const user = await requireAuth();
  await resendVerification(user.email);
  return ok({ ok: true });
});
