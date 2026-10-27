/**
 * Claude list prices, for the Control Center's AI usage estimate (owner request, 27 October 2026: "see which company is
 * spending more tokens … so we can manage AI usage"). The ONE place prices live: edit this table when Anthropic's prices
 * change or a new model is used. US dollars per million tokens, Anthropic's first-party list prices as of PRICES_AS_OF;
 * cache writes at the 5-minute rate (1.25 × input), cache reads as Anthropic lists them.
 *
 * It is an estimate, and every screen says so: Anthropic's invoice is the real figure (discounts, the 1-hour cache rate,
 * batch or fast mode and the long-context rates of some models are not modelled).
 */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const PRICES_AS_OF = "6 October 2026";

export const CLAUDE_PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** A model the table does not name is priced as the default model (Boredroom's ASSISTANT_MODEL default). */
export const FALLBACK_PRICE_MODEL = "claude-opus-5-5";

/**
 * The price for a model as the API reported it: exact, else the longest table name it starts with (a dated or suffixed
 * id), else its family's current model (opus, sonnet, haiku), else the default. `exact`: false when it was guessed.
 */
export function priceFor(model: string): { price: ModelPrice; exact: boolean; as: string } {
  const m = model.trim().toLowerCase();
  if (CLAUDE_PRICES_USD_PER_MTOK[m]) return { price: CLAUDE_PRICES_USD_PER_MTOK[m], exact: true, as: m };
  const prefix = Object.keys(CLAUDE_PRICES_USD_PER_MTOK).filter((k) => m.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  if (prefix) return { price: CLAUDE_PRICES_USD_PER_MTOK[prefix], exact: true, as: prefix };
  const family = m.includes("haiku") ? "claude-haiku-5-5" : m.includes("sonnet") ? "claude-sonnet-5-5" : FALLBACK_PRICE_MODEL;
  return { price: CLAUDE_PRICES_USD_PER_MTOK[family], exact: false, as: family };
}

export type TokenCounts = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** Estimated US dollars for these tokens on this model. */
export function estimateUsd(model: string, t: TokenCounts): number {
  const { price } = priceFor(model);
  return (t.inputTokens * price.input + t.outputTokens * price.output + t.cacheReadTokens * price.cacheRead + t.cacheWriteTokens * price.cacheWrite) / 1_000_000;
}

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** "$12.34", "$0.72"; under a cent with up to four decimals ("$0.0042"), and "$0.00" for nothing. */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return usd2.format(0);
  return v < 0.01 ? usd4.format(v) : usd2.format(v);
}
