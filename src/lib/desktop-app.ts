/**
 * Boredroom for Mac's window (owner request, 24 October 2026: option A). The app's dashboard window is a WKWebView that
 * shows this site, and its user agent ends with `BoredroomDesktop/<version>`. That token is the only contract with the
 * web, and it is for the experience only, never for security (anyone can send any user agent): anything that renders
 * differently is decided on the server from the request's user agent, so hydration never disagrees; the client reads
 * `isDesktopApp()` in event handlers only. Client-safe: no server imports.
 */
import { safeNextPath } from "@/components/auth/next-path";

export const DESKTOP_UA_TOKEN = "BoredroomDesktop/";

/** Whether a user agent is Boredroom for Mac's window. */
export function isDesktopAppUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === "string" && ua.includes(DESKTOP_UA_TOKEN);
}

/** In the browser: whether this page is in Boredroom for Mac's window. Event handlers only (never while rendering). */
export function isDesktopApp(): boolean {
  return typeof navigator !== "undefined" && isDesktopAppUserAgent(navigator.userAgent);
}

/**
 * The Mac app shell (owner request, 26 October 2026: "make it look a little different from the web app like WhatsApp
 * desktop vs web", "make the side bar float on the app"). Inside Boredroom for Mac's window `<html data-shell="mac">`
 * is set before first paint by the root layout's inline script (from the user agent), and globals.css ("Boredroom for
 * Mac's window") turns the app frame into a native-looking window from it: a floating sidebar and a rounded page over
 * the window's vibrancy. In a browser nothing changes.
 *
 * In development only, `?shell=mac` (or `?shell=web`) in any address forces the look in a normal browser and remembers
 * it in the `boredroom-shell` cookie, so the shell can be built and checked without the app. A forced shell also sets
 * `data-shell-sim`, which paints a stand-in for the window's vibrancy (a browser can't see through to the desktop).
 */
export const SHELL_COOKIE = "boredroom-shell";
export type Shell = "mac" | "web";

/** The shell for a request: the user agent, or in development the `boredroom-shell` cookie when it is set. Pure (tested). */
export function shellFor(userAgent: string | null | undefined, devCookie: string | null | undefined, development: boolean): Shell {
  if (development && (devCookie === "mac" || devCookie === "web")) return devCookie;
  return isDesktopAppUserAgent(userAgent) ? "mac" : "web";
}

/**
 * The inline script (a fragment of the root layout's first-paint script) that sets `<html data-shell="mac">`. The
 * development half reads `?shell=` and the cookie; a production build never contains it.
 */
export function shellScript(development: boolean): string {
  const ua = `var s=navigator.userAgent.indexOf(${JSON.stringify(DESKTOP_UA_TOKEN)})>=0?"mac":"web",sim=0;`;
  const dev = development
    ? `var q=/[?&]shell=(mac|web)(?:&|$)/.exec(location.search),c=/(?:^|; )${SHELL_COOKIE}=(mac|web)/.exec(document.cookie);` +
      `if(q){document.cookie="${SHELL_COOKIE}="+q[1]+"; path=/; max-age=31536000; samesite=lax";}var f=q?q[1]:c?c[1]:"";if(f){sim=f==="mac"&&s!=="mac"?1:0;s=f;}`
    : "";
  return `${ua}${dev}if(s==="mac"){document.documentElement.dataset.shell="mac";if(sim)document.documentElement.dataset.shellSim="";}`;
}

/** The window's way in: `/desktop/app?next=…`, where the app signs its window in (or shows the sign-in). */
export function desktopEntryPath(next?: string | null): string {
  return `/desktop/app?next=${encodeURIComponent(safeNextPath(next, "/app"))}`;
}

/**
 * Where a sign-in, sign-up or verify continuation goes in the window: through `/desktop/app` (a full load the app sees),
 * unless it already leads there.
 */
export function desktopNext(href: string): string {
  const safe = safeNextPath(href, "/app");
  return safe.startsWith("/desktop/app") ? safe : desktopEntryPath(safe);
}

/** The link that hands the person back from their browser to Boredroom for Mac, opening `path` in its window. */
export function backToAppUrl(path: string): string {
  return `boredroom://open?path=${encodeURIComponent(safeNextPath(path, "/app"))}`;
}
