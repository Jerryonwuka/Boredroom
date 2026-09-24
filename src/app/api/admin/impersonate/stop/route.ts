import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { route } from "@/server/lib/api";
import { getCurrentUser, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { endImpersonation } from "@/server/admin/ops";
import { withSystem } from "@/server/db";
import { ADMIN_RETURN_COOKIE } from "@/app/api/admin/impersonate/start/route";

/** Ends the impersonated session and restores the administrator's own. Callable by the impersonated session itself. */
export const POST = route(async () => {
  const user = await getCurrentUser();
  const jar = await cookies();
  const back = jar.get(ADMIN_RETURN_COOKIE)?.value;
  const res = NextResponse.json({ ok: true, next: "/admin" });
  if (user?.impersonation) {
    const adminId = back ? await withSystem((db) => db.maybeOne<{ user_id: string }>(`SELECT user_id FROM auth_sessions WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [Buffer.from(back)])) : null;
    await endImpersonation(user.impersonation.id, adminId?.user_id ?? null);
  }
  const opts = await sessionCookieOptions();
  if (back) res.cookies.set(SESSION_COOKIE, back, opts); else res.cookies.set(SESSION_COOKIE, "", { ...opts, maxAge: 0 });
  res.cookies.set(ADMIN_RETURN_COOKIE, "", { ...opts, maxAge: 0 });
  return res;
});
