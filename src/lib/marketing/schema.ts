import { getPage, trailOf, type MarketingPath } from "@/lib/marketing/registry";
import { SITE_NAME, SITE_URL, absoluteUrl, ogImagePath } from "@/lib/marketing/site";

/**
 * Structured data for the public site (owner request, 17 October 2026: SEO analysis, A7 and GEO §15.5). The Organization
 * and SoftwareApplication nodes are the companion artifact's ("JSON-LD: Organization + SoftwareApplication (homepage)")
 * with their @id values, urls and offer prices untouched; its FAQPage is not used: the home page's FAQPage is built from
 * the FAQ the page shows (faqPageJsonLd), so the two always match word for word. Pages add a WebPage (a CollectionPage
 * for a hub, plus a BlogPosting for a post) and a BreadcrumbList from the registry.
 *
 * Rendered server-side by <JsonLd> (components/marketing/json-ld.tsx) with `<` escaped (jsonLdString), so the blocks are
 * in the first HTML and a string in them can never close the script.
 */

export type JsonLdNode = { "@type": string | string[]; "@id"?: string; [key: string]: unknown };
export type JsonLdDocument = { "@context": "https://schema.org"; "@graph": JsonLdNode[] } | ({ "@context": "https://schema.org" } & JsonLdNode);

const ID = {
  organization: `${SITE_URL}/#organization`,
  website: `${SITE_URL}/#website`,
  software: `${SITE_URL}/#software`,
} as const;

/** The companion artifact's Organization, as given. */
export const ORGANIZATION: JsonLdNode = {
  "@type": "Organization",
  "@id": ID.organization,
  name: "Boredroom",
  url: "https://www.boredroom.cc/",
  description: "Boredroom is remote team management software with a personal AI assistant named Brenda for every team member. She answers follow-ups from real work and writes the end-of-day report.",
  logo: { "@type": "ImageObject", url: "https://www.boredroom.cc/brand/logo-on-light.png" },
  sameAs: [],
};

/** The companion artifact's SoftwareApplication, as given: the three plans at their live prices (per workspace, USD). */
export const SOFTWARE_APPLICATION: JsonLdNode = {
  "@type": "SoftwareApplication",
  "@id": ID.software,
  name: "Boredroom",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, macOS, Windows",
  description: "Remote team management software with a personal AI assistant, Brenda, for every person. Attendance, timesheets, consent-based call notes and end-of-day reports. No productivity score, and no screen or call recording.",
  url: "https://www.boredroom.cc/",
  publisher: { "@id": ID.organization },
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: "1 workspace, 5 people per workspace, 2 GB file storage. No card needed." },
    { "@type": "Offer", name: "Pro", price: "15", priceCurrency: "USD", description: "5 workspaces, 50 people per workspace, 150 GB file storage. 3-day free trial." },
    { "@type": "Offer", name: "Enterprise", price: "50", priceCurrency: "USD", description: "Unlimited workspaces, people and storage. 7-day free trial." },
  ],
};

/** The site as a whole (gives search engines the site's name). */
export const WEBSITE: JsonLdNode = {
  "@type": "WebSite",
  "@id": ID.website,
  name: SITE_NAME,
  url: "https://www.boredroom.cc/",
  inLanguage: "en-GB",
  publisher: { "@id": ID.organization },
};

/** A reference to a node by its @id (the Organization, the WebSite, the SoftwareApplication). */
export const ref = (node: JsonLdNode) => ({ "@id": node["@id"] as string });

export type FaqItem = { question: string; answer: string };

/**
 * A FAQPage from the questions and answers a page shows, word for word. `pageUrl` is the page's absolute URL (the home
 * page's gives the companion artifact's id, https://www.boredroom.cc/#faq).
 */
export function faqPageJsonLd(items: readonly FaqItem[], pageUrl: string): JsonLdNode {
  return {
    "@type": "FAQPage",
    "@id": `${pageUrl}#faq`,
    mainEntity: items.map(({ question, answer }) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
  };
}

/** The breadcrumb trail of a registered page as a BreadcrumbList. */
export function breadcrumbJsonLd(path: MarketingPath): JsonLdNode {
  const url = absoluteUrl(path);
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: trailOf(path).map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.label, item: absoluteUrl(p.path) })),
  };
}

/**
 * The home page's graph (A7): Organization, WebSite, SoftwareApplication, the home WebPage and the FAQPage built from the
 * FAQ the page shows.
 */
export function homeJsonLd(faq: readonly FaqItem[]): JsonLdDocument {
  const home = getPage("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORGANIZATION,
      WEBSITE,
      SOFTWARE_APPLICATION,
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/#webpage`,
        url: absoluteUrl("/"),
        name: home.title,
        description: home.description,
        inLanguage: "en-GB",
        isPartOf: ref(WEBSITE),
        about: ref(SOFTWARE_APPLICATION),
        primaryImageOfPage: { "@type": "ImageObject", url: absoluteUrl(ogImagePath("/")), width: 1200, height: 630 },
      },
      faqPageJsonLd(faq, absoluteUrl("/")),
    ],
  };
}

/**
 * A marketing page's graph: its WebPage (CollectionPage for a hub), a BlogPosting for a post, the BreadcrumbList, and
 * the Organization and WebSite it points at (so every reference resolves on the page). `extra` adds the page's own nodes
 * (a tool's WebApplication, the pricing page's offers …).
 */
export function pageJsonLd(path: MarketingPath, extra: readonly JsonLdNode[] = []): JsonLdDocument {
  const page = getPage(path);
  const url = absoluteUrl(path);
  const image = { "@type": "ImageObject", url: absoluteUrl(ogImagePath(path)), width: 1200, height: 630 };
  const productPage = page.kind === "feature" || page.kind === "solution" || page.kind === "usecase" || page.kind === "pricing" || page.kind === "comparison" || page.kind === "download";
  const webPage: JsonLdNode = {
    "@type": page.kind === "hub" ? "CollectionPage" : "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    inLanguage: "en-GB",
    isPartOf: ref(WEBSITE),
    breadcrumb: { "@id": `${url}#breadcrumb` },
    primaryImageOfPage: image,
    dateModified: page.updated,
    ...(productPage ? { about: ref(SOFTWARE_APPLICATION) } : {}),
  };
  const nodes: JsonLdNode[] = [webPage, breadcrumbJsonLd(path), ORGANIZATION, WEBSITE];
  if (productPage) nodes.push(SOFTWARE_APPLICATION);
  if (page.kind === "post") {
    nodes.push({
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      headline: page.h1,
      description: page.description,
      datePublished: page.published ?? page.updated,
      dateModified: page.updated,
      inLanguage: "en-GB",
      image,
      author: ref(ORGANIZATION),
      publisher: ref(ORGANIZATION),
      mainEntityOfPage: { "@id": `${url}#webpage` },
      isPartOf: ref(WEBSITE),
    });
  }
  return { "@context": "https://schema.org", "@graph": [...nodes, ...extra] };
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped so no string can end the script early. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
