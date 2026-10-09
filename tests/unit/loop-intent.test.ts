import { describe, it, expect } from "vitest";
import { daysOf, loopIntent } from "@/server/services/loop-intent";
import { routineIntent } from "@/server/services/routine-intent";

// Loose ends, commitments and blocked on whom in the built-in helper's words (owner decisions, 8 October 2026: phase 7b,
// contract G.3). Pure: the table in both directions, and what is not a loop intent.

describe("loose ends", () => {
  it("scans for the contract's phrasings", () => {
    for (const q of ["Any loose ends?", "check my loose ends", "find loose ends in my messages", "did I promise anything?", "what did I say I'd do?", "what have people asked me to do?", "anything I owe people?"]) {
      expect(loopIntent(q), q).toEqual({ kind: "loose_ends", scan: true, days: null });
    }
  });

  it("reads how far back", () => {
    expect(loopIntent("loose ends from the last 3 days")).toEqual({ kind: "loose_ends", scan: true, days: 3 });
    expect(loopIntent("any loose ends from the past two days?")).toEqual({ kind: "loose_ends", scan: true, days: 2 });
    expect(loopIntent("loose ends this week")).toEqual({ kind: "loose_ends", scan: true, days: 7 });
    expect(loopIntent("loose ends from the last 30 days")).toEqual({ kind: "loose_ends", scan: true, days: 14 });
    expect(daysOf("the last 1 day")).toBe(1);
    expect(daysOf("today")).toBe(1);
    expect(daysOf("nothing said")).toBeNull();
  });

  it("only shows what was found before when asked to show them", () => {
    expect(loopIntent("show my loose ends")).toEqual({ kind: "loose_ends", scan: false, days: null });
    expect(loopIntent("List my loose ends")).toEqual({ kind: "loose_ends", scan: false, days: null });
    expect(loopIntent("show me any new loose ends")).toEqual({ kind: "loose_ends", scan: true, days: null });
  });
});

describe("commitments", () => {
  it("mine, team and everyone's, with a status", () => {
    expect(loopIntent("my commitments")).toEqual({ kind: "commitments", scope: "mine", status: "all" });
    expect(loopIntent("What have I committed to?")).toEqual({ kind: "commitments", scope: "mine", status: "all" });
    expect(loopIntent("what's overdue on my commitments?")).toEqual({ kind: "commitments", scope: "mine", status: "overdue" });
    expect(loopIntent("my open commitments")).toEqual({ kind: "commitments", scope: "mine", status: "open" });
    expect(loopIntent("team commitments")).toEqual({ kind: "commitments", scope: "team", status: "all" });
    expect(loopIntent("what has my team committed to?")).toEqual({ kind: "commitments", scope: "team", status: "all" });
    expect(loopIntent("everyone's commitments")).toEqual({ kind: "commitments", scope: "all", status: "all" });
  });
});

describe("who waits on whom", () => {
  it("reads the contract's phrasings", () => {
    for (const q of ["who is waiting on whom?", "what are we waiting on?", "who's blocking who?", "Who is blocked on whom?", "who's waiting on me?"]) {
      expect(loopIntent(q), q).toEqual({ kind: "waiting_on" });
    }
  });
});

describe("blocked on someone", () => {
  it("I'm blocked on Ada for the logo files", () => {
    expect(loopIntent("I'm blocked on Ada for the logo files")).toEqual({ kind: "blocked_on", who: "Ada", task: null, question: "I'm waiting on you for the logo files." });
  });
  it("blocked on Ben: can you send the copy?", () => {
    expect(loopIntent("blocked on Ben: can you send the copy?")).toEqual({ kind: "blocked_on", who: "Ben", task: null, question: "Can you send the copy?" });
  });
  it("mark Landing page blocked waiting on Ada", () => {
    expect(loopIntent("mark Landing page blocked waiting on Ada")).toEqual({ kind: "blocked_on", who: "Ada", task: "Landing page", question: null });
    expect(loopIntent("Mark Landing page as blocked, waiting on Ben: can you send the copy?")).toEqual({ kind: "blocked_on", who: "Ben", task: "Landing page", question: "Can you send the copy?" });
  });
  it("keeps a full name and the task named after it", () => {
    expect(loopIntent("I'm blocked on Ada Obi on Landing page: where are the logos?")).toEqual({ kind: "blocked_on", who: "Ada Obi", task: "Landing page", question: "Where are the logos?" });
  });
  it("never a pronoun", () => {
    expect(loopIntent("I'm blocked on them")).toBeNull();
    expect(loopIntent("I'm blocked on you")).toBeNull();
  });
});

describe("what is not a loop intent", () => {
  it("routines are routine-intent's, both ways", () => {
    for (const q of ["every evening, check for loose ends", "every weekday at 6pm find my loose ends"]) {
      expect(loopIntent(q), q).toBeNull();
      expect(routineIntent(q)?.kind, q).toBe("create");
    }
  });
  it("reminders, to-dos, other assistants and follow-ups", () => {
    for (const q of ["remind me to send the deck", "tell Ben's assistant I'm blocked on the copy", "follow up with Ben", "add a to-do", "add a to-do: check loose ends", "what's on my day?", "", "   "]) {
      expect(loopIntent(q), q).toBeNull();
    }
  });
});
