import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { completeGoogleSignIn, signInWithGoogle, safeNext, googleFailureCode, OAUTH_COOKIE, type GoogleFailure } from "@/server/auth/google";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Google sends the browser back here. On success the session cookie is set and the person lands where they were going. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  // The reason goes back as a fixed code; the sign-in page owns the words (GOOGLE_FAILURE).
  const fail = (code: GoogleFailure) => {
    const res = NextResponse.redirect(`${process.env.APP_ORIGIN ?? url.origin}/login?google=${code}`, 302);
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  let pending: { state: string; nonce: string; next: string; at: number } | null = null;
  try { pending = raw ? JSON.parse(raw) : null; } catch { pending = null; }
  if (!pending || Date.now() - pending.at > 600_000) return fail("timeout");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state || state !== pending.state) return fail("mismatch");
  try {
    const claims = await completeGoogleSignIn(code, pending.nonce);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const { token } = await signInWithGoogle(claims, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    const res = NextResponse.redirect(`${process.env.APP_ORIGIN ?? url.origin}${safeNext(pending.next)}`, 302);
    res.cookies.set(SESSION_COOKIE, token, await sessionCookieOptions());
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  } catch (err) {
    return fail(googleFailureCode(err));
  }
}
