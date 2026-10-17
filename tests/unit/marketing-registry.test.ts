import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { NAV, navItemFor } from "@/lib/marketing/nav";
import { pageMetadata } from "@/lib/marketing/metadata";
import { PAGES, childrenOf, getPage, isMarketingPath, relatedOf, trailOf } from "@/lib/marketing/registry";
import { ORGANIZATION, SOFTWARE_APPLICATION, faqPageJsonLd, homeJsonLd, jsonLdString, pageJsonLd } from "@/lib/marketing/schema";
import { ENTITY_SENTENCE, POSITIONING_LINE, POSITIONING_POINTS, absoluteUrl, formatDate } from "@/lib/marketing/site";

// The public site's registry and what is built from it (owner request, 17 October 2026: SEO analysis). The rules are the
// analysis's: every page's target keyword in its title and its H1, a 120–160 character description, a self-referencing
// canonical on the www host, a sitemap of every page, exactly seven nav links, structured data that keeps the companion
// artifact's ids, urls and prices. The writing groups tune their own entries; these tests keep them inside the rules.

const norm = (s: string) => s.toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();

/** Section C's exact URLs, the use-case page and the section pages (Section B). */
const REQUIRED = [
  "/", "/pricing", "/features", "/solutions", "/usecases", "/compare", "/free-tools", "/blog",
  "/blog/end-of-day-report", "/blog/end-of-day-report-template", "/blog/sample-end-of-day-report", "/blog/asynchronous-standup",
  "/blog/remote-work-productivity-statistics", "/compare/employee-monitoring-software", "/compare/boredroom-vs-activtrak",
  "/compare/boredroom-vs-hubstaff", "/compare/boredroom-vs-time-doctor", "/features/ai-assistant", "/solutions/monitoring-without-scores",
  "/features/attendance-timesheets", "/free-tools/work-hours-calculator", "/free-tools/end-of-day-report-generator", "/usecases/team-leads",
];

describe("the page registry", () => {
  it("has every page the analysis asks for, once each", () => {
    const paths = PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of REQUIRED) expect(isMarketingPath(p), p).toBe(true);
  });

  it("keeps paths clean: leading slash, no trailing slash, lower case", () => {
    for (const p of PAGES) expect(p.path === "/" || /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p.path), p.path).toBe(true);
  });

  it.each(PAGES.map((p) => [p.path, p] as const))("%s: keyword in the title and the H1, title ≤ 60, description 120–160", (_, page) => {
    expect(norm(page.title)).toContain(norm(page.keyword));
    expect(norm(page.h1)).toContain(norm(page.keyword));
    expect(page.title.length).toBeLessThanOrEqual(60);
    expect(page.description.length).toBeGreaterThanOrEqual(120);
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.label.length).toBeGreaterThan(0);
    expect(page.summary.length).toBeGreaterThan(0);
    expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (page.published) expect(page.published <= page.updated).toBe(true);
  });

  it("uses the Homepage Fix Sheet's values on the home page", () => {
    const home = getPage("/");
    expect(home.title).toBe("Remote Team Management Software & AI Assistant | Boredroom");
    expect(home.h1).toBe("Remote team management software that knows what your team is doing");
    expect(norm(home.description)).toContain("remote team management software");
  });

  it("links every page to a parent that exists, up to the home page", () => {
    for (const p of PAGES) {
      if (p.path === "/") { expect(p.parent).toBeUndefined(); continue; }
      expect(p.parent && isMarketingPath(p.parent), p.path).toBe(true);
      const trail = trailOf(p.path);
      expect(trail[0].path).toBe("/");
      expect(trail.at(-1)?.path).toBe(p.path);
      expect(trail.length).toBeLessThanOrEqual(3);
    }
  });

  it("gives every hub pages of its own and cross-links that exist", () => {
    const hubs = PAGES.filter((p) => p.kind === "hub");
    expect(hubs.map((h) => h.path).sort()).toEqual(["/blog", "/compare", "/features", "/free-tools", "/solutions", "/usecases"]);
    for (const h of hubs) {
      expect(childrenOf(h.path).length, h.path).toBeGreaterThan(0);
      for (const r of h.related ?? []) expect(isMarketingPath(r), `${h.path} → ${r}`).toBe(true);
      expect(relatedOf(h.path).length).toBe(h.related?.length ?? 0);
    }
  });
});

describe("the nav", () => {
  it("is exactly the seven section links, in order", () => {
    expect(NAV.map((n) => [n.label, n.path])).toEqual([
      ["Features", "/features"], ["Solutions", "/solutions"], ["Use cases", "/usecases"], ["Compare", "/compare"],
      ["Free tools", "/free-tools"], ["Blog", "/blog"], ["Pricing", "/pricing"],
    ]);
    for (const n of NAV) expect(isMarketingPath(n.path)).toBe(true);
  });

  it("knows which section a page is in", () => {
    expect(navItemFor("/blog/end-of-day-report")?.label).toBe("Blog");
    expect(navItemFor("/blog")?.label).toBe("Blog");
    expect(navItemFor("/")).toBeUndefined();
    expect(navItemFor("/blogroll")).toBeUndefined();
  });
});

