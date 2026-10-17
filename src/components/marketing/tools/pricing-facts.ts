import type { PublicPlan } from "@/lib/plans";
import type { FaqItem } from "@/lib/marketing/schema";

/**
 * The /pricing page's words and numbers, made from the live plans (owner request, 17 October 2026: SEO analysis,
 * Content Plan page 15: "every limit stated as a number", the cost at 10, 50 and 200 people, the FAQ with a matching
 * FAQPage). Pure: the page passes in the plans table's rows, the tests pass in their own.
 *
 * FALLBACK_PLANS are the live plans as of 17 October 2026 (USD, per workspace; the same prices as the SoftwareApplication
 * offers in lib/marketing/schema.ts). A pricing page that loses its database still says what things cost: the page uses
 * them only when the plans table can't be read.
 */

const GB = 1024 ** 3;
const ALL_ON = { HEARTBEAT_TRACKING: true, EXPORT_REPORTS: true, AI_ASSISTANT: true, VOICE_NOTES: true, GOOGLE_SIGN_IN: true, AUDIT_LOGS: true };

export const FALLBACK_PLANS: PublicPlan[] = [
  { code: "free", name: "Free", description: "For a small team trying Boredroom out.", currency: "USD", monthly_price: 0, annual_price: 0, max_users: 5, max_storage_bytes: 2 * GB, max_workspaces: 1, trial_days: 0, features: ALL_ON },
  { code: "pro", name: "Pro", description: "Everything a remote team needs.", currency: "USD", monthly_price: 1500, annual_price: 15000, max_users: 50, max_storage_bytes: 150 * GB, max_workspaces: 5, trial_days: 3, features: ALL_ON },
  { code: "enterprise", name: "Enterprise", description: null, currency: "USD", monthly_price: 5000, annual_price: 50000, max_users: null, max_storage_bytes: null, max_workspaces: null, trial_days: 7, features: ALL_ON },
];

/** Minor units → "US$15" / "US$12.50" (the pricing cards' own format, so the page reads one way). */
export function money(minor: number, currency: string): string {
  const major = minor / 100;
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: major % 1 ? 2 : 0, minimumFractionDigits: major % 1 ? 2 : 0 }).format(major); }
  catch { return `${currency} ${major.toLocaleString("en-GB")}`; }
}

export const gb = (bytes: number) => `${Math.round(bytes / GB)} GB`;
export const isFree = (p: PublicPlan) => p.monthly_price === 0 && p.annual_price === 0;

export const limit = {
  workspaces: (p: PublicPlan) => (p.max_workspaces === null ? "Unlimited" : String(p.max_workspaces)),
  people: (p: PublicPlan) => (p.max_users === null ? "Unlimited" : String(p.max_users)),
  storage: (p: PublicPlan) => (p.max_storage_bytes === null ? "Unlimited" : gb(p.max_storage_bytes)),
};

/** "1 workspace, 5 people per workspace and 2 GB of file storage" */
export function limitsSentence(p: PublicPlan): string {
  if (p.max_workspaces === null && p.max_users === null && p.max_storage_bytes === null) return "no limit on workspaces, people or storage";
  const ws = p.max_workspaces === null ? "unlimited workspaces" : `${p.max_workspaces} workspace${p.max_workspaces === 1 ? "" : "s"}`;
  const people = p.max_users === null ? "unlimited people" : `${p.max_users} people per workspace`;
  const storage = p.max_storage_bytes === null ? "unlimited file storage" : `${gb(p.max_storage_bytes)} of file storage`;
  return `${ws}, ${people} and ${storage}`;
}

/** "US$15 a month, or US$150 a year" */
export function priceSentence(p: PublicPlan): string {
  if (isFree(p)) return "free";
  return `${money(p.monthly_price, p.currency)} a month, or ${money(p.annual_price, p.currency)} a year`;
}

/** The cheapest plan, by its monthly price, that holds `people` in ONE workspace; null when none does. */
export function planFor(plans: readonly PublicPlan[], people: number): PublicPlan | null {
  return [...plans].sort((a, b) => a.monthly_price - b.monthly_price).find((p) => p.max_users === null || p.max_users >= people) ?? null;
}

