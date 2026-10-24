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
