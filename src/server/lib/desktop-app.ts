/**
 * Unauthenticated redirects for Boredroom for Mac's window (owner request, 24 October 2026: option A). In the window a
 * page that needs a session sends the person to `/desktop/app?next=…`, where the app signs its window in with the
 * notch's link (or shows the sign-in); everywhere else to `/login?next=…`, as before. The user agent is for the
 * experience only: `/desktop/app` without the app is just the sign-in page's way round.
 */
import { headers } from "next/headers";
import { safeNextPath } from "@/components/auth/next-path";
import { desktopEntryPath, isDesktopAppUserAgent } from "@/lib/desktop-app";

/** The sign-in path for `next`, chosen from a user agent. Pure (tested). */
export function signInPathFor(userAgent: string | null | undefined, next: string): string {
  const safe = safeNextPath(next, "/app");
  return isDesktopAppUserAgent(userAgent) ? desktopEntryPath(safe) : `/login?next=${encodeURIComponent(safe)}`;
}

/** The sign-in path for `next` for this request. */
export async function signInPath(next: string): Promise<string> {
  return signInPathFor((await headers()).get("user-agent"), next);
}

/** Whether this request comes from Boredroom for Mac's window (for the experience only, never for security). */
export async function inDesktopApp(): Promise<boolean> {
  return isDesktopAppUserAgent((await headers()).get("user-agent"));
}
