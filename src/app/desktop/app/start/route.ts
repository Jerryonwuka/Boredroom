import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromSessionToken } from "@/server/auth";
import { bindStart, desktopAuthCookieOptions, DESKTOP_AUTH_COOKIE, requestCookieValue } from "@/server/services/desktop-app";
import { desktopHeaders, desktopHtml, desktopRedirect } from "@/server/lib/desktop-pages";
import { AppError } from "@/server/lib/errors";

export const dynamic = "force-dynamic";

const FINISH = "/desktop/app/finish";

/**
 * Boredroom for Mac's sign-in link (owner request, 24 October 2026: option A; spec §6.3): opened once, in the window or
 * the person's browser, within 10 minutes. It binds the request to this browser with a signed 30-minute cookie, then
 * goes on to the finish page (signed in already), Google (the Google button's request) or the sign-in page. A router
 * prefetch (the RSC header) never uses it. Unknown, used or expired: the expired page, no cookie.
 */
export async function GET(req: Request) {
  if (req.headers.get("rsc")) return new Response("", { status: 200, headers: desktopHeaders({ "content-type": "text/html; charset=utf-8" }) });
  const t = new URL(req.url).searchParams.get("t");
  let bound: Awaited<ReturnType<typeof bindStart>> = null;
  try { bound = await bindStart(t); }
  catch (err) {
    if (err instanceof AppError && err.status === 503) return desktopHtml({ title: "Sign in to Boredroom", body: `<h1>Sign in with a code</h1><p>${err.message}</p>`, status: 503 });
    throw err;
  }
  if (!bound) return desktopRedirect(req, "/desktop/app/expired");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await userFromSessionToken(token) : null;
  const to = user ? FINISH : bound.intent === "google" ? `/api/auth/google/start?next=${encodeURIComponent(FINISH)}` : `/login?next=${encodeURIComponent(FINISH)}`;
  const res = desktopRedirect(req, to);
  const out = new NextResponse(null, { status: 303, headers: res.headers });
  out.cookies.set(DESKTOP_AUTH_COOKIE, requestCookieValue(bound.requestId), desktopAuthCookieOptions());
  return out;
}
