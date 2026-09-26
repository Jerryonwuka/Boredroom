import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TooltipLayer } from "@/components/ui/tooltips";

export const metadata: Metadata = {
  title: { default: "Boredroom", template: "%s · Boredroom" },
  description: "Know what your team is working on, what is blocked, and what has actually been delivered.",
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

/** Applies the saved theme and sidebar state before first paint. Dark unless the person chose light (see ThemeToggle). */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("boredroom-theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;if(localStorage.getItem("boredroom-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed";if(t==="light"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f4f4f2")}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg">Skip to content</a>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
