import { z } from "zod";
import { route, parseBody, ok } from "@/server/lib/api";
import { getCurrentUser, verifyEmail } from "@/server/auth";

/**
 * Confirms an email (a POST: mail scanners open links, and a GET must never confirm). `already`: the link was used or has
 * expired but the account is confirmed; `sameUser`: this browser is signed in as the link's account, so the verify page
 * may join the workspace in the same press (owner request, 11 October 2026: the first-run welcome, D10).
 */
export const POST = route(async (req) => {
  const { token } = await parseBody(req, z.object({ token: z.string().min(10) }));
  const r = await verifyEmail(token);
  const user = await getCurrentUser().catch(() => null);
  return ok({ ok: true, already: r.already, sameUser: !!user && user.authUserId === r.userId });
});
