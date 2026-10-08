import { describe, it, expect } from "vitest";
import { assistantTalkIntent, isoWithOffset, threadAskIntent, whenOf, whenProblemWords, whenRead } from "@/server/services/assistant-talk-intent";
import { followUpIntent } from "@/server/services/follow-up-intent";

// Personal assistants, phase 6 (owner decision, 8 October 2026: "I want all the bots to be able to communicate with each
// other"): the built-in helper's ear for other people's assistants, what "@Ben's Brenda …" asks in a thread, and the
// times people say ("at 3pm", "tomorrow at 9", "on Friday"). Pure: no database, no model.

const names = { workspaceAssistantName: "Brenda", ownAssistantName: "Max" };
const intent = (t: string) => assistantTalkIntent(t, names);
const ben = { ownerFirst: "Ben", ownerName: "Ben Okafor" };

describe("assistantTalkIntent: passing a message on", () => {
  it("reads every phrasing, with the words as typed (the first letter capital)", () => {
    expect(intent("Tell Ben's assistant the client moved the deadline to Friday.")).toEqual({ kind: "message", to: "Ben", body: "The client moved the deadline to Friday." });
    expect(intent("tell Ben's assistant that the client moved the deadline to Friday")).toEqual({ kind: "message", to: "Ben", body: "The client moved the deadline to Friday" });
    expect(intent("Let Ada's assistant know the invoice is paid")).toEqual({ kind: "message", to: "Ada", body: "The invoice is paid" });
    expect(intent("let Ada's assistant know that the invoice is paid")).toEqual({ kind: "message", to: "Ada", body: "The invoice is paid" });
    expect(intent("Pass this on to Ben's Brenda: the deck is ready")).toEqual({ kind: "message", to: "Ben", body: "The deck is ready" });
    expect(intent("pass on to Ben's Brenda the deck is ready")).toEqual({ kind: "message", to: "Ben", body: "The deck is ready" });
    expect(intent("Message Ben's assistant: call me back please")).toEqual({ kind: "message", to: "Ben", body: "Call me back" });
  });

  it("takes @names, full names, the person's own greeting and politeness", () => {
    expect(intent("Tell @Ben's assistant the client called")).toEqual({ kind: "message", to: "Ben", body: "The client called" });
    expect(intent("Hey Max, can you tell Ben Okafor's assistant the client called?")).toEqual({ kind: "message", to: "Ben Okafor", body: "The client called?" });
    expect(intent("Tell Ben’s assistant the client called")).toEqual({ kind: "message", to: "Ben", body: "The client called" });
  });
});

describe("assistantTalkIntent: handing over a request", () => {
  it("reads a to-do, with or without when it is due", () => {
    expect(intent("Ask Ada's assistant to add “Review pricing” to her to-dos")).toEqual({ kind: "request", to: "Ada", request: { kind: "add_todo", title: "Review pricing", due: null } });
    expect(intent("Ask Ada's assistant to add 'review pricing' to her to-dos by Friday")).toEqual({ kind: "request", to: "Ada", request: { kind: "add_todo", title: "Review pricing", due: "Friday" } });
    expect(intent("ask Ada's assistant to add review pricing to Ada's list due tomorrow at 5pm")).toEqual({ kind: "request", to: "Ada", request: { kind: "add_todo", title: "Review pricing", due: "tomorrow at 5pm" } });
  });

  it("reads a reminder, the time before or after what to remind", () => {
    const call = (when: string) => ({ kind: "request", to: "Ada", request: { kind: "set_reminder", text: "Call Josh", when } });
    expect(intent("Ask Ada's assistant to remind her at 3pm to call Josh")).toEqual(call("at 3pm"));
    expect(intent("Ask Ada's assistant to remind her tomorrow at 9 to call Josh")).toEqual(call("tomorrow at 9"));
    expect(intent("ask Ada's assistant to remind her to call Josh at 3pm")).toEqual(call("at 3pm"));
    expect(intent("ask Ada's assistant to remind Ada on Friday at 5pm to call Josh")).toEqual(call("on Friday at 5pm"));
  });

  it("reads a move and its status words, and a reason", () => {
    const move = (task: string, status: string, reason: string | null = null) => ({ kind: "request", to: "Ada", request: { kind: "task_status", task, status, reason } });
    expect(intent("Ask Ada's assistant to move “Landing page” to in review")).toEqual(move("Landing page", "in_review"));
    expect(intent("Ask Ada's assistant to mark the deck as done")).toEqual(move("deck", "completed"));
    expect(intent("ask Ada's assistant to set the deck to in progress")).toEqual(move("deck", "in_progress"));
    expect(intent("ask Ada's assistant to move the deck to to do")).toEqual(move("deck", "todo"));
    expect(intent("ask Ada's assistant to put the deck in for review")).toEqual(move("deck", "in_review"));
    expect(intent("ask Ada's assistant to mark the deck finished")).toEqual(move("deck", "completed"));
    expect(intent("ask Ada's assistant to mark the deck blocked because waiting on legal")).toEqual(move("deck", "blocked", "Waiting on legal"));
  });

  it("reads a comment", () => {
    expect(intent("Ask Ada's assistant to comment on 'Landing page' that the client approved")).toEqual({ kind: "request", to: "Ada", request: { kind: "task_comment", task: "Landing page", text: "The client approved" } });
    expect(intent("ask Ada's assistant to leave a comment on the deck: looks great")).toEqual({ kind: "request", to: "Ada", request: { kind: "task_comment", task: "deck", text: "Looks great" } });
  });
});

