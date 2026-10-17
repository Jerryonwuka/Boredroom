import { describe, expect, it } from "vitest";
import { FALLBACK_PLANS, limitsSentence, money, planFor, pricingFaq, sameFeatures } from "@/components/marketing/tools/pricing-facts";
import { SOFTWARE_APPLICATION } from "@/lib/marketing/schema";

// The /pricing page's facts (owner request, 17 October 2026: SEO analysis, Content Plan page 15).

describe("pricing facts", () => {
  it("keeps the fallback plans at the SoftwareApplication offers' prices", () => {
    const offers = SOFTWARE_APPLICATION.offers as { name: string; price: string; priceCurrency: string }[];
    for (const o of offers) {
      const p = FALLBACK_PLANS.find((x) => x.name === o.name)!;
      expect(p.monthly_price / 100, o.name).toBe(Number(o.price));
      expect(p.currency).toBe(o.priceCurrency);
    }
  });

  it("formats money as the cards do", () => {
    expect(money(1500, "USD")).toBe("US$15");
    expect(money(1250, "USD")).toBe("US$12.50");
    expect(money(4167, "USD")).toBe("US$41.67");
  });

  it("states limits as numbers", () => {
    expect(limitsSentence(FALLBACK_PLANS[0])).toBe("1 workspace, 5 people per workspace and 2 GB of file storage");
    expect(limitsSentence(FALLBACK_PLANS[1])).toBe("5 workspaces, 50 people per workspace and 150 GB of file storage");
    expect(limitsSentence(FALLBACK_PLANS[2])).toBe("no limit on workspaces, people or storage");
  });

  it("picks the cheapest plan that holds a team in one workspace", () => {
    expect(planFor(FALLBACK_PLANS, 5)?.code).toBe("free");
    expect(planFor(FALLBACK_PLANS, 10)?.code).toBe("pro");
    expect(planFor(FALLBACK_PLANS, 50)?.code).toBe("pro");
    expect(planFor(FALLBACK_PLANS, 200)?.code).toBe("enterprise");
  });

  it("writes the FAQ from the plans", () => {
    const faq = pricingFaq(FALLBACK_PLANS);
    expect(faq.map((f) => f.question)).toEqual([
      "How much does Boredroom cost?", "Is there a free plan?", "Do you charge per person?", "What happens if we add more people?",
      "Is there a free trial?", "Is a productivity score or screen recording on a higher plan?",
    ]);
    expect(faq[0].answer).toContain("Pro is US$15 a month, or US$150 a year, per workspace");
    expect(faq[0].answer).toContain("Enterprise is US$50 a month, or US$500 a year");
    expect(faq[1].answer).toContain("no card needed");
    expect(faq[2].answer).toContain("5 on Free and 50 on Pro, no limit on Enterprise");
    expect(faq[4].answer).toContain("Pro comes with a 3-day free trial and Enterprise comes with a 7-day free trial");
    expect(sameFeatures(FALLBACK_PLANS)).toBe(true);
  });
});
