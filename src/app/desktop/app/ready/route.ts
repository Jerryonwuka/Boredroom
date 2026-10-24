import { headers } from "next/headers";
import { safeNextPath } from "@/components/auth/next-path";
import { isDesktopAppUserAgent } from "@/lib/desktop-app";
import { desktopHtml, escapeHtml } from "@/server/lib/desktop-pages";

export const dynamic = "force-dynamic";

/**
 * "Opening Boredroom…" while Boredroom for Mac decides (owner request, 24 October 2026: option A; spec §6.3, §6.4 E3): the
 * window has a session, and the app compares its person (`u`) with the notch's. In the app nothing moves on its own (the
 * app acts) and a Continue link shows after 5 seconds; anywhere else the page goes straight on to `next`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get("next"), "/app");
  const inApp = isDesktopAppUserAgent((await headers()).get("user-agent"));
  return desktopHtml({
    title: "Opening Boredroom",
    head: inApp ? "" : `<meta http-equiv="refresh" content="0;url=${escapeHtml(next)}">`,
    body: `<h1>Opening Boredroom…</h1><div class="later${inApp ? "" : " on"}" id="later"><a class="button" href="${escapeHtml(next)}">Continue</a></div>`,
    script: `(() => { Object.defineProperty(window, "__boredroomDesktop", { value: Object.freeze({ protocol: 1, page: "ready" }) }); setTimeout(() => document.getElementById("later")?.classList.add("on"), 5000); })();`,
  });
}
