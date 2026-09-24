"use client";

/**
 * Light and dark. The choice lives in localStorage and on <html data-theme>; the inline script in the root layout
 * applies it before first paint, so there is no flash. Dark is the default until a person chooses otherwise.
 */
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

export type Theme = "light" | "dark";
export const THEME_KEY = "boredroom-theme";
const THEME_COLOR: Record<Theme, string> = { dark: "#000000", light: "#f4f4f2" };

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: the choice lasts for the page */ }
}

// The <html data-theme> attribute is the store; every toggle on the page follows it.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const serverTheme = (): Theme => "dark";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <IconButton className={className} aria-label={next === "light" ? "Switch to light mode" : "Switch to dark mode"} title={next === "light" ? "Light mode" : "Dark mode"} onClick={() => applyTheme(next)}>
      {theme === "dark" ? <Sun className="size-[18px]" aria-hidden /> : <Moon className="size-[18px]" aria-hidden />}
    </IconButton>
  );
}
