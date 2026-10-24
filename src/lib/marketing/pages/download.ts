import type { MarketingPage } from "@/lib/marketing/types";

/**
 * The download page's entry (owner request, 24 October 2026: people download Boredroom for Mac before there is an Apple
 * Developer account; option A, the same day: one app, the dashboard in its own window and Brenda in its notch). Under the home page, as /pricing is; linked from the footer, the welcome's Mac card and Next
 * steps, and the AI assistant page (the top nav stays at its seven links).
 * Owner: src/app/(marketing)/download/page.tsx.
 */
export const DOWNLOAD_PAGES = [
  {
    path: "/download",
    kind: "download",
    parent: "/",
    label: "Boredroom for Mac",
    title: "Download Boredroom for Mac | Boredroom",
    description: "Download Boredroom for Mac: your dashboard in its own window and Brenda in your notch. Free for macOS 14 or later, on Apple silicon and Intel Macs.",
    h1: "Download Boredroom for Mac",
    keyword: "Boredroom for Mac",
    summary: "Your Boredroom dashboard in its own Mac window, and Brenda in your notch for reminders, calls and quick asks.",
    updated: "2026-10-24",
  },
] as const satisfies readonly MarketingPage[];
