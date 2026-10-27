/**
 * The Control Center's AI cost estimate (owner request, 27 October 2026): one price table, list prices per million tokens,
 * a model it does not name priced as its family's current model and flagged.
 */
import { describe, expect, it } from "vitest";
import { CLAUDE_PRICES_USD_PER_MTOK, estimateUsd, formatUsd, priceFor } from "@/lib/ai-pricing";
import { periodStart } from "@/server/admin/ai-usage";

describe("the price table", () => {
  it("prices every model Boredroom uses", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5"]) expect(priceFor(m)).toMatchObject({ exact: true, as: m });
    expect(CLAUDE_PRICES_USD_PER_MTOK["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
  });

  it("estimates each kind of token at its own rate", () => {
    const t = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    expect(estimateUsd("claude-opus-5-5", t)).toBeCloseTo(4 + 20 + 0.2 + 5);
    expect(estimateUsd("claude-haiku-5-5", { ...t, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.1);
    expect(estimateUsd("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });

  it("an unknown model: a suffixed id is its base, otherwise its family, otherwise the default, and says it guessed", () => {
    expect(priceFor("claude-sonnet-5-5-20261001")).toMatchObject({ exact: true, as: "claude-sonnet-5-5" });
    expect(priceFor("claude-haiku-9")).toMatchObject({ exact: false, as: "claude-haiku-5-5" });
    expect(priceFor("unknown")).toMatchObject({ exact: false, as: "claude-opus-5-5" });
  });

  it("formats dollars, with more decimals under a dollar", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("the periods", () => {
  it("this month from the 1st (UTC); the last 30 and 7 days back from now", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    expect(periodStart("month", now)).toEqual({ since: new Date("2026-10-01T00:00:00Z"), day: "2026-10-01" });
    expect(periodStart("30d", now).day).toBe("2026-09-27");
    expect(periodStart("7d", now).since.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});
