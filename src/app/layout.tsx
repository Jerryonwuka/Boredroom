import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TooltipLayer } from "@/components/ui/tooltips";
import { getPage } from "@/lib/marketing/registry";
import { OG_IMAGE_SIZE, SITE_NAME, SITE_URL, ogImagePath } from "@/lib/marketing/site";
import { ogImageAlt } from "@/lib/marketing/metadata";
import { shellScript } from "@/lib/desktop-app";

/**
 * The site's defaults (owner request, 17 October 2026: SEO analysis, A1, A2, A8). `metadataBase` is the canonical www
 * host, so every relative URL in metadata (the Open Graph images) becomes absolute there. No canonical here: a root
 * canonical would point every page that sets none (sign-in, sign-up …) at the home page; each public page sets its own,
 * self-referencing (pageMetadata, lib/marketing/metadata.ts). The description is the home page's (the Fix Sheet's
 * candidate 1), the fallback for every page without one; pages without their own Open Graph set get the site's name,
 * locale and the home page's 1200×630 image, and Twitter's large card with the same image.
 */
const home = getPage("/");
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Boredroom", template: "%s · Boredroom" },
  description: home.description,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: "en_GB", type: "website", images: [{ url: ogImagePath("/"), ...OG_IMAGE_SIZE, alt: ogImageAlt(home), type: "image/png" }] },
  twitter: { card: "summary_large_image" },
};

// The browser chrome matches the v4 canvas, the same values ThemeToggle sets (dark #0f0f10, light #ffffff).
export const viewport: Viewport = { themeColor: "#0f0f10", width: "device-width", initialScale: 1 };

/**
 * Applies the saved theme and sidebar state before first paint. Dark unless the person chose light (see ThemeToggle).
 * Fonts (Inter for the interface, Geist for display, Geist Mono for code and timers) load from globals.css.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("boredroom-theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;if(localStorage.getItem("boredroom-sidebar")==="collapsed")document.documentElement.dataset.sidebar="collapsed";if(t==="light"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#ffffff")}}catch(e){}})();` +
  // Boredroom for Mac's window (owner request, 26 October 2026: the Mac app shell): <html data-shell="mac"> before first
  // paint, from the user agent (lib/desktop-app.ts; in development also ?shell=mac). The page stays static: no headers().
  `(function(){try{${shellScript(process.env.NODE_ENV === "development")}}catch(e){}})();`;

// The whole site and app are written in British English, so the root language is en-GB, matching og:locale en_GB and
// the JSON-LD inLanguage (review fix, 17 October 2026: SEO analysis).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className="h-full" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[var(--z-toast)] focus:inline-flex focus:h-9 focus:items-center focus:rounded-[10px] focus:bg-primary focus:px-3 focus:text-sm focus:font-medium focus:text-primary-fg">Skip to content</a>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
