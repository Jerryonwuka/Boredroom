import { NAV } from "@/lib/marketing/nav";
import { childrenOf, getPage, relatedOf, type MarketingPath } from "@/lib/marketing/registry";

/**
 * The notch nav's mega-menus and every page's icon (owner feedback, 17 October 2026: pages v2: "dropdown mega-menus
 * like Worktivity's", opening on hover). Pure and server-safe: `SiteNav` (a server component) calls `navMenus()` and
 * hands the client nav only this slim data (paths, labels, one-line descriptions, icon names), never the registry's
 * copy. A page's menu line is drafted from its own registry summary and claims nothing the page does not.
 *
 * tests/unit/marketing-menus.test.ts holds the rules: every page has an icon (a new page is a type error until it
 * does), every menu path is registered, a hub's menu lists every page of the hub, lines are 46 characters at most.
 */

/** The icons a page can carry (components/marketing/page-icon.tsx draws them, with the animated twin where one exists). */
export type PageIconName =
  | "brenda" | "calendar-check" | "video" | "file-text" | "shield-check" | "message-square-reply" | "list-checks" | "users-round"
  | "layout-grid" | "scale" | "timer" | "clipboard-list" | "copy" | "clipboard-check" | "messages-square" | "chart-column" | "credit-card";

/** Every public page's icon (the home page has none): the menus, the index cards and the related cards use it. */
export const PAGE_ICON: Record<Exclude<MarketingPath, "/">, PageIconName> = {
  "/features": "layout-grid",
  "/features/ai-assistant": "brenda",
  "/features/attendance-timesheets": "calendar-check",
  "/features/call-notes": "video",
  "/features/end-of-day-report": "file-text",
  "/solutions": "shield-check",
  "/solutions/monitoring-without-scores": "shield-check",
  "/solutions/stop-chasing-updates": "message-square-reply",
  "/solutions/fewer-status-meetings": "list-checks",
  "/usecases": "users-round",
  "/usecases/team-leads": "users-round",
  "/compare": "scale",
  "/compare/employee-monitoring-software": "layout-grid",
  "/compare/boredroom-vs-activtrak": "scale",
  "/compare/boredroom-vs-hubstaff": "scale",
  "/compare/boredroom-vs-time-doctor": "scale",
  "/free-tools": "timer",
  "/free-tools/work-hours-calculator": "timer",
  "/free-tools/end-of-day-report-generator": "clipboard-list",
  "/blog": "file-text",
  "/blog/end-of-day-report": "file-text",
  "/blog/end-of-day-report-template": "copy",
  "/blog/sample-end-of-day-report": "clipboard-check",
  "/blog/asynchronous-standup": "messages-square",
  "/blog/remote-work-productivity-statistics": "chart-column",
  "/pricing": "credit-card",
  "/download": "brenda",
};

/** The icon of a page (the home page borrows the features grid's). */
export function pageIcon(path: MarketingPath): PageIconName {
  return path === "/" ? "layout-grid" : PAGE_ICON[path];
}

/** One line under each page's name in its menu (46 characters at most; from the page's own summary, true as built). */
export const MENU_LINE: Partial<Record<MarketingPath, string>> = {
  "/features/ai-assistant": "Brenda, one for every person",
  "/features/attendance-timesheets": "Clock-ins, late arrivals, confirmed hours",
  "/features/call-notes": "Calls, with notes only for people who say yes",
  "/features/end-of-day-report": "Written by Brenda for every lead",
  "/solutions/monitoring-without-scores": "See the work without scores or recordings",
  "/solutions/stop-chasing-updates": "The work answers “any update?”",
  "/solutions/fewer-status-meetings": "Standups drafted from the work",
  "/usecases/team-leads": "Updates without chasing, one daily report",
  "/compare/employee-monitoring-software": "Six tools on the same nine questions",
  "/compare/boredroom-vs-activtrak": "Scores, screen capture and price",
  "/compare/boredroom-vs-hubstaff": "Time tracking, screenshots and timesheets",
  "/compare/boredroom-vs-time-doctor": "Monitoring and what employees see",
  "/free-tools/work-hours-calculator": "Hours, breaks and overtime",
  "/free-tools/end-of-day-report-generator": "A clear report from a few bullet points",
};

/** The foot link of each menu ("See all features"); its words differ from every content link to the hub. */
const SEE_ALL: Partial<Record<MarketingPath, string>> = {
  "/features": "See all features",
  "/solutions": "See all solutions",
  "/usecases": "See all use cases",
  "/compare": "See all comparisons",
  "/free-tools": "See all free tools",
};

export type NavMenuItem = { path: MarketingPath; label: string; line: string; icon: PageIconName };
export type NavMenu = {
  /** The hub the menu belongs to (its nav link). */
  hub: MarketingPath;
  /** The nav label ("Features"). */
  label: string;
  /** The hub's one-line summary from the registry (the panel's intro column). */
  summary: string;
  /** "See all features". */
  seeAll: string;
  items: NavMenuItem[];
  /** The hub's cross-links, shown in the foot of a menu with fewer than three items. */
  related: { path: MarketingPath; label: string }[];
};

/** The sections that open a menu, in NAV order; Blog and Pricing stay plain links. */
export const MENU_HUBS = ["/features", "/solutions", "/usecases", "/compare", "/free-tools"] as const satisfies readonly MarketingPath[];

/** The menus for the notch nav, in NAV order: each hub's own pages (from the registry, so a new page appears at once). */
export function navMenus(): NavMenu[] {
  const hubs = new Set<string>(MENU_HUBS);
  return NAV.filter((n) => hubs.has(n.path)).map((n) => {
    const hub = n.path as (typeof MENU_HUBS)[number];
    const items = childrenOf(hub).map((p) => ({ path: p.path, label: p.label, line: MENU_LINE[p.path] ?? p.summary, icon: pageIcon(p.path) }));
    return {
      hub,
      label: n.label,
      summary: getPage(hub).summary,
      seeAll: SEE_ALL[hub] ?? `See all ${n.label.toLowerCase()}`,
      items,
      related: items.length < 3 ? relatedOf(hub).slice(0, 2).map((p) => ({ path: p.path, label: p.label })) : [],
    };
  });
}
