import type { MarketingPage } from "@/lib/marketing/types";

/**
 * The legal pages' entries (owner request, 11 November 2026: Privacy and Terms before launch). Under the home page;
 * linked from the footer, the sign-up form and the emails. `updated` is the date of the version people agree to
 * (LEGAL_VERSION in lib/legal.ts): change the two together.
 * Owners: src/app/(marketing)/privacy/page.tsx and src/app/(marketing)/terms/page.tsx.
 */
export const LEGAL_PAGES = [
  {
    path: "/privacy",
    kind: "legal",
    parent: "/",
    label: "Privacy Policy",
    title: "Privacy Policy | Boredroom",
    description: "What personal data Boredroom collects, why, who can see it, which services process it, how long it is kept, and how to use your rights over it.",
    h1: "Privacy Policy",
    keyword: "Privacy Policy",
    summary: "What Boredroom collects, who can see it, how long it is kept and your rights over it.",
    updated: "2026-11-11",
  },
  {
    path: "/terms",
    kind: "legal",
    parent: "/",
    label: "Terms of Service",
    title: "Terms of Service | Boredroom",
    description: "The agreement for using Boredroom: who may use it, accounts and workspaces, acceptable use, plans and payment, Brenda's limits, and how it ends.",
    h1: "Terms of Service",
    keyword: "Terms of Service",
    summary: "The agreement between you and Boredroom: accounts, acceptable use, payment and how it ends.",
    updated: "2026-11-11",
  },
] as const satisfies readonly MarketingPage[];
