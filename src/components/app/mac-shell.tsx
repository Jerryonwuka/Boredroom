"use client";

/**
 * Boredroom for Mac's window (owner request, 26 October 2026: the Mac app shell). Mounted by AppShell only there. It
 * gives the app's own menus (⌘1–⌘9, ⌘N) a way to change page without reloading it: the app runs
 * `window.__boredroomShell.go("/app/…")` in the page, and this moves the router there. Nothing goes the other way: the
 * page can call nothing in the app (its window has no IPC at all), and a path that isn't a workspace page is ignored.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window { __boredroomShell?: { go: (path: string) => void } }
}

/** Whether `path` is a workspace page on this site (`/app/…`), never another origin or scheme. Pure (tested). */
export function shellPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length > 512) return null;
  if (!/^\/app(?:\/|$|\?)/.test(path) || path.startsWith("//") || path.includes("\\")) return null;
  return path;
}

export function MacShell() {
  const router = useRouter();
  useEffect(() => {
    const go = (path: string) => {
      const p = shellPath(path);
      if (p) router.push(p);
    };
    window.__boredroomShell = { go };
    return () => { if (window.__boredroomShell?.go === go) delete window.__boredroomShell; };
  }, [router]);
  return null;
}
