import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Boredroom", template: "%s · Boredroom" },
  description: "Know what your team is working on, what is blocked, and what has actually been delivered.",
};

export const viewport: Viewport = { themeColor: "#0b0b0b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
