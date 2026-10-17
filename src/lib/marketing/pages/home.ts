import type { MarketingPage } from "@/lib/marketing/types";

/**
 * The home page's entry (owner request, 17 October 2026: SEO analysis; the Homepage Fix Sheet's values). The title,
 * the H1 and the description carry the primary keyword, "remote team management software". The description is the Fix
 * Sheet's candidate 1 with a spaced en dash where the PDF had a hyphen (British typography, same length).
 * Owner: the foundation (src/app/page.tsx).
 */
export const HOME_PAGES = [
  {
    path: "/",
    kind: "home",
    label: "Home",
    title: "Remote Team Management Software & AI Assistant | Boredroom",
    description: "Remote team management software with a personal AI assistant for every person. Attendance, timesheets and end-of-day reports – no productivity score.",
    h1: "Remote team management software that knows what your team is doing",
    keyword: "remote team management software",
    summary: "A personal AI assistant, Brenda, for every person, live attendance, timesheets that add up and the end-of-day report.",
    updated: "2026-10-17",
  },
] as const satisfies readonly MarketingPage[];