describe("assistantTalkIntent: a note for the team report, and the inbox", () => {
  it("reads a note, with its words or without (then the helper asks what it should say)", () => {
    expect(intent("Tell Brenda to put this in today's team report")).toEqual({ kind: "report_note", body: null });
    expect(intent("Put this in today's team report: the client moved the deadline to Friday")).toEqual({ kind: "report_note", body: "The client moved the deadline to Friday" });
    expect(intent("add a note to the team report: we shipped v2")).toEqual({ kind: "report_note", body: "We shipped v2" });
    expect(intent("Add to today's team report: Olu covered support")).toEqual({ kind: "report_note", body: "Olu covered support" });
    expect(intent("Max, put this in the daily report: the release slipped")).toEqual({ kind: "report_note", body: "The release slipped" });
    expect(intent("tell Brenda to put “we hit 100 users” in the report")).toEqual({ kind: "report_note", body: "We hit 100 users" });
    expect(intent("ask my assistant to include this in the end-of-day report")).toEqual({ kind: "report_note", body: null });
  });

  it("names the workspace's own assistant by its name", () => {
    expect(assistantTalkIntent("Tell Juno to put this in today's team report", { workspaceAssistantName: "Juno", ownAssistantName: "Max" })).toEqual({ kind: "report_note", body: null });
  });

  it("reads asking what came from other assistants", () => {
    for (const q of ["Anything from other assistants?", "anything from other people's assistants", "what did Ben's assistant bring me", "my assistant inbox", "did Ben see my message?", "any requests for me?", "Between assistants"]) {
      expect(intent(q), q).toEqual({ kind: "inbox" });
    }
  });
});

describe("assistantTalkIntent: what it never is", () => {
  it("leaves messages to people, follow-ups, to-dos and lists to the other helpers", () => {
    for (const q of [
      "tell Ben the client called",                 // send_message
      "tell @Ben the client called",
      "ask Ben's assistant for an update",          // a follow-up
      "ask Ben's assistant where he is on the deck",
      "What did Ben's assistant say?",              // the follow-ups' status
      "remind me to tell Ben's assistant the deck is ready",  // a to-do
      "Add review pricing to my to-dos",
      "Tell Ben's assistant X\nand Ada's Y",       // several lines
      "Tell Ben's assistant to call me",            // not a change on his account: the model reads it
      "Put the client update in the report",        // which words? not quoted: the model reads it
    ]) expect(intent(q), q).toBeNull();
  });

  it("does not take follow-ups from the follow-up helper", () => {
    expect(followUpIntent("ask Ben's assistant where he is on the deck")).toMatchObject({ kind: "ask", people: ["Ben"] });
    expect(followUpIntent("What did Ben's assistant say?")).toEqual({ kind: "status" });
    expect(followUpIntent("Tell Ben's assistant the client moved the deadline")).toBeNull();
    expect(followUpIntent("Ask Ada's assistant to add “Review pricing” to her to-dos")).toBeNull();
  });
});

