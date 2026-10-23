/**
 * schema-0061 without its guards (owner request, 23 October 2026: realtime plan, phase 0, item 5): nothing asks the
 * database whether 0061 is there; a query that fails for want of its tables is noted, and the fallbacks hold for ten
 * minutes at a time. No database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { forget0061, noteMissing0061, schema0061Missing } from "@/server/lib/schema-0061";

afterEach(() => { forget0061(); vi.useRealTimers(); });

describe("schema-0061", () => {
  it("is taken as there until a query says otherwise", () => {
    expect(schema0061Missing()).toBe(false);
  });

  it("a missing table (42P01) or column (42703) is noted; anything else is not", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(noteMissing0061(Object.assign(new Error("boom"), { code: "23505" }))).toBe(false);
    expect(noteMissing0061(new Error("plain"))).toBe(false);
    expect(schema0061Missing()).toBe(false);
    expect(noteMissing0061(Object.assign(new Error('relation "connector_items" does not exist'), { code: "42P01" }))).toBe(true);
    expect(schema0061Missing()).toBe(true);
    forget0061();
    expect(noteMissing0061({ code: "42703" })).toBe(true);
    expect(schema0061Missing()).toBe(true);
  });

  it("a noted 'missing' holds for ten minutes, then the tables are tried again", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T22:00:00Z"));
    noteMissing0061({ code: "42P01" });
    vi.setSystemTime(new Date("2026-10-23T22:09:59Z"));
    expect(schema0061Missing()).toBe(true);
    vi.setSystemTime(new Date("2026-10-23T22:10:01Z"));
    expect(schema0061Missing()).toBe(false);
  });
});
