import type { MarketingPage } from "@/lib/marketing/types";

/**
 * Free tools and pricing (owner request, 17 October 2026: SEO analysis; Content Plan pages 13 to 15, exact URLs from the
 * Implementation Spec, Section C). The tools run in the browser: no sign-up, no AI, no API key, nothing sent anywhere.
 * Prices are the live plans table's (per workspace, USD).
 * Owner: the tools writing group. Tune titles, descriptions, H1s, labels, summaries and dates here; keep the paths, the
 * keyword in the title and the H1, titles at most 60 characters and descriptions 120 to 160
 * (tests/unit/marketing-registry.test.ts).
 */
export const TOOLS_PAGES = [
  {
    path: "/free-tools",
    kind: "hub",
    parent: "/",
    label: "Free tools",
    title: "Free Tools for Remote Teams | Boredroom",
    description: "Free tools for remote teams: a work hours calculator and an end-of-day report generator. They run in your browser, with no sign-up and no email needed.",
    h1: "Free tools for remote teams",
    keyword: "free tools for remote teams",
    summary: "A work hours calculator and an end-of-day report generator that run in your browser.",
    updated: "2026-10-17",
    related: ["/blog/end-of-day-report-template", "/features/attendance-timesheets"],
  },
  {
    path: "/free-tools/work-hours-calculator",
    kind: "tool",
    parent: "/free-tools",
    label: "Work hours calculator",
    title: "Work Hours Calculator With Breaks and Overtime | Boredroom",
    description: "A free work hours calculator: add start and end times and unpaid breaks for a day or a full week, and get decimal hours, hours and minutes, and overtime.",
    h1: "Work hours calculator: hours, breaks and overtime",
    keyword: "work hours calculator",
    summary: "Hours worked for a day or a week, with breaks and overtime, in decimal hours and in hours and minutes.",
    updated: "2026-10-17",
  },
  {
    path: "/free-tools/end-of-day-report-generator",
    kind: "tool",
    parent: "/free-tools",
    label: "End-of-day report generator",
    title: "End-of-Day Report Generator (Free) | Boredroom",
    description: "A free end-of-day report generator: type a few bullet points and get a clear report of decisions, changes, blockers and tomorrow. It runs in your browser.",
    h1: "End-of-day report generator: a clear report from a few bullet points",
    keyword: "end of day report generator",
    summary: "Turn a few bullet points into a clear end-of-day report, then copy or download it.",
    updated: "2026-10-17",
  },
  {
    path: "/pricing",
    kind: "pricing",
    parent: "/",
    label: "Pricing",
    title: "Remote Team Management Software Pricing | Boredroom",
    description: "Boredroom pricing: Free for 1 workspace and 5 people, Pro at US$15 a month and Enterprise at US$50 a month, per workspace, not per person. No card for Free.",
    h1: "Remote team management software pricing: pay per workspace, not per person",
    keyword: "remote team management software pricing",
    summary: "Free, Pro and Enterprise, priced per workspace, not per person.",
    updated: "2026-10-17",
  },
] as const satisfies readonly MarketingPage[];
