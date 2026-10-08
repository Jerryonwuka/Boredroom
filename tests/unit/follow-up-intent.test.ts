import { describe, it, expect } from "vitest";
import { followUpIntent } from "@/server/services/follow-up-intent";

// Personal assistants, phase 4 (owner decision, 8 October 2026): the built-in helper understands the common ways of
// asking for a follow-up (contract D.4), and never mistakes a to-do note for one.

// The third argument is the sentence as typed, kept for reading; the question itself is always null (planFollowUps
// writes it to the person: "Where are you on “X”?", visual review, 8 October 2026).
const ask = (people: string[], task: string | null, _typed: string, team: string | null = null) => ({ kind: "ask", people, team, task, question: null });

describe("followUpIntent: one or more people", () => {
  it("follow up with someone, on/about/regarding a task, or not", () => {
    expect(followUpIntent("Follow up with Ben on the landing page")).toEqual(ask(["Ben"], "landing page", "Follow up with Ben on the landing page"));
    expect(followUpIntent("follow up with Ben about the landing page.")).toEqual(ask(["Ben"], "landing page", "follow up with Ben about the landing page."));
    expect(followUpIntent("Follow-up with Ben regarding landing page")).toEqual(ask(["Ben"], "landing page", "Follow-up with Ben regarding landing page"));
    expect(followUpIntent("Follow up with Ben")).toEqual(ask(["Ben"], null, "Follow up with Ben"));
    expect(followUpIntent("follow up with Ben Okafor on the pricing page copy task?")).toEqual(ask(["Ben Okafor"], "pricing page copy", "follow up with Ben Okafor on the pricing page copy task?"));
    expect(followUpIntent("Follow up on the landing page with Ben")).toEqual(ask(["Ben"], "landing page", "Follow up on the landing page with Ben"));
  });

  it("where is someone on a task", () => {
    expect(followUpIntent("Where is Ada on the invoice task?")).toEqual(ask(["Ada"], "invoice", "Where is Ada on the invoice task?"));
    expect(followUpIntent("where's Ben with the invoice")).toEqual(ask(["Ben"], "invoice", "where's Ben with the invoice"));
    expect(followUpIntent("Where’s Ben at with the invoice?")).toEqual(ask(["Ben"], "invoice", "Where’s Ben at with the invoice?"));
    expect(followUpIntent("Where is Ben on the pricing page?")).toEqual(ask(["Ben"], "pricing page", "Where is Ben on the pricing page?"));
  });

  it("several people, split on commas, 'and' and '&'", () => {
    expect(followUpIntent("Where are Ben and Ada on the landing page?")).toEqual(ask(["Ben", "Ada"], "landing page", "Where are Ben and Ada on the landing page?"));
    expect(followUpIntent("Follow up with Ben, Ada and Ifeoma about the launch")).toEqual(ask(["Ben", "Ada", "Ifeoma"], "launch", "Follow up with Ben, Ada and Ifeoma about the launch"));
    expect(followUpIntent("follow up with Ben & Ada")).toEqual(ask(["Ben", "Ada"], null, "follow up with Ben & Ada"));
    expect(followUpIntent("Follow up with Ben, and Ada")).toEqual(ask(["Ben", "Ada"], null, "Follow up with Ben, and Ada"));
  });

  it("ask or check in with someone where or how they are on something", () => {
    expect(followUpIntent("Ask Ben where he is on the landing page")).toEqual(ask(["Ben"], "landing page", "Ask Ben where he is on the landing page"));
    expect(followUpIntent("ask with Ada where she is on the invoice")).toEqual(ask(["Ada"], "invoice", "ask with Ada where she is on the invoice"));
    expect(followUpIntent("Check in with Ben how he's doing on the invoice")).toEqual(ask(["Ben"], "invoice", "Check in with Ben how he's doing on the invoice"));
    expect(followUpIntent("check with Ada where they are with the homepage design")).toEqual(ask(["Ada"], "homepage design", "check with Ada where they are with the homepage design"));
    expect(followUpIntent("Ask Ben for an update on the landing page")).toEqual(ask(["Ben"], "landing page", "Ask Ben for an update on the landing page"));
    expect(followUpIntent("Check in with Ben")).toEqual(ask(["Ben"], null, "Check in with Ben"));
  });

  it("what someone is working on", () => {
    expect(followUpIntent("What is Ben working on?")).toEqual(ask(["Ben"], null, "What is Ben working on?"));
    expect(followUpIntent("what's Ada working on today")).toEqual(ask(["Ada"], null, "what's Ada working on today"));
    expect(followUpIntent("How is Ben getting on with the landing page?")).toEqual(ask(["Ben"], "landing page", "How is Ben getting on with the landing page?"));
  });

  it("drops the politeness around it, and never passes the instruction on as the question", () => {
    expect(followUpIntent("Hey Max, can you please follow up with Ben on the landing page for me?")).toEqual(ask(["Ben"], "landing page", "Hey Max, can you please follow up with Ben on the landing page for me?"));
    expect(followUpIntent("Please follow up with Ben, please.")).toEqual(ask(["Ben"], null, "Please follow up with Ben, please."));
    expect(followUpIntent("follow up with Ben's assistant about the invoice")).toEqual(ask(["Ben"], "invoice", "follow up with Ben's assistant about the invoice"));
  });

  it("reads 'their tasks', 'it', 'everything' and the like as all of their work", () => {
    for (const w of ["this week's tasks", "their tasks", "today's work", "it", "everything", "the tasks", "his work"]) {
      expect(followUpIntent(`Where is Ben on ${w}?`), w).toMatchObject({ kind: "ask", people: ["Ben"], task: null });
    }
  });

  it("never makes the instruction to the assistant the question shown to the person", () => {
    for (const q of ["Follow up with Ben on pricing page copy", "Follow up with the Design team", "Where is Ada on the invoice task?", "What is Ben working on?"]) {
      expect(followUpIntent(q), q).toMatchObject({ kind: "ask", question: null });
    }
    const long = `Follow up with Ben on the ${"very ".repeat(80)}long task`;
    expect(followUpIntent(long)).toMatchObject({ kind: "ask", people: ["Ben"], question: null });
  });

  it("leaves out when it is wanted from what it is about", () => {
    expect(followUpIntent("Follow up with Ben about the invoice tomorrow")).toMatchObject({ people: ["Ben"], task: "invoice" });
    expect(followUpIntent("Ask Ben for an update on the budget by Friday")).toMatchObject({ people: ["Ben"], task: "budget" });
    expect(followUpIntent("follow up with Ben on the deck before 5pm")).toMatchObject({ task: "deck" });
    expect(followUpIntent("Where is Ben on the report by end of the day?")).toMatchObject({ task: "report" });
    expect(followUpIntent("follow up with Ben on the deck tomorrow morning")).toMatchObject({ task: "deck" });
    // A title that only has time words inside it keeps them.
    expect(followUpIntent("Follow up with Ben on Plan for the week")).toMatchObject({ task: "Plan for the week" });
  });
});