/** Whether every plan turns on the same features (today they do: the plans differ only in their limits). */
export function sameFeatures(plans: readonly PublicPlan[]): boolean {
  if (plans.length < 2) return true;
  const on = (p: PublicPlan) => Object.keys(p.features).filter((k) => p.features[k]).sort().join(",");
  return plans.every((p) => on(p) === on(plans[0]));
}

/** Whether every plan has this feature flag on (the page says "every plan" only when it's true). */
export const everyPlanHas = (plans: readonly PublicPlan[], flag: string) => plans.length > 0 && plans.every((p) => !!p.features[flag]);

/**
 * The FAQ: shown on the page and written as its FAQPage from this one list (FaqSection), so the two match word for
 * word. Made from the plans, so a price change in the Control Center changes the answers with the cards.
 */
export function pricingFaq(plans: readonly PublicPlan[]): FaqItem[] {
  const sorted = [...plans].sort((a, b) => a.monthly_price - b.monthly_price);
  const free = sorted.find(isFree);
  const paid = sorted.filter((p) => !isFree(p));
  const trials = paid.filter((p) => p.trial_days > 0);
  const capped = sorted.filter((p) => p.max_users !== null);
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  const items: FaqItem[] = [
    {
      question: "How much does Boredroom cost?",
      answer: [
        free ? `${free.name} costs nothing: ${limitsSentence(free)}.` : "",
        ...paid.map((p) => `${p.name} is ${priceSentence(p)}, per workspace, with ${limitsSentence(p)}.`),
        "Prices are in US dollars, and every plan is priced per workspace, not per person.",
      ].filter(Boolean).join(" "),
    },
  ];
  if (free) {
    items.push({
      question: "Is there a free plan?",
      answer: `Yes. ${free.name} gives you ${limitsSentence(free)}, with no card needed and no end date.${sameFeatures(sorted) ? " It has the same features as the paid plans, Brenda included; the plans differ only in how many workspaces, people and files they hold." : ""}`,
    });
  }
  items.push(
    {
      question: "Do you charge per person?",
      answer: `No. A workspace pays one price however many people are in it, up to its plan's limit${capped.length ? ` (${list(capped.map((p) => `${p.max_users} on ${p.name}`))}${sorted.some((p) => p.max_users === null) ? `, no limit on ${sorted.filter((p) => p.max_users === null).map((p) => p.name).join(" or ")}` : ""})` : ""}. Joining someone else's workspace is always free.`,
    },
    {
      question: "What happens if we add more people?",
      answer: `The price stays the same. When a workspace reaches its plan's limit, Boredroom won't add the next person and says which plan has room for them. Nobody already in the workspace is removed.`,
    },
  );
  if (trials.length) {
    items.push({
      question: "Is there a free trial?",
      answer: `${list(trials.map((p) => `${p.name} comes with a ${p.trial_days}-day free trial`))}. If a trial or a paid plan ends without payment, the workspace moves to ${free?.name ?? "the free plan"}'s limits after a short grace period, and nothing is deleted.`,
    });
  }
  items.push({
    question: "Is a productivity score or screen recording on a higher plan?",
    answer: "No. Boredroom has no productivity score, no screen recording and no call recording on any plan, at any price. Every plan records the same things, attendance, confirmed hours and tasks, and reports give plain counts with nobody ranked.",
  });
  return items;
}

/**
 * Per-seat prices fetched from the vendors' own pricing pages on 17 October 2026 (the build spec's rule D18: only facts
 * fetched during the run, cited with a link and the date). ActivTrak's cheapest paid plan, Work Activity Tracking:
 * "$10" per worker a month, billed annually (annual plans only). Hubstaff's Team plan: $10 a seat a month billed
 * annually, $12 billed monthly (its pricing page's Monthly/Annual toggle; the FAQ's "$10 per seat per month" is the
 * annual price). Time Doctor's amounts come from the comparison pages' data (src/components/marketing/compare/data.ts),
 * so /pricing and /compare always agree (review fix, 17 October 2026: SEO analysis).
 */
export const PER_SEAT = [
  { vendor: "ActivTrak", plan: "Work Activity Tracking", perSeat: 1000, basis: "per worker a month, billed annually", source: "https://www.activtrak.com/pricing/" },
  { vendor: "Hubstaff", plan: "Team", perSeat: 1000, basis: "per seat a month, billed annually", source: "https://hubstaff.com/pricing" },
] as const;

export const TEAM_SIZES = [10, 50, 200] as const;
