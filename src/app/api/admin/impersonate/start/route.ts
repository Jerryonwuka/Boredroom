import { z } from "zod";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminRoute, requireReason } from "@/server/admin/auth";
import { parseBody } from "@/server/lib/api";
import { startImpersonation } from "@/server/admin/ops";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";

export const ADMIN_RETURN_COOKIE = "boredroom_admin_return";

/**
 * Starts viewing Boredroom as a user: the administrator's own session cookie is parked in a second cookie and the
 * target's temporary session takes its place. "Return to admin" reverses it.
 */
export const POST = adminRoute("user.impersonate", async (req, { admin }) => {
  const body = await parseBody(req, z.object({ userId: z.string().uuid(), reason: z.string() }));
  const jar = await cookies();
  const own = jar.get(SESSION_COOKIE)?.value;
  const r = await startImpersonation(admin, body.userId, requireReason(body.reason), { userAgent: req.headers.get("user-agent") ?? undefined });
  const res = NextResponse.json({ ok: true, email: r.email, next: "/app" });
  const opts = await sessionCookieOptions();
  if (own) res.cookies.set(ADMIN_RETURN_COOKIE, own, { ...opts, maxAge: 2 * 3600 });
  res.cookies.set(SESSION_COOKIE, r.token, { ...opts, maxAge: 2 * 3600 });
  return res;
});