describe("followUpIntent: a team", () => {
  it("my team, a named team, everyone on a team", () => {
    expect(followUpIntent("Ask my team where they are on this week's tasks")).toEqual(ask([], null, "Ask my team where they are on this week's tasks", "my team"));
    expect(followUpIntent("Follow up with my team")).toEqual(ask([], null, "Follow up with my team", "my team"));
    expect(followUpIntent("follow up with the team about the launch")).toEqual(ask([], "launch", "follow up with the team about the launch", "my team"));
    expect(followUpIntent("Follow up with the Design team")).toEqual(ask([], null, "Follow up with the Design team", "Design"));
    expect(followUpIntent("Ask everyone on Design where they are on the launch")).toEqual(ask([], "launch", "Ask everyone on Design where they are on the launch", "Design"));
    expect(followUpIntent("ask everyone in the Design team for an update")).toEqual(ask([], null, "ask everyone in the Design team for an update", "Design"));
    expect(followUpIntent("Follow up with everyone on Design")).toEqual(ask([], null, "Follow up with everyone on Design", "Design"));
    expect(followUpIntent("Follow up with everyone on Design about the landing page")).toEqual(ask([], "landing page", "Follow up with everyone on Design about the landing page", "Design"));
    expect(followUpIntent("What is my team working on?")).toEqual(ask([], null, "What is my team working on?", "my team"));
    expect(followUpIntent("Where is my team on the launch?")).toEqual(ask([], "launch", "Where is my team on the launch?", "my team"));
  });
});

describe("followUpIntent: the person's own follow-ups", () => {
  it("any answers, my follow-ups, what someone's assistant said", () => {
    for (const q of ["Any answers on my follow-ups?", "any updates from my follow-ups", "Any news on my follow ups?", "are there any replies to my follow-ups?", "My follow-ups", "show me my follow-ups", "What did Ben's assistant say?", "any answers yet to my follow-ups"]) {
      expect(followUpIntent(q), q).toEqual({ kind: "status" });
    }
  });
});

describe("followUpIntent: what is not a follow-up", () => {
  it("never a to-do note (the TO_DO guard)", () => {
    for (const q of ["Remind me to follow up with Ben", "remind me to ask Ben where he is on the landing page", "I need to follow up with Ben on the invoice", "Add a task: follow up with Ben", "I'll follow up with Ben tomorrow", "Send Ben a message"]) {
      expect(followUpIntent(q), q).toBeNull();
    }
  });

  it("never a pasted list of several things (the to-do path reads those)", () => {
    for (const q of ["Follow up with Ben about the invoice\nSend the deck to Ada\nFix the login bug", "Ask Ben for an update on the budget by Friday\nWrite the summary", "Check in with Ben about the launch; send Ada the deck", "- Follow up with Ben\n- Send the deck", "1. Follow up with Ben 2. Send the deck"]) {
      expect(followUpIntent(q), q).toBeNull();
    }
  });

  it("never a sentence that names nobody", () => {
    for (const q of ["Where is the meeting on Friday?", "where is my report on the drive", "How are you doing?", "What are you working on?", "how is it going", "Follow up with someone", "follow up with everyone", "What did I miss?", "What did Ben say about the landing page?", "Where is the invoice?", "What's the status of the landing page?", "follow up with the landing page doc on Friday", "How are things going with Ben", "Check in with things"]) {
      expect(followUpIntent(q), q).toBeNull();
    }
  });

  it("nothing at all", () => {
    expect(followUpIntent("")).toBeNull();
    expect(followUpIntent("   ")).toBeNull();
  });
});
