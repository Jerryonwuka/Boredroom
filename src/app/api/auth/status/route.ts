import { NextResponse } from "next/server";
import { getCurrentUser, requestSessionToken } from "@/server/auth";
import { wakeTag } from "@/server/lib/wake-tag";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Whether this browser is signed in and its email confirmed (owner request, 11 October 2026: the first-run welcome). The
 * "check your email" page asks every few seconds and moves on by itself once the link was opened, on any device. Never
 * 401 (signed out is an answer, not an error), never cached, and nothing else about the account. A failed read answers
 * 503, so a watching page waits and asks again instead of taking a database hiccup for "signed out".
 */
export async function GET() {
  try {
    // A session to look up reaches the database; none answers "signed out" without it (owner request, 23 October 2026).
    if (await requestSessionToken()) wakeTag("auth");
    const user = await getCurrentUser();
    return NextResponse.json({ signedIn: !!user, emailVerified: !!user?.emailVerified }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ code: "UNAVAILABLE", message: "Cannot check right now. Try again." }, { status: 503, headers: NO_STORE });
  }
}
