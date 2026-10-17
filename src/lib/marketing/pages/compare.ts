import type { MarketingPage } from "@/lib/marketing/types";

/**
 * Comparisons: the hub and the four comparison pages of the analysis's first 15 pages (owner request, 17 October 2026:
 * SEO analysis; Content Plan pages 6 to 9, exact URLs from the Implementation Spec, Section C). Every fact about another
 * product must come from a source fetched during the writing run, shown with a link and an "as of" date.
 * Written 17 October 2026 (compare group): the pages' facts about other products live in
 * src/components/marketing/compare/data.ts with their sources and an as-of date; move `updated` when they change.
 * Owner: the compare writing group. Tune titles, descriptions, H1s, labels, summaries and dates here; keep the paths, the
 * keyword in the title and the H1, titles at most 60 characters and descriptions 120 to 160
 * (tests/unit/marketing-registry.test.ts).
 */
export const COMPARE_PAGES = [
  {
    path: "/compare",
    kind: "hub",
    parent: "/",
    label: "Compare",
    title: "Compare Boredroom With Other Tools | Boredroom",
    description: "Compare Boredroom with employee monitoring and time tracking tools such as ActivTrak, Hubstaff and Time Doctor, on recording, scoring, consent and price.",
    h1: "Compare Boredroom with other tools",
    keyword: "compare boredroom",
    summary: "How Boredroom compares with monitoring and time tracking tools, head to head and across the category.",
    updated: "2026-10-17",
    related: ["/solutions/monitoring-without-scores", "/pricing"],
  },
  {
    path: "/compare/employee-monitoring-software",
    kind: "comparison",
    parent: "/compare",
    label: "Employee monitoring software comparison",
    title: "Employee Monitoring Software Comparison | Boredroom",
    description: "An employee monitoring software comparison: how the main tools differ on screen recording, productivity scores, consent and price, and when each one fits.",
    h1: "Employee monitoring software comparison: an honest look at the category",
    keyword: "employee monitoring software comparison",
    summary: "How the main tools differ on screen recording, productivity scores, consent and price.",
    updated: "2026-10-17",
    published: "2026-10-17",
  },
  {
    path: "/compare/boredroom-vs-activtrak",
    kind: "comparison",
    parent: "/compare",
    label: "Boredroom vs ActivTrak",
    title: "Boredroom vs ActivTrak: An Honest Comparison",
    description: "Boredroom vs ActivTrak, compared on productivity scores, screen capture, attendance, timesheets, an AI assistant for every person, privacy and pricing.",
    h1: "Boredroom vs ActivTrak: which fits a team that doesn't want scores?",
    keyword: "boredroom vs activtrak",
    summary: "Productivity scores, screen capture, attendance, an assistant for each person and price, side by side.",
    updated: "2026-10-17",
    published: "2026-10-17",
  },
  {
    path: "/compare/boredroom-vs-hubstaff",
    kind: "comparison",
    parent: "/compare",
    label: "Boredroom vs Hubstaff",
    title: "Boredroom vs Hubstaff: An Honest Comparison",
    description: "Boredroom vs Hubstaff, compared on time tracking, screenshots and activity levels, attendance, timesheets, an AI assistant for each person and pricing.",
    h1: "Boredroom vs Hubstaff: time tracking or an AI assistant for every person",
    keyword: "boredroom vs hubstaff",
    summary: "Time tracking, screenshots and activity levels, timesheets and price, side by side.",
    updated: "2026-10-17",
    published: "2026-10-17",
  },
  {
    path: "/compare/boredroom-vs-time-doctor",
    kind: "comparison",
    parent: "/compare",
    label: "Boredroom vs Time Doctor",
    title: "Boredroom vs Time Doctor: An Honest Comparison",
    description: "Boredroom vs Time Doctor, compared on monitoring, screenshots, what employees see, attendance, timesheets, an AI assistant for every person and pricing.",
    h1: "Boredroom vs Time Doctor: what changes when nobody is scored",
    keyword: "boredroom vs time doctor",
    summary: "Monitoring intensity, what employees see, timesheets and price, side by side.",
    updated: "2026-10-17",
    published: "2026-10-17",
  },
] as const satisfies readonly MarketingPage[];
