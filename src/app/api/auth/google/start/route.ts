import { NextResponse } from "next/server";
import { beginGoogleSignIn, OAUTH_COOKIE } from "@/server/auth/google";
import { errorResponse } from "@/server/lib/api";

export const dynamic = "force-dynamic";

/** Sends the browser to Google. `next` is where to land afterwards (a join link, onboarding, or the app). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { url: to, cookie } = beginGoogleSignIn(url.searchParams.get("next"));
    const res = NextResponse.redirect(to, 302);
    res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 600 });
    return res;
  } catch (err) { return errorResponse(err, "google-start"); }
}
