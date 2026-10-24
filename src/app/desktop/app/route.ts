import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromSessionToken } from "@/server/auth";
import { safeNextPath } from "@/components/auth/next-path";
import { userDigest } from "@/server/services/desktop-app";
import { desktopHtml, desktopRedirect, escapeHtml } from "@/server/lib/desktop-pages";

export const dynamic = "force-dynamic";

/**
 * Boredroom for Mac's window comes in here (owner request, 24 October 2026: option A; spec §6.3, §6.5). A route handler,
 * so it is always a full page load the app sees:
 * - a valid session cookie whose person's digest equals `u` → 303 `next` (the fast path);
 * - a valid session without `u`, or another person's → 303 `/desktop/app/ready?next&u=<its digest, or imp>`;
 * - no session → the handoff page: the app mints a code with its own token and calls `window.__boredroomHandoff(code)`
 *   by script, so no code is ever in a URL, and nobody can plant their own code on someone else (only the app can call
 *   the page's function). Needs no table of 0064.
 * Only the cookie counts here (never a Bearer).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get("next"), "/app");
  const u = url.searchParams.get("u");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? await userFromSessionToken(token) : null;
  if (user) {
    const digest = user.impersonation ? "imp" : userDigest(user.authUserId);
    if (u && u === digest && digest !== "imp") return desktopRedirect(req, next);
    return desktopRedirect(req, `/desktop/app/ready?next=${encodeURIComponent(next)}&u=${digest}`);
  }
  const retry = `/desktop/app?next=${encodeURIComponent(next)}&retry=1`;
  return desktopHtml({
    title: "Opening Boredroom",
    body: `<h1>Opening Boredroom…</h1><div class="later" id="later"><p>This is taking longer than usual.</p><a class="button" href="${escapeHtml(retry)}">Sign in</a></div>`,
    script: HANDOFF_SCRIPT,
  });
}

// The page's whole script (spec §6.5): a frozen marker the app probes for, and a one-shot function the app calls with the
// code. The code's shape is checked, it is posted to the strict same-origin redeem route, and only a path on this site
// is followed. Anything else shows the Sign in link.
const HANDOFF_SCRIPT = `(() => {
  const later = () => document.getElementById("later")?.classList.add("on");
  const timer = setTimeout(later, 12000);
  const showFallback = () => { clearTimeout(timer); later(); };
  Object.defineProperty(window, "__boredroomDesktop", { value: Object.freeze({ protocol: 1, page: "handoff" }) });
  let used = false;
  Object.defineProperty(window, "__boredroomHandoff", { value: async (code) => {
    if (used || typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) return;
    used = true;
    try {
      const r = await fetch("/api/desktop/app/handoff/redeem", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ code }) });
      const d = await r.json().catch(() => null);
      if (r.ok && d && typeof d.next === "string" && d.next.startsWith("/") && !/^\\/[\\/\\\\]/.test(d.next)) return location.replace(d.next);
    } catch {}
    showFallback();
  } });
})();`;
