import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/marketing/nav";
import { MENU_HUBS, MENU_LINE, PAGE_ICON, navMenus, pageIcon } from "@/lib/marketing/menus";
import { PAGES, childrenOf, isMarketingPath, relatedOf } from "@/lib/marketing/registry";
import { splitTitle } from "@/components/marketing/product-hero";

// The notch nav's mega-menus and the pages' icons (owner feedback, 17 October 2026: pages v2). The menus are built from
// the registry, so these hold the rules the build relies on: every page has an icon, every menu path is registered,
// a hub's menu lists every page of the hub in registry order, lines stay short, Blog and Pricing have no menu.

describe("page icons", () => {
  it("gives every public page an icon (the home page borrows one)", () => {
    for (const p of PAGES) expect(pageIcon(p.path), p.path).toBeTruthy();
    const paths = Object.keys(PAGE_ICON);
    for (const p of paths) expect(isMarketingPath(p), p).toBe(true);
    expect(paths.length).toBe(PAGES.length - 1);
  });
});

describe("the mega-menus", () => {
  const menus = navMenus();

  it("are Features, Solutions, Use cases, Compare and Free tools, in the nav's order and with its labels", () => {
    expect(menus.map((m) => [m.label, m.hub])).toEqual(NAV.filter((n) => (MENU_HUBS as readonly string[]).includes(n.path)).map((n) => [n.label, n.path]));
    expect(menus.map((m) => m.hub)).not.toContain("/blog");
    expect(menus.map((m) => m.hub)).not.toContain("/pricing");
  });

  it("list every page of the hub, in registry order, and only registered pages", () => {
    for (const m of menus) {
      expect(m.items.map((i) => i.path), m.hub).toEqual(childrenOf(m.hub).map((p) => p.path));
      for (const i of m.items) {
        expect(isMarketingPath(i.path)).toBe(true);
        expect(i.label.length).toBeGreaterThan(0);
        expect(i.icon).toBe(pageIcon(i.path));
      }
      for (const r of m.related) expect(relatedOf(m.hub).map((p) => p.path)).toContain(r.path);
      expect(m.seeAll).toMatch(/^See all /);
      expect(m.summary.length).toBeGreaterThan(0);
    }
  });

  it("give every page a one-line description of 46 characters at most, with no em dashes", () => {
    for (const m of menus) for (const i of m.items) {
      expect(MENU_LINE[i.path], i.path).toBeDefined();
      expect(i.line.length, i.path).toBeLessThanOrEqual(46);
      expect(i.line).not.toContain("—");
    }
  });

  it("show the hub's related pages only in a menu with fewer than three pages", () => {
    for (const m of menus) {
      if (m.items.length >= 3) expect(m.related, m.hub).toEqual([]);
      else expect(m.related.length, m.hub).toBeGreaterThan(0);
    }
  });

  it("never link a hub from inside a menu other than through its own See all link", () => {
    const hubs = new Set(NAV.map((n) => n.path as string));
    for (const m of menus) {
      for (const i of m.items) expect(hubs.has(i.path), i.path).toBe(false);
      for (const r of m.related) expect(hubs.has(r.path), r.path).toBe(false);
    }
  });
});

describe("the two-tone H1", () => {
  it("splits once at the first colon or question mark and keeps the text byte for byte", () => {
    for (const p of PAGES) {
      const { head, rest } = splitTitle(p.h1);
      expect(rest ? `${head} ${rest}` : head, p.path).toBe(p.h1);
    }
    expect(splitTitle("What is an end-of-day report? A complete guide")).toEqual({ head: "What is an end-of-day report?", rest: "A complete guide" });
    expect(splitTitle("Work hours calculator: hours, breaks and overtime")).toEqual({ head: "Work hours calculator:", rest: "hours, breaks and overtime" });
    expect(splitTitle("Use cases for remote teams")).toEqual({ head: "Use cases for remote teams", rest: "" });
  });
});