describe("metadata", () => {
  it("gives the home page the Fix Sheet's canonical, Open Graph and Twitter values", () => {
    const m = pageMetadata("/");
    expect(m.alternates?.canonical).toBe("https://www.boredroom.cc/");
    expect(m.title).toEqual({ absolute: "Remote Team Management Software & AI Assistant | Boredroom" });
    const og = m.openGraph as Record<string, unknown>;
    expect(og.url).toBe("https://www.boredroom.cc/");
    expect(og.type).toBe("website");
    expect((og.images as { url: string; width: number; height: number }[])[0]).toMatchObject({ url: "https://www.boredroom.cc/og", width: 1200, height: 630 });
    expect((m.twitter as Record<string, unknown>).card).toBe("summary_large_image");
  });

  it.each(PAGES.map((p) => [p.path] as const))("%s: a self-referencing absolute canonical on the www host", (path) => {
    const m = pageMetadata(path);
    expect(m.alternates?.canonical).toBe(absoluteUrl(path));
    expect(String(m.alternates?.canonical)).toMatch(/^https:\/\/www\.boredroom\.cc\//);
    const og = m.openGraph as Record<string, unknown>;
    expect(og.url).toBe(absoluteUrl(path));
    expect(og.description).toBe(getPage(path).description);
    expect((og.images as { url: string }[])[0].url.startsWith("https://www.boredroom.cc/og")).toBe(true);
  });
});

describe("sitemap and robots", () => {
  it("lists every registered page on the www host, the home page as https://www.boredroom.cc/", () => {
    const entries = sitemap();
    expect(entries.map((e) => e.url).sort()).toEqual(PAGES.map((p) => absoluteUrl(p.path)).sort());
    expect(entries.map((e) => e.url)).toContain("https://www.boredroom.cc/");
    for (const e of entries) expect(e.url.startsWith("https://www.boredroom.cc/")).toBe(true);
  });

  it("serves robots.txt exactly as the analysis wrote it", () => {
    expect(readFileSync("src/app/robots.txt", "utf8")).toBe("User-agent: *\nAllow: /\nSitemap: https://www.boredroom.cc/sitemap.xml\n");
  });
});

describe("structured data", () => {
  it("keeps the companion artifact's ids, urls and prices", () => {
    expect(ORGANIZATION).toMatchObject({ "@type": "Organization", "@id": "https://www.boredroom.cc/#organization", url: "https://www.boredroom.cc/" });
    expect(String(ORGANIZATION.description).startsWith(ENTITY_SENTENCE)).toBe(true);
    expect(SOFTWARE_APPLICATION).toMatchObject({ "@type": "SoftwareApplication", "@id": "https://www.boredroom.cc/#software", url: "https://www.boredroom.cc/" });
    expect((SOFTWARE_APPLICATION.offers as { name: string; price: string; priceCurrency: string }[]).map((o) => [o.name, o.price, o.priceCurrency]))
      .toEqual([["Free", "0", "USD"], ["Pro", "15", "USD"], ["Enterprise", "50", "USD"]]);
  });

  it("builds the home page's FAQPage from the questions it is given, word for word", () => {
    const faq = [{ question: "Does Boredroom record calls?", answer: "No. Calls are never recorded." }];
    const doc = homeJsonLd(faq) as { "@graph": Record<string, unknown>[] };
    const types = doc["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite", "SoftwareApplication", "WebPage", "FAQPage"]));
    const page = doc["@graph"].find((n) => n["@type"] === "FAQPage")!;
    expect(page["@id"]).toBe("https://www.boredroom.cc/#faq");
    expect(page.mainEntity).toEqual([{ "@type": "Question", name: faq[0].question, acceptedAnswer: { "@type": "Answer", text: faq[0].answer } }]);
    expect(faqPageJsonLd(faq, absoluteUrl("/blog/end-of-day-report"))["@id"]).toBe("https://www.boredroom.cc/blog/end-of-day-report#faq");
  });

  it("gives a post a BlogPosting and every page its breadcrumbs", () => {
    const doc = pageJsonLd("/blog/end-of-day-report") as { "@graph": Record<string, unknown>[] };
    const post = doc["@graph"].find((n) => n["@type"] === "BlogPosting")!;
    expect(post.headline).toBe(getPage("/blog/end-of-day-report").h1);
    const crumbs = doc["@graph"].find((n) => n["@type"] === "BreadcrumbList")!;
    expect((crumbs.itemListElement as { item: string }[]).map((i) => i.item)).toEqual(["https://www.boredroom.cc/", "https://www.boredroom.cc/blog", "https://www.boredroom.cc/blog/end-of-day-report"]);
    const hub = pageJsonLd("/blog") as { "@graph": Record<string, unknown>[] };
    expect(hub["@graph"][0]["@type"]).toBe("CollectionPage");
  });

  it("escapes < so no string can close the script", () => {
    expect(jsonLdString({ a: "</script><script>alert(1)</script>" })).not.toContain("<");
    expect(JSON.parse(jsonLdString({ a: "</script>" }))).toEqual({ a: "</script>" });
  });
});

describe("site helpers", () => {
  it("writes dates the British way", () => {
    expect(formatDate("2026-10-17")).toBe("17 October 2026");
  });

  it("keeps the positioning points the same three facts as the positioning line, in its order (pages v2)", () => {
    expect(POSITIONING_POINTS.map((p) => p.toLowerCase()).join(", ") + ".").toBe(POSITIONING_LINE.toLowerCase());
  });
});
