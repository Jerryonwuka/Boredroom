import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_WORDS, OWNER_WORDS_OTHER, OWNER_WORDS_TODO_FOR_SOMEONE, ownerWords } from "@/server/services/assistant-activity";

// Screen help (owner decision 1, 11 October 2026: "the employer never sees it nor whether it is used"; contract D.8):
// the log owners and HR read in Settings › Brenda says only what kind of thing was done, for every action, look or not,
// so a look's action reads exactly as the same action asked for in words. The person's own Activity page keeps the full
// words. Pure.

const TABLE: Record<string, string> = {
  todo: "Added a to-do", assign: "Assigned a task", update: "Changed a task", comment: "Commented on a task", submit: "Sent a task for review",
  reminder: "Set a reminder", reminder_cancel: "Cancelled a reminder", complete: "Marked a task done", clock_in: "Clocked in", clock_out: "Clocked out",
  timer_start: "Started the timer", timer_pause: "Paused the timer", timer_resume: "Resumed the timer", timer_stop: "Stopped the timer",
  team: "Created a team", invite: "Sent an invitation", status: "Set the work status", plan: "Arranged the day", doc: "Saved a document", doc_update: "Changed a document",
};

describe("ownerWords (contract D.8)", () => {
  it("is the contract's table, word for word", () => {
    expect({ ...OWNER_WORDS }).toEqual(TABLE);
    for (const [kind, words] of Object.entries(TABLE)) expect(ownerWords(kind)).toBe(words);
    expect(OWNER_WORDS_TODO_FOR_SOMEONE).toBe("Created a task for a teammate");
  });

  it("anything else reads 'Did something they asked for', including names an object already has", () => {
    expect(OWNER_WORDS_OTHER).toBe("Did something they asked for");
    for (const k of ["something_new", "", "constructor", "toString", "__proto__"]) expect(ownerWords(k)).toBe("Did something they asked for");
  });

  it("every done line in the copilot either names its own owner words or has them here", () => {
    const src = readFileSync(join(process.cwd(), "src/server/services/copilot.ts"), "utf8");
    // Each done("kind", …) call, to the end of its statement (they are one line each, or a few for the long ones).
    const calls = [...src.matchAll(/\bdone\("([a-z_]+)",([\s\S]*?)\);\n/g)].map((m) => ({ kind: m[1], rest: m[2] }));
    expect(calls.length).toBeGreaterThan(40);
    const missing = calls.filter((c) => !/\blogged\b/.test(c.rest) && !Object.hasOwn(OWNER_WORDS, c.kind)).map((c) => c.kind);
    expect(missing).toEqual([]);
    // No owner words name a person, a title or a time: they are fixed.
    for (const w of Object.values(OWNER_WORDS)) expect(w).toMatch(/^[A-Z][a-z -]+$/);
  });
});
