import type { Source } from "@/components/marketing/blocks";

/**
 * The facts behind the comparison pages (owner request, 17 October 2026: SEO analysis, Content Plan pages 6 to 9).
 *
 * The rule (build spec D18): every fact about another product comes from that vendor's own pages (pricing, help centre),
 * read on the date in `AS_OF`, and each one names its source here so the tables and the "Sources" list stay in step. No
 * reviews, ratings, customer counts or quotes from anyone else. Where a vendor's page did not say something, the cell says
 * so ("not listed on its pricing page") rather than guessing. Boredroom's own facts come from the product (the landing
 * page's FAIR list and FAQ, the standard monitoring notice in src/server/services/orgs.ts, desktop/README.md and the live
 * plans table), never from the marketing wish list.
 *
 * When a vendor changes its prices, update the numbers here, move `AS_OF`, and bump `updated` for the four pages in
 * src/lib/marketing/pages/compare.ts.
 */

/** The day every competitor fact on the comparison pages was read from the vendor's own site. */
export const AS_OF = "2026-10-17";

const src = (s: Omit<Source, "asOf">): Source => ({ ...s, asOf: AS_OF });

/** Each source once; the pages and tables refer to them by key. */
export const SOURCES = {
  activtrakPricing: src({ title: "ActivTrak Pricing", publisher: "ActivTrak", url: "https://www.activtrak.com/pricing/" }),
  activtrakData: src({ title: "What Data Does ActivTrak Collect?", publisher: "ActivTrak Help Center", url: "https://support.activtrak.com/hc/en-us/articles/360050977352-What-Data-Does-ActivTrak-Collect", published: "updated 31 August 2026" }),
  activtrakGlossary: src({ title: "Insights Data Glossary", publisher: "ActivTrak Help Center", url: "https://support.activtrak.com/hc/en-us/articles/360058644472-Insights-Data-Glossary", published: "updated 31 August 2026" }),
  hubstaffPricing: src({ title: "Hubstaff Pricing Plans", publisher: "Hubstaff", url: "https://hubstaff.com/pricing" }),
  hubstaffActivity: src({ title: "How are Activity Levels Calculated in Hubstaff Time Tracking?", publisher: "Hubstaff Help Center", url: "https://support.hubstaff.com/how-are-activity-levels-calculated/" }),
  hubstaffTracking: src({ title: "How is Time Tracked and Calculated in Hubstaff?", publisher: "Hubstaff Help Center", url: "https://support.hubstaff.com/how-is-time-tracked-and-calculated-in-hubstaff/" }),
  hubstaffScreenshots: src({ title: "How to Change Screenshot Frequency", publisher: "Hubstaff Help Center", url: "https://support.hubstaff.com/change-screenshot-frequency/" }),
  hubstaffBlur: src({ title: "Screenshot Blur in Hubstaff", publisher: "Hubstaff Help Center", url: "https://support.hubstaff.com/screenshot-blur/" }),
  timedoctorPricing: src({ title: "Time Doctor pricing plans", publisher: "Time Doctor", url: "https://www.timedoctor.com/pricing" }),
  timedoctorTracks: src({ title: "What Does Time Doctor Track on My Computer?", publisher: "Time Doctor Help Center", url: "https://support.timedoctor.com/knowledge/what-does-time-doctor-monitor-on-my-computer", published: "11 September 2025" }),
  timedoctorRatings: src({ title: "How to Manage Productivity Ratings for Websites and Apps in Time Doctor", publisher: "Time Doctor Help Center", url: "https://support.timedoctor.com/knowledge/how-to-manage-productivity-ratings-for-websites-and-apps-in-time-doctor", published: "updated 30 March 2026" }),
  timedoctorUsers: src({ title: "Insights Regular Users Can Get From Time Doctor Reports", publisher: "Time Doctor Help Center", url: "https://support.timedoctor.com/knowledge/what-insights-can-regular-users-get-from-time-doctor-reports", published: "16 September 2025" }),
  timedoctorScreenshots: src({ title: "Changing Time Doctor Screenshot Settings", publisher: "Time Doctor Help Center", url: "https://help.timedoctor.com/changing-time-doctor-screenshot-settings", published: "26 November 2025" }),
  timedoctorDeleting: src({ title: "Viewing and Deleting Screenshots in Time Doctor", publisher: "Time Doctor Help Center", url: "https://help.timedoctor.com/viewing-and-deleting-screenshots-in-time-doctor", published: "26 November 2025" }),
  workstatusPricing: src({ title: "Workstatus Pricing", publisher: "Workstatus", url: "https://www.workstatus.io/pricing", note: "Prices read from the page's own pricing data (US dollars), as its visible dollar figures did not render correctly on the day." }),
  controlioPricing: src({ title: "Controlio Pricing & Plans", publisher: "Controlio", url: "https://controlio.net/prices.html" }),
  controlioHome: src({ title: "Computer Monitoring Software for Business", publisher: "Controlio", url: "https://controlio.net/" }),
  icoMonitoring: src({ title: "Data protection and monitoring workers", publisher: "Information Commissioner's Office (UK)", url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/data-protection-and-monitoring-workers/" }),
  icoOverview: src({ title: "Employment practices and data protection: monitoring workers", publisher: "Information Commissioner's Office (UK)", url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/", note: "The ICO says this guidance is under review after the Data (Use and Access) Act." }),
  boredroomPricing: src({ title: "Remote team management software pricing", publisher: "Boredroom", url: "https://www.boredroom.cc/pricing" }),
} as const satisfies Record<string, Source>;

export type SourceKey = keyof typeof SOURCES;

/** The sources a page cites, in the order given, each once. */
export const sourcesFor = (keys: readonly SourceKey[]): Source[] => [...new Set(keys)].map((k) => SOURCES[k]);

export type ToolId = "boredroom" | "activtrak" | "hubstaff" | "timedoctor" | "workstatus" | "controlio";

/**
 * The comparison's criteria, the same on the hub and on every head-to-head (the Content Plan: "the same columns used on
 * the hub page, so the two pages are consistent").
 */
export const CRITERIA = [
  { key: "screen", label: "Screen recording and screenshots" },
  { key: "score", label: "Productivity score or rating" },
  { key: "calls", label: "Call recording" },
  { key: "consent", label: "Consent and visibility" },
  { key: "time", label: "Attendance and timesheets" },
  { key: "ai", label: "AI assistant" },
  { key: "pricing", label: "Pricing model" },
  { key: "free", label: "Free plan or trial" },
  { key: "bestFor", label: "Best for" },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

export type Tool = {
  id: ToolId;
  name: string;
  /** The vendor's home page, for the first mention. */
  site: string;
  /** A few words per criterion, for the hub's table (scannable across six tools). */
  short: Record<CriterionKey, string>;
  /** The full answer per criterion, for the head-to-head tables and the text. */
  cells: Record<CriterionKey, string>;
  /** Where the cells came from. */
  sources: readonly SourceKey[];
};

export const TOOLS: Record<ToolId, Tool> = {
  boredroom: {
    id: "boredroom",
    name: "Boredroom",
    site: "https://www.boredroom.cc/",
    short: { screen: "None", score: "None", calls: "Never recorded; notes only with consent", consent: "The person starts their timer; the notice is in every profile", time: "Schedule, lateness by the minute, confirmed timesheets", ai: "Brenda, one for every person", pricing: "Per workspace", free: "Free plan, up to 5 people", bestFor: "Remote teams that don't want to watch anyone" },
    cells: {
      screen: "None. Screens are never recorded and no screenshots are taken for anyone to review. A person shares a screen on a call only when they choose to, and Brenda for Mac looks at a screen only when its owner asks, keeping nothing.",
      score: "None. Reports give plain counts and nobody is ranked.",
      calls: "Never. Brenda's call notes are taken only for the people who choose Include me, on their own device; the transcript is deleted 7 days after the recap.",
      consent: "Timers run only when the person starts them, and everyone can read the monitoring notice in their profile.",
      time: "Clock-ins against your schedule with a grace period, late arrivals by the minute, and timesheets of confirmed time with approved corrections and CSV export.",
      ai: "Brenda, a personal AI assistant for every person, on every plan. She writes each lead's end-of-day report.",
      pricing: "Per workspace, not per person: Pro $15 a month for up to 50 people, Enterprise $50 a month, unlimited.",
      free: "Free plan: 1 workspace, up to 5 people, no card. Pro has a 3-day trial, Enterprise 7 days.",
      bestFor: "Remote teams that want to know what is happening without watching anyone.",
    },
    sources: ["boredroomPricing"],
  },
  activtrak: {
    id: "activtrak",
    name: "ActivTrak",
    site: "https://www.activtrak.com/",
    short: { screen: "Screenshots and live view (add-on)", score: "Yes: productive hours against a goal", calls: "No calling feature listed", consent: "Employer-installed agent; silent deployment", time: "Attendance and schedule adherence", ai: "Work Advisor, for managers", pricing: "Per worker, annual only", free: "Free plan, up to 3 people", bestFor: "Workforce analytics" },
    cells: {
      screen: "No video recording listed. Screenshots (taken when an alarm triggers) and live screen view come with the Screen Details add-on, off by default.",
      score: "Yes: apps and sites are classed productive or unproductive, and reports show productive hours a day against a goal (7 hours by default) and a Productivity Efficiency %.",
      calls: "No calling feature listed on its pricing page. Offline meeting time is read from the Outlook or Google calendar.",
      consent: "The employer installs an agent on work computers; silent deployment is available. Keystrokes and webcams are never collected.",
      time: "Automatic time tracking, attendance and schedule adherence from the $10 plan. Timesheet reconciliation through the ActivConnect add-on.",
      ai: "Work Advisor answers managers' questions about the data (from the $15 plan); the AI Insights add-on measures AI tool use. No assistant for each employee.",
      pricing: "Per worker, billed annually only: $10, $15, $17 or $21 a month.",
      free: "Free plan for up to 3 people with 30 days of history; 14-day trial of the paid bundle.",
      bestFor: "Organisations that want workforce analytics: utilisation, schedule adherence, technology and AI use.",
    },
    sources: ["activtrakPricing", "activtrakData", "activtrakGlossary"],
  },
  hubstaff: {
    id: "hubstaff",
    name: "Hubstaff",
    site: "https://hubstaff.com/",
    short: { screen: "Screenshots, up to 3 per 10 minutes", score: "Activity levels (%)", calls: "No calling feature listed", consent: "Tracks between Start and Stop; Silent app optional", time: "Timesheets; scheduling on Team", ai: "No assistant per person; AI unusual-activity detection (Insights)", pricing: "Per seat, 2-seat minimum", free: "14-day trial", bestFor: "Hourly work, proof of hours, payroll" },
    cells: {
      screen: "Screenshots 1, 2 or 3 times every 10 minutes while the timer runs (up to 10 with an add-on), blurrable on paid plans or turned off. No video recording listed.",
      score: "Activity levels: the share of each 10 minutes with keyboard or mouse input. The Insights add-on adds unproductive apps and URLs and a team leaderboard.",
      calls: "No calling feature listed on its pricing page.",
      consent: "Tracks only between Start and Stop in its app. The Silent app tracks in the background on company-owned devices (Enterprise, or an add-on).",
      time: "Timesheets on every plan; scheduling, payments and payroll on Team.",
      ai: "No assistant for each person listed on its pricing page.",
      pricing: "Per seat, 2-seat minimum: $7, $9 or $12 a month billed monthly; $4.99, $7.50 or $10 billed annually; Enterprise $25, annual.",
      free: "14-day trial, no card. No free plan; report viewers can have the free Project Viewer role.",
      bestFor: "Teams that bill or pay by the hour and want proof of hours, timesheets and payroll in one tool.",
    },
    sources: ["hubstaffPricing", "hubstaffActivity", "hubstaffTracking", "hubstaffScreenshots", "hubstaffBlur"],
  },
  timedoctor: {
    id: "timedoctor",
    name: "Time Doctor",
    site: "https://www.timedoctor.com/",
    short: { screen: "Screenshots; video on Premium", score: "Productivity ratings", calls: "No calling feature listed", consent: "Background or interactive, the employer's choice", time: "Attendance, approvals, leave, payroll", ai: "Benchmarks AI (Premium)", pricing: "Per user", free: "14-day trial", bestFor: "Detailed time and activity tracking" },
    cells: {
      screen: "Screenshots on every plan, every 3 to 30 minutes as the admin sets. Video screen recording on Premium, or as an add-on.",
      score: "Productivity ratings: admins rate each site and app Productive, Unproductive or Neutral (Standard plan and up).",
      calls: "No calling feature listed on its pricing page. Meeting Insights reports time spent in meetings (Premium, or an add-on).",
      consent: "The employer chooses automatic tracking in the background or the interactive app the person starts. Keystrokes are not recorded.",
      time: "Attendance, schedules, time approvals, leave and break tracking, and payroll on Standard and up.",
      ai: "Benchmarks AI and an Unusual Activity AI report on Premium. No assistant for each employee.",
      pricing: "Per user: $8, $14 or $20 a month billed monthly; $6.67, $11.67 or $16.70 billed annually; Enterprise custom.",
      free: "14-day trial of Premium, no card. No free plan listed.",
      bestFor: "Companies that want detailed time and activity tracking, with screenshots, ratings, attendance and payroll.",
    },
    sources: ["timedoctorPricing", "timedoctorTracks", "timedoctorRatings", "timedoctorScreenshots"],
  },
  workstatus: {
    id: "workstatus",
    name: "Workstatus",
    site: "https://www.workstatus.io/",
    short: { screen: "Screenshots; session replay add-on", score: "Activity and productivity reports", calls: "No calling feature listed", consent: "Self-view on by default; silent deployment", time: "Timesheets, shifts, leave, payroll exports", ai: "None listed", pricing: "Per user", free: "14-day trial", bestFor: "Service businesses tracking profit" },
    cells: {
      screen: "Configurable screenshots with blur. Session replay with the Recording and QA add-on ($7 to $25 per user a month).",
      score: "Activity and productivity reports, idle time detection.",
      calls: "No calling feature listed on its pricing page.",
      consent: "Employee self-view is on by default; silent deployment is available.",
      time: "Timesheet grids with manager approval, shift scheduling, leave, PTO and overtime, payroll exports.",
      ai: "No assistant for each person listed on its pricing page.",
      pricing: "Per user: Proof $9 and Profit $16 a month billed monthly; $7 and $13 billed annually.",
      free: "14-day trial, no card.",
      bestFor: "Service businesses that want time, attendance, projects and profitability in one place.",
    },
    sources: ["workstatusPricing"],
  },
  controlio: {
    id: "controlio",
    name: "Controlio",
    site: "https://controlio.net/",
    short: { screen: "Live stream and video recording", score: "Productivity summary per person", calls: "No calling feature listed", consent: "Optional stealth mode", time: "Clocking and attendance", ai: "AI activity categorisation", pricing: "Per user, 5-user minimum", free: "14-day trial", bestFor: "Security-grade monitoring" },
    cells: {
      screen: "Screen live stream and video recording from the Basic plan (optional).",
      score: "Productivity summary per person, with AI-based categorisation of activities.",
      calls: "No calling feature listed on its pricing page.",
      consent: "An optional stealth mode makes the agent invisible to the person. Keystroke and email monitoring are optional.",
      time: "Clocking and attendance, working hours breakdown.",
      ai: "AI-based activity categorisation; no assistant for each person.",
      pricing: "Per user, 5-user minimum: $7.99 or $11.99 a month billed monthly; $6.67 or $9.99 billed annually.",
      free: "14-day trial.",
      bestFor: "Organisations that need security-grade monitoring, including on-premises installation.",
    },
    sources: ["controlioPricing", "controlioHome"],
  },
};

/** The order the hub lists the tools in: the three head-to-heads first, Boredroom last (it is our page; the reader decides). */
export const HUB_ORDER: readonly ToolId[] = ["activtrak", "hubstaff", "timedoctor", "workstatus", "controlio", "boredroom"];

/** One way of paying for a tool, for the cost tables. */
export type Plan = {
  tool: ToolId;
  /** "Team plan, billed annually". */
  label: string;
  /** Per person per month in USD; Boredroom has none (it is per workspace). */
  perPerson?: number;
  /** The smallest number of seats the vendor sells. */
  minimum?: number;
  /** The price for a team of `n` people, per month in USD, when the plan has a rule of its own (Boredroom). */
  team?: (n: number) => number | null;
  note?: string;
};

/**
 * Boredroom's live plans (USD, per workspace): Free up to 5 people, Pro $15 a month ($150 a year) up to 50 people per
 * workspace, Enterprise $50 a month ($500 a year) with no limit. One workspace for the whole team.
 */
export const boredroomMonthly = (n: number) => (n <= 5 ? 0 : n <= 50 ? 15 : 50);
export const boredroomAnnualPerMonth = (n: number) => (n <= 5 ? 0 : n <= 50 ? 150 / 12 : 500 / 12);

export const PLANS = {
  boredroomMonthly: { tool: "boredroom", label: "Boredroom, billed monthly", team: boredroomMonthly, note: "Free up to 5 people, Pro up to 50, Enterprise above that; one workspace." },
  boredroomAnnual: { tool: "boredroom", label: "Boredroom, billed yearly", team: boredroomAnnualPerMonth, note: "Pro $150 a year, Enterprise $500 a year." },
  activtrakTracking: { tool: "activtrak", label: "ActivTrak Work Activity Tracking (annual only)", perPerson: 10, note: "ActivTrak requires a paid support plan above 50 licences; its price is not published." },
  activtrakWorkforce: { tool: "activtrak", label: "ActivTrak Workforce Management (annual only)", perPerson: 15 },
  activtrakOptimisation: { tool: "activtrak", label: "ActivTrak Productivity Optimization (annual only)", perPerson: 17 },
  hubstaffStarterAnnual: { tool: "hubstaff", label: "Hubstaff Starter, billed annually", perPerson: 4.99, minimum: 2 },
  hubstaffStarterMonthly: { tool: "hubstaff", label: "Hubstaff Starter, billed monthly", perPerson: 7, minimum: 2 },
  hubstaffTeamMonthly: { tool: "hubstaff", label: "Hubstaff Team, billed monthly", perPerson: 12, minimum: 2 },
  hubstaffTeamAnnual: { tool: "hubstaff", label: "Hubstaff Team, billed annually", perPerson: 10, minimum: 2 },
  timedoctorBasicAnnual: { tool: "timedoctor", label: "Time Doctor Basic, billed annually", perPerson: 6.67 },
  timedoctorStandardMonthly: { tool: "timedoctor", label: "Time Doctor Standard, billed monthly", perPerson: 14 },
  timedoctorStandardAnnual: { tool: "timedoctor", label: "Time Doctor Standard, billed annually", perPerson: 11.67 },
  timedoctorBasicMonthly: { tool: "timedoctor", label: "Time Doctor Basic, billed monthly", perPerson: 8 },
  timedoctorPremiumAnnual: { tool: "timedoctor", label: "Time Doctor Premium, billed annually", perPerson: 16.7 },
  timedoctorPremiumMonthly: { tool: "timedoctor", label: "Time Doctor Premium, billed monthly", perPerson: 20 },
  workstatusProof: { tool: "workstatus", label: "Workstatus Proof, billed annually", perPerson: 7 },
  controlioBasicAnnual: { tool: "controlio", label: "Controlio Basic, billed annually", perPerson: 6.67, minimum: 5 },
} as const satisfies Record<string, Plan>;

export type PlanKey = keyof typeof PLANS;

/** The team sizes the Content Plan asks for. */
export const TEAM_SIZES = [10, 50, 200] as const;

/** A plan's monthly cost for `n` people, in USD (null when the plan cannot hold them). */
export function monthlyCost(plan: Plan, n: number): number | null {
  if (plan.team) return plan.team(n);
  if (plan.perPerson === undefined) return null;
  return plan.perPerson * Math.max(n, plan.minimum ?? 0);
}

/** "$1,334" or "$12.50": whole dollars without pence, otherwise two places. */
export function usd(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}
