import type { MarketingPage } from "@/lib/marketing/types";

/**
 * The blog: its hub and the five posts of the analysis's first 15 pages (owner request, 17 October 2026: SEO analysis;
 * Content Plan pages 1 to 5, exact URLs from the Implementation Spec, Section C).
 * Owner: the blog writing group. Tune titles, descriptions, H1s, labels, summaries and dates here; keep the paths, the
 * keyword in the title and the H1, titles at most 60 characters and descriptions 120 to 160
 * (tests/unit/marketing-registry.test.ts).
 */
export const BLOG_PAGES = [
  {
    path: "/blog",
    kind: "hub",
    parent: "/",
    label: "Blog",
    title: "Blog: Guides for Remote Teams | Boredroom",
    description: "Practical guides for remote teams from Boredroom: end-of-day reports, templates and samples, async standups and what the data says about remote work.",
    h1: "Guides for remote teams",
    keyword: "guides for remote teams",
    summary: "End-of-day reports, async standups and what the research says about remote work.",
    updated: "2026-10-17",
    // The product's own end-of-day report beside the posts about writing one (review fixes, 17 October 2026).
    related: ["/free-tools/end-of-day-report-generator", "/features/ai-assistant", "/features/end-of-day-report"],
  },
  {
    path: "/blog/end-of-day-report",
    kind: "post",
    parent: "/blog",
    label: "End-of-day report guide",
    title: "End-of-Day Reports: The Complete Guide | Boredroom",
    description: "What an end-of-day report is, what belongs in one and what never does, who should write it, and how to bring it to a remote team without surveillance.",
    h1: "What is an end-of-day report? A complete guide for remote teams",
    keyword: "end of day report",
    summary: "What an end-of-day report is, what goes in it, who writes it, and how to start one without it feeling like surveillance.",
    updated: "2026-10-17",
  },
  {
    path: "/blog/end-of-day-report-template",
    kind: "post",
    parent: "/blog",
    label: "End-of-day report template",
    title: "End-of-Day Report Template: Free to Copy | Boredroom",
    description: "A free end-of-day report template in three versions, with filled-in examples for support, engineering and design. Copy or download it, no email needed.",
    h1: "End-of-day report template: free to copy and paste",
    keyword: "end of day report template",
    summary: "A free template in three versions, with filled-in examples, to copy or download without an email.",
    updated: "2026-10-17",
  },
  {
    path: "/blog/sample-end-of-day-report",
    kind: "post",
    parent: "/blog",
    label: "Sample end-of-day reports",
    title: "Sample End-of-Day Report: 7 Examples | Boredroom",
    description: "Seven sample end-of-day reports for engineering, support, design, sales and agency work, each annotated, plus a bad report rewritten line by line.",
    h1: "Sample end-of-day report: 7 examples, with notes",
    keyword: "sample end of day report",
    summary: "Seven annotated examples for different roles, and a bad report rewritten line by line.",
    updated: "2026-10-17",
  },
  {
    path: "/blog/asynchronous-standup",
    kind: "post",
    parent: "/blog",
    label: "Asynchronous standup guide",
    title: "Asynchronous Standups: A Practical Guide | Boredroom",
    description: "How to run an asynchronous standup: the questions to ask, when async works and when it doesn't, three templates to copy and the failure modes to avoid.",
    h1: "Asynchronous standups: how to run a daily standup without a meeting",
    keyword: "asynchronous standup",
    summary: "How to run a daily standup without a meeting, with three templates and the failure modes to avoid.",
    updated: "2026-10-17",
  },
  {
    path: "/blog/remote-work-productivity-statistics",
    kind: "post",
    parent: "/blog",
    label: "Remote work productivity statistics",
    title: "Work From Home Productivity Statistics | Boredroom",
    description: "Work from home and remote work productivity statistics from published research, each figure sourced and dated, with notes on what the numbers don't show.",
    h1: "Work from home productivity statistics: what the data shows",
    keyword: "work from home productivity statistics",
    summary: "What published research says about remote work and productivity, every figure sourced and dated.",
    updated: "2026-10-17",
  },
] as const satisfies readonly MarketingPage[];
