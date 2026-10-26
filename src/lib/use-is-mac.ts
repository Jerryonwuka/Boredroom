"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => undefined;
/** A desktop browser on macOS: an iPad says Macintosh too, but has touch points. */
const isMac = () => /Macintosh|Mac OS X/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

/** A desktop Mac (read after hydration; false on the server, so the server's page never guesses). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noop, isMac, () => false);
}

/** Known only after hydration: null on the server and in the first client render, then whether this is a desktop Mac. */
export function useMacOrNull(): boolean | null {
  return useSyncExternalStore(noop, isMac, () => null);
}

/**
 * Inside Boredroom for Mac's own window (owner request, 24 October 2026: option A), read after hydration like the
 * above: false on the server. For the experience only (the user agent can say anything). `<html data-shell="mac">`
 * (the Mac app shell, 26 October 2026) counts too, so a development browser forced with `?shell=mac` agrees.
 */
const inDesktopApp = () => navigator.userAgent.includes("BoredroomDesktop/") || document.documentElement.dataset.shell === "mac";
export function useIsDesktopApp(): boolean {
  return useSyncExternalStore(noop, inDesktopApp, () => false);
}
