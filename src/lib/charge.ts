/**
 * Dollar prices, paid in naira (owner decision, 16 November 2026: the Paystack account takes naira only, and the prices
 * stay in US dollars). The Control Center's Billing settings hold the currency charged and how many of it one US dollar
 * costs. A plan priced in dollars is shown in dollars everywhere and charged at that rate, rounded to a whole unit; the
 * amount charged is shown beside the price before the person pays. A plan priced in any other currency is charged as it is.
 */
export type ChargeRule = { currency: string; usdRate: number };

/** The rule in the stored billing settings, or null when prices are charged as they are. */
export function chargeRule(s: { charge_currency?: unknown; usd_rate?: unknown } | null | undefined): ChargeRule | null {
  const currency = typeof s?.charge_currency === "string" ? s.charge_currency.trim().toUpperCase() : "";
  const usdRate = Number(s?.usd_rate);
  return /^[A-Z]{3}$/.test(currency) && currency !== "USD" && Number.isFinite(usdRate) && usdRate > 0 ? { currency, usdRate } : null;
}

/** What a price is charged as: minor units in, minor units out. `converted` says the rule was used. */
export function chargeFor(amountMinor: number, planCurrency: string, rule: ChargeRule | null): { amount: number; currency: string; converted: boolean } {
  const currency = planCurrency.toUpperCase();
  if (!rule || currency !== "USD" || amountMinor <= 0) return { amount: amountMinor, currency, converted: false };
  return { amount: Math.round((amountMinor * rule.usdRate) / 100) * 100, currency: rule.currency, converted: true };
}