describe("threadAskIntent: what @Ben's Brenda is asked", () => {
  it("reads a change on Ben's account as a request, with Ben implied", () => {
    expect(threadAskIntent("add 'review pricing' to his to-dos", ben)).toEqual({ kind: "request", request: { kind: "add_todo", title: "Review pricing", due: null } });
    expect(threadAskIntent("add the brief to Ben's list by Friday", ben)).toEqual({ kind: "request", request: { kind: "add_todo", title: "The brief", due: "Friday" } });
    expect(threadAskIntent("remind him at 3pm to call Josh", ben)).toEqual({ kind: "request", request: { kind: "set_reminder", text: "Call Josh", when: "at 3pm" } });
    expect(threadAskIntent("remind Ben tomorrow to send the invoice", ben)).toEqual({ kind: "request", request: { kind: "set_reminder", text: "Send the invoice", when: "tomorrow" } });
    expect(threadAskIntent("move the landing page to in review", ben)).toEqual({ kind: "request", request: { kind: "task_status", task: "landing page", status: "in_review", reason: null } });
    expect(threadAskIntent("mark it done", ben)).toEqual({ kind: "request", request: { kind: "task_status", task: "it", status: "completed", reason: null } });
    expect(threadAskIntent("comment on the deck that the client approved", ben)).toEqual({ kind: "request", request: { kind: "task_comment", task: "deck", text: "The client approved" } });
    expect(threadAskIntent("can you ask him to add the brief to his list", ben)).toEqual({ kind: "request", request: { kind: "add_todo", title: "The brief", due: null } });
  });

  it("reads a line to pass on", () => {
    expect(threadAskIntent("tell him the client called", ben)).toEqual({ kind: "relay", body: "The client called" });
    expect(threadAskIntent("let Ben know that the meeting moved", ben)).toEqual({ kind: "relay", body: "The meeting moved" });
  });

  it("reads anything else as a question: about his work (status) or not (he is always asked)", () => {
    expect(threadAskIntent("where is the deck?", ben)).toEqual({ kind: "question", status: true, task: "deck", question: "Where is the deck?" });
    expect(threadAskIntent("where's Ben on the landing page?", ben)).toEqual({ kind: "question", status: true, task: "landing page", question: "Where's Ben on the landing page?" });
    expect(threadAskIntent("is the deck done yet?", ben)).toEqual({ kind: "question", status: true, task: "deck", question: "Is the deck done yet?" });
    expect(threadAskIntent("how's he doing?", ben)).toEqual({ kind: "question", status: true, task: null, question: "How's he doing?" });
    expect(threadAskIntent("what is he working on?", ben)).toEqual({ kind: "question", status: true, task: null, question: "What is he working on?" });
    expect(threadAskIntent("where is Ben?", ben)).toEqual({ kind: "question", status: true, task: null, question: "Where is Ben?" });
    expect(threadAskIntent("Can Ben join the call at 3?", ben)).toEqual({ kind: "question", status: false, task: null, question: "Can Ben join the call at 3?" });
    expect(threadAskIntent("does he like the new logo", ben)).toEqual({ kind: "question", status: false, task: null, question: "Does he like the new logo" });
  });

  it("keeps a question to 280 characters, never splitting a character", () => {
    const q = threadAskIntent(`can he ${"x".repeat(400)}?`, ben);
    expect(q.kind).toBe("question");
    if (q.kind === "question") { expect(q.question).toHaveLength(280); expect(q.question.endsWith("…")).toBe(true); }
  });
});

