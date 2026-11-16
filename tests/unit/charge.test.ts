/**
 * Dollar prices paid in naira (owner decision, 16 November 2026): the rule comes from the billing settings, applies to
 * dollar plans only, and charges a whole unit.
 */
import { describe, expect, it } from "vitest";
import { chargeFor, chargeRule } from "@/lib/charge";

describe("dollar prices charged in another currency", () => {
  it("no rule without both a currency and a rate, and never a rule into dollars", () => {
    expect(chargeRule(null)).toBeNull();
    expect(chargeRule({})).toBeNull();
    expect(chargeRule({ charge_currency: "NGN", usd_rate: 0 })).toBeNull();
    expect(chargeRule({ charge_currency: "", usd_rate: 1600 })).toBeNull();
    expect(chargeRule({ charge_currency: "USD", usd_rate: 1 })).toBeNull();
    expect(chargeRule({ charge_currency: "naira", usd_rate: 1600 })).toBeNull();
    expect(chargeRule({ charge_currency: " ngn ", usd_rate: 1600 })).toEqual({ currency: "NGN", usdRate: 1600 });
  });

  it("a dollar price is charged at the rate, in minor units, rounded to a whole unit", () => {
    const rule = { currency: "NGN", usdRate: 1600 };
    expect(chargeFor(1500, "USD", rule)).toEqual({ amount: 2_400_000, currency: "NGN", converted: true }); // $15 is ₦24,000
    expect(chargeFor(1167, "usd", { currency: "NGN", usdRate: 1587.35 })).toEqual({ amount: 1_852_400, currency: "NGN", converted: true }); // ₦18,524.37 charged as ₦18,524
  });

  it("without a rule, for a plan in another currency, and for a free plan, the price is charged as it is", () => {
    expect(chargeFor(1500, "USD", null)).toEqual({ amount: 1500, currency: "USD", converted: false });
    expect(chargeFor(1_500_000, "NGN", { currency: "NGN", usdRate: 1600 })).toEqual({ amount: 1_500_000, currency: "NGN", converted: false });
    expect(chargeFor(900, "GBP", { currency: "NGN", usdRate: 1600 })).toEqual({ amount: 900, currency: "GBP", converted: false });
    expect(chargeFor(0, "USD", { currency: "NGN", usdRate: 1600 })).toEqual({ amount: 0, currency: "USD", converted: false });
  });
});
