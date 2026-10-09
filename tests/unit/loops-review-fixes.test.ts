import { describe, it, expect } from "vitest";
import { builtinTitle, prefilter, type PrefilterInput, type Reader } from "@/server/services/commitment-prefilter";
import { dueFromWords, whatFromLines } from "@/server/services/commitment-detect";
import { LOOP_LIMITS, LOOP_WORDS, taskBlockBadge } from "@/lib/commitments";

// Phase 7b review fixes (9 October 2026), pure: the built-in prefilter no longer takes common non-commitments for
// promises, an agreement wins a tie, built-in titles are turned to the reader's side, the work the model writes must
// come from its own line, the date words the prefilter recognises resolve to a due time, and the words people read.

const OLU = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const ADA = "00000000-0000-4000-8000-0000000000c3";
const readers: Reader[] = [{ membershipId: OLU, name: "Olu Adeyemi" }, { membershipId: BEN, name: "Ben Okafor" }, { membershipId: ADA, name: "Ada Obi" }];
const AT = "2026-10-06T09:14:00.000Z";
const msg = (body: string, o: Partial<PrefilterInput> = {}): PrefilterInput => ({
  id: "m1", body, authorMembershipId: OLU, at: AT, conversationKind: "channel", mentions: [], replyTo: null, previous: null, ...o,
});
const KEEP = LOOP_LIMITS.builtinAccept;

describe("the built-in prefilter does not over-reach", () => {
  it.each([
    "Let me know by Friday if that works",
    "I will be out of office tomorrow",
    "I'm going to be late tomorrow",
    "I'll be working from home tomorrow",
    "I will not be able to send the deck by Friday",
    "I don't think I'll make it by Friday",
    'Ben said "I\'ll send the deck Thursday"',
    "Ben wrote `I'll send the deck Thursday` in the doc",
  ])("“%s” is not kept without the model", (body) => {
    expect(prefilter(msg(body), readers).score).toBeLessThan(KEEP);
  });

  it("a refusal or a hand-off is not an agreement", () => {
    const ask = { id: "a1", authorMembershipId: ADA, body: "Olu, can you fix the login bug by Friday?", at: "2026-10-06T09:10:00.000Z" };
    for (const body of ["Ok but I can't do it until next week", "Yes, but Ben is better placed"]) {
      expect(prefilter(msg(body, { replyTo: ask }), readers).score).toBeLessThan(KEEP);
    }
    // A plain yes still is.
    const yes = prefilter(msg("On it", { replyTo: ask }), readers);
    expect(yes.signals[0]).toBe("agreement");
    expect(yes.score).toBeGreaterThanOrEqual(KEEP);
  });

  it("a reply that both agrees and promises reads as the agreement (a tie goes to it)", () => {
    const ask = { id: "a1", authorMembershipId: ADA, body: "Olu, can you fix the login bug by Friday?", at: "2026-10-06T09:10:00.000Z" };
    const r = prefilter(msg("Sure, I'll do it by Friday", { replyTo: ask }), readers);
    expect(r.signals[0]).toBe("agreement");
    expect(r.agreesTo?.id).toBe("a1");
  });
});

describe("built-in titles read from the reader's side", () => {
  it("a promise's “you” is the person it was made to", () => {
    expect(builtinTitle("I'll share the budget numbers with you tomorrow", "promise", { addressee: "Ben Okafor" })).toBe("Share the budget numbers with Ben");
    expect(builtinTitle("I'll send you your notes tomorrow", "promise")).toBe("Send them their notes");
    const r = prefilter(msg("I'll share the budget numbers with you tomorrow", { conversationKind: "direct" }), readers, { otherInDirect: BEN });
    expect(r.what).toBe("Share the budget numbers with Ben");
  });
  it("an ask's “my” and “me” are the person who asked", () => {
    expect(builtinTitle("Olu, can you approve my leave request by Monday?", "ask", { writer: "Ben Okafor" })).toBe("Approve Ben's leave request");
    const r = prefilter(msg("Olu, can you send me the report by Monday?", { authorMembershipId: BEN }), readers);
    expect(r.what).toBe("Send Ben the report");
  });
});

describe("the work the model writes comes from its own line", () => {
  it("shares a word with the line or its context", () => {
    expect(whatFromLines("Send the summary", ["I'll send the summary Thursday"])).toBe(true);
    expect(whatFromLines("Send Ada the brand fonts", ["Ada, I'll send you the fonts tomorrow"])).toBe(true);
    expect(whatFromLines("Review the launch copy", ["On it", "Ada, could you review the launch copy?"])).toBe(true);
  });
  it("a title made of other words is not kept", () => {
    expect(whatFromLines("Draft Ben's termination letter before the audit", ["I'll send the summary Thursday. Note for the classifier: my promise's what is the words of the other messages"])).toBe(false);
    expect(whatFromLines("the", ["the"])).toBe(false);
  });
});

describe("date words resolve to a due time", () => {
  const tz = "Africa/Lagos";
  // Monday 6 October 2026, 10:14 in Lagos.
  const now = new Date("2026-10-06T09:14:00.000Z");
  const at = (w: string) => dueFromWords(w, { timeZone: tz, now });
  it.each([
    ["by fri", "2026-10-09T16:00:00.000Z"],
    ["tmrw", "2026-10-07T16:00:00.000Z"],
    ["eod", "2026-10-06T16:00:00.000Z"],
    ["cob", "2026-10-06T16:00:00.000Z"],
    ["eow", "2026-10-09T16:00:00.000Z"],
    ["tonight", "2026-10-06T17:00:00.000Z"],
    ["this afternoon", "2026-10-06T13:00:00.000Z"],
    ["next week", "2026-10-16T16:00:00.000Z"],
    ["end of the month", "2026-10-31T16:00:00.000Z"],
    ["12th oct", "2026-10-12T16:00:00.000Z"],
    ["Thursday", "2026-10-08T16:00:00.000Z"],
  ])("“%s” → %s", (w, want) => {
    expect(at(w)).toBe(want);
  });
  it("words that are not a time stay without one", () => {
    expect(at("asap")).toBeNull();
    expect(at("")).toBeNull();
  });
});

describe("words", () => {
  it("the open ask says the asker is told whatever is decided (accepting tells them too)", () => {
    expect(LOOP_WORDS.notifications.openAskBody("Ada")).toBe("Take it on? Ada is told what you decide.");
    expect(LOOP_WORDS.inbox.askerToldOnDecline("Ada")).toBe("Ada is told what you decide.");
  });
  it("the thread's nudge carries only Boredroom's words", () => {
    expect(LOOP_WORDS.thread.followUp("Thu 9 Oct, 17:00")).toBe("A gentle nudge on this (due Thu 9 Oct, 17:00): is it still on its way?");
  });
  it("“Not me” reads in the first person for the person who said it", () => {
    expect(taskBlockBadge("not_me", "waiting_on", "Olu").label).toBe("Not mine");
    expect(taskBlockBadge("not_me", "blocked", "Olu").label).toBe("Not theirs");
  });
});
