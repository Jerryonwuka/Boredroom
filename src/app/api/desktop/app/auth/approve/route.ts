import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { route, parseBody, assertStrictSameOrigin } from "@/server/lib/api";
import { SESSION_COOKIE } from "@/server/auth";
import { approveRequest, approveSchema, DESKTOP_AUTH_COOKIE } from "@/server/services/desktop-app";
import { wakeTag } from "@/server/lib/wake-tag";

/**
 * The signed-in person approves Boredroom for Mac's sign-in request (owner request, 24 October 2026: option A), from
 * /desktop/app/finish: strict same-origin, the session cookie only (never a Bearer), and the request cookie. Answers the
 * `boredroom://auth` link the page opens, and clears the request cookie.
 */
export const POST = route(async (req) => {
  assertStrictSameOrigin(req);
  const body = await parseBody(req, approveSchema, { maxBytes: 1024 });
  wakeTag("auth");
  const jar = await cookies();
  const out = await approveRequest({ sessionToken: jar.get(SESSION_COOKIE)?.value, requestCookie: jar.get(DESKTOP_AUTH_COOKIE)?.value, orgSlug: body.orgSlug });
  const res = NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  res.cookies.set(DESKTOP_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});