describe("whenOf", () => {
  const tz = "Europe/London";
  const now = new Date("2026-10-08T10:00:00Z"); // Thursday 11:00 in London (BST)
  const w = (s: string) => whenOf(s, { timeZone: tz, now });

  it("reads times today, a day alone at 17:00, and the parts of a day", () => {
    expect(w("at 3pm")).toBe("2026-10-08T15:00:00+01:00");
    expect(w("15:00")).toBe("2026-10-08T15:00:00+01:00");
    expect(w("at 3")).toBe("2026-10-08T15:00:00+01:00");   // a working day's "at 3"
    expect(w("noon")).toBe("2026-10-08T12:00:00+01:00");
    expect(w("today")).toBe("2026-10-08T17:00:00+01:00");
    expect(w("end of day")).toBe("2026-10-08T17:00:00+01:00");
    expect(w("tomorrow")).toBe("2026-10-09T17:00:00+01:00");
    expect(w("tomorrow at 9")).toBe("2026-10-09T09:00:00+01:00");
    expect(w("tomorrow morning")).toBe("2026-10-09T09:00:00+01:00");
    expect(w("at 3pm tomorrow")).toBe("2026-10-09T15:00:00+01:00");
  });

  it("reads days of the week: the next one, today while the time is still ahead", () => {
    expect(w("on Friday")).toBe("2026-10-09T17:00:00+01:00");
    expect(w("by Friday")).toBe("2026-10-09T17:00:00+01:00");
    expect(w("Friday at 5pm")).toBe("2026-10-09T17:00:00+01:00");
    expect(w("thursday")).toBe("2026-10-08T17:00:00+01:00");
    expect(w("next Thursday")).toBe("2026-10-15T17:00:00+01:00");
    expect(w("on Monday")).toBe("2026-10-12T17:00:00+01:00");
    expect(w("end of the week")).toBe("2026-10-09T17:00:00+01:00");
  });

  it("reads a while from now", () => {
    expect(w("in 2 hours")).toBe("2026-10-08T13:00:00+01:00");
    expect(w("in 30 minutes")).toBe("2026-10-08T11:30:00+01:00");
    expect(w("in an hour")).toBe("2026-10-08T12:00:00+01:00");
  });

  it("refuses the past, what is not a time, and more than a year ahead", () => {
    expect(w("at 9am")).toBeNull();      // 09:00 today has passed
    expect(w("at 10:59")).toBeNull();
    expect(w("garbage")).toBeNull();
    expect(w("at 25")).toBeNull();
    expect(w("at 13pm")).toBeNull();
    expect(w("in 9000 hours")).toBeNull();
    expect(w("")).toBeNull();
  });

  it("holds on the day the clocks change (DST-safe)", () => {
    // Saturday 24 October 2026, 10:00 BST; the clocks go back on Sunday 25 October.
    expect(whenOf("tomorrow at 9", { timeZone: tz, now: new Date("2026-10-24T09:00:00Z") })).toBe("2026-10-25T09:00:00+00:00");
    expect(whenOf("tomorrow", { timeZone: tz, now: new Date("2026-10-24T09:00:00Z") })).toBe("2026-10-25T17:00:00+00:00");
    expect(whenOf("at 3pm", { timeZone: "Africa/Lagos", now })).toBe("2026-10-08T15:00:00+01:00");
    expect(whenOf("at 3pm", { timeZone: "America/New_York", now })).toBe("2026-10-08T15:00:00-04:00");
  });

  it("writes ISO 8601 with the zone's offset", () => {
    expect(isoWithOffset(new Date("2026-12-01T12:30:00Z"), "Europe/London")).toBe("2026-12-01T12:30:00+00:00");
    expect(isoWithOffset(new Date("2026-12-01T12:30:00Z"), "Asia/Kolkata")).toBe("2026-12-01T18:00:00+05:30");
  });
});

describe("review fixes (8 October 2026)", () => {
  it("keeps 'can you' in a question for someone else's assistant: the owner reads the tagger's words", () => {
    expect(threadAskIntent("can you join the client call tomorrow morning?", ben)).toMatchObject({ kind: "question", question: "Can you join the client call tomorrow morning?" });
    expect(threadAskIntent("could you send the hero images?", ben)).toMatchObject({ kind: "question", question: "Could you send the hero images?" });
    // A change or a line to pass on still drops the politeness.
    expect(threadAskIntent("please tell him the client called", ben)).toEqual({ kind: "relay", body: "The client called" });
  });

  it("reads politeness alone as no note, and a pronoun as no to-do title", () => {
    expect(intent("Put this in the report, please")).toEqual({ kind: "report_note", body: null });
    expect(intent("Please add this to the team report, thanks")).toEqual({ kind: "report_note", body: null });
    expect(intent("Put this in today's team report: the client moved the deadline")).toEqual({ kind: "report_note", body: "The client moved the deadline" });
    expect(intent("Ask Ada's assistant to add it to her to-dos")).toBeNull();
    expect(intent("Ask Ada's assistant to add this to her to-dos")).toBeNull();
  });

  it("says a time has passed, never that it could not be read", () => {
    const o = { timeZone: "Europe/London", now: new Date("2026-10-08T14:55:00Z") }; // 15:55 in London
    expect(whenRead("at 3pm", o)).toEqual({ problem: "past" });
    expect(whenRead("at 13pm", o)).toEqual({ problem: "unreadable" });
    expect(whenRead("tomorrow at 3pm", o)).toEqual({ at: "2026-10-09T15:00:00+01:00" });
    expect(whenProblemWords("at 3pm", o, (x) => x)).toBe("That time has already passed. Pick a time later than now.");
    expect(whenProblemWords("at 13pm", o, (x) => x)).toBe("I couldn't tell when “at 13pm” is. Say a day or a time later than now, like “at 3pm”, “tomorrow at 9” or “on Friday”.");
  });
});
