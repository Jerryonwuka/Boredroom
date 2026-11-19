import type { MarketingPage } from "@/lib/marketing/types";

/**
 * The demo page's entry (owner request, 17 November 2026: "on the website, I want us to have book a demo"). Under the
 * home page, as /pricing and /download are; linked from the home page's hero, the closing section, the footer, the
 * phone menu and the Enterprise plan (the top nav stays at its seven links).
 * Owner: src/app/(marketing)/demo/page.tsx.
 */
export const DEMO_PAGES = [
  {
    path: "/demo",
    kind: "demo",
    parent: "/",
    label: "Book a demo",
    title: "Book a demo of Boredroom | Boredroom",
    description: "Book a demo of Boredroom: a live walkthrough of the workspace, Brenda and the end-of-day report with someone from the team, at a time that suits you.",
    h1: "Book a demo of Boredroom",
    keyword: "Book a demo",
    summary: "A live walkthrough of Boredroom and Brenda with someone from the team, at a time that suits you.",
    updated: "2026-11-17",
  },
] as const satisfies readonly MarketingPage[];
