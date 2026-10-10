import { describe, it, expect } from "vitest";

// Brenda's notes on calls (owner decisions, 8 October 2026: phase 8, contract E.9): the fixed words are plain British
// English with no middle dots, and the limits match migration 0054's app_call_add_lines. Pure.

import { readFileSync } from "node:fs";
import { NOTES_LIMITS, NOTES_WORDS, namesList } from "@/lib/call-notes";

/** Every string the words hold, functions called with sample arguments. */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v === "function") {
    const f = v as (...a: unknown[]) => unknown;
    const call = (...a: unknown[]) => { try { return f(...a); } catch { return f(["Ada", "Ben"]); } };
    return strings(call("Ada", "Ben")).concat(strings(call(3, 2)));
  }
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

describe("NOTES_WORDS", () => {
  it("has no middle dots and no empty words", () => {
    const all = strings(NOTES_WORDS);
    expect(all.length).toBeGreaterThan(50);
    for (const s of all) {
      expect(s, s).not.toContain("·");
      expect(s.trim().length, JSON.stringify(s)).toBeGreaterThan(0);
    }
  });

  it("says the contract's sentences", () => {
    expect(NOTES_WORDS.toggleOn("Brenda")).toBe("Brenda takes notes");
    expect(NOTES_WORDS.confirmTitle("Brenda")).toBe("Turn on Brenda's notes?");
    expect(NOTES_WORDS.confirmBody("Brenda", "#Design")).toEqual([
      "Everyone on the call is asked, and only the words of people who agree are used.",
      "Each person's own device writes their words down. No audio leaves anyone's device.",
      "After the call, Brenda sends everyone on it a recap, and a short version goes into #Design.",
      "Only the people on the call can read the transcript. It's deleted 7 days after the recap.",
    ]);
    expect(NOTES_WORDS.bannerOn("Ada", "Brenda")).toBe("Ada turned on Brenda's notes.");
    expect(NOTES_WORDS.from(["Ada", "Ben"])).toBe("Notes from Ada and Ben.");
    expect(NOTES_WORDS.from(["Ada", "Ben", "Olu"])).toBe("Notes from Ada, Ben and Olu.");
    expect(NOTES_WORDS.from([])).toBe("Nobody is included yet.");
    expect(NOTES_WORDS.engine.preparing(41)).toBe("Getting notes ready (41 MB, once)…");
    expect(NOTES_WORDS.tile.from(1)).toBe("From 1 person");
    expect(NOTES_WORDS.tile.from(3)).toBe("From 3 people");
    expect(NOTES_WORDS.notifications.items(1)).toBe("1 action item.");
    expect(NOTES_WORDS.notifications.items(2)).toBe("2 action items.");
    expect(NOTES_WORDS.thread.head("23 min")).toBe("Notes from the call (23 min):");
    expect(NOTES_WORDS.thread.tail(2, 3)).toBe("Decisions: 2. Action items: 3, sent to the people named for them to accept.");
    expect(NOTES_WORDS.thread.tail(1, 0)).toBe("Decisions: 1. Action items: 0.");
    expect(NOTES_WORDS.errors.impersonated("Ada")).toBe("Only Ada can choose this.");
    expect(NOTES_WORDS.errors.notAvailable("plan")).toBe(NOTES_WORDS.unavailable.plan);
    expect(namesList(["Ada"])).toBe("Ada");
  });

  it("tells everyone what a yes means before they answer, the short version in the thread included (fix review, 10 October 2026)", () => {
    // Not only the person who turned notes on (confirmBody): everyone asked "Include your words?" reads it too.
    expect(NOTES_WORDS.consentInfo("#Design")).toBe(
      "Only the words of people who agree are used, written down on each person's own device. Everyone on the call gets the recap, a short version goes into #Design, and the transcript is deleted 7 days after it.");
    expect(NOTES_WORDS.consentInfo("your messages with Ada")).toContain("a short version goes into your messages with Ada");
    const banner = readFileSync("src/components/app/call-notes.tsx", "utf8");
    expect(banner).toContain("W.consentInfo(whereWords(call))");
  });

  it("counts only the action items sent to someone, and says why a recap was skipped (fix review, 10 October 2026)", () => {
    expect(NOTES_WORDS.thread.tail(1, 3, 2)).toBe("Decisions: 1. Action items: 3, 2 sent to the people named for them to accept.");
    expect(NOTES_WORDS.thread.tail(1, 3, 3)).toBe("Decisions: 1. Action items: 3, sent to the people named for them to accept.");
    expect(NOTES_WORDS.thread.tail(1, 3, 0)).toBe("Decisions: 1. Action items: 3.");
    expect(NOTES_WORDS.recap.skippedNotAnswered).toBe("Notes need two people on the call, so there are none.");
    expect(NOTES_WORDS.recap.skippedOff).toBe("Notes were switched off for this workspace, so there are none.");
    expect(NOTES_LIMITS.recapsPerPersonPerDay).toBeLessThan(NOTES_LIMITS.recapsPerOrgPerDay);
  });

  it("keeps the limits migration 0054 enforces", () => {
    const sql = readFileSync("db/migrations/0054_calls.sql", "utf8");
    expect(sql).toContain(`jsonb_array_length(lines) NOT BETWEEN 1 AND ${NOTES_LIMITS.linesPerRequest}`);
    expect(sql).toContain(`> ${NOTES_LIMITS.linesPerPersonPerCall.toLocaleString("en-GB").replace(",", "")}`);
    expect(sql).toContain(`> ${NOTES_LIMITS.linesPerCall}`);
    expect(sql).toContain(`char_length(text) BETWEEN 1 AND ${NOTES_LIMITS.lineMax}`);
  });
});
