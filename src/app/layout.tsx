import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TooltipLayer } from "@/components/ui/tooltips";

export const metadata: Metadata = {
  title: { default: "Boredroom", template: "%s · Boredroom" },
  description: "Know what your team is working on, what is blocked, and what has actually been delivered.",
};

// The browser chrome matches the v4 canvas, the same values ThemeToggle sets (dark #0f0f10, light #ffffff).
export const viewport: Viewport = { themeColor: "#0f0f10", width: "device-width", initialScale: 1 };

/**
 * Applies the saved theme and sidebar state before first paint. Dark unless the person chose light (see ThemeToggle).
 * Fonts (Inter for the interface, Geist for display, Geist Mono for code and timers) load from globals.css.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("boredroom-theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;if(localStorage.getItem("boredroom-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed";if(t==="light"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#ffffff")}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[var(--z-toast)] focus:inline-flex focus:h-9 focus:items-center focus:rounded-[10px] focus:bg-primary focus:px-3 focus:text-sm focus:font-medium focus:text-primary-fg">Skip to content</a>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
