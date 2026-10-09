import { describe, it, expect } from "vitest";
import { builtinTitle, normaliseForPrefilter, prefilter, type PrefilterInput, type Reader } from "@/server/services/commitment-prefilter";
import { LOOP_LIMITS } from "@/lib/commitments";

// The prefilter (owner decisions, 8 October 2026: phase 7b, contract B.1): the rule table over the owner's phrasings,
// the 0.35 cut (worth the model's look) and the 0.7 cut (kept without the model), who a message is addressed to, and
// the built-in title. Pure: no database, no model.

const OLU = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const ADA = "00000000-0000-4000-8000-0000000000c3";
const BEN2 = "00000000-0000-4000-8000-0000000000d4";
const readers: Reader[] = [{ membershipId: OLU, name: "Olu Adeyemi" }, { membershipId: BEN, name: "Ben Okafor" }, { membershipId: ADA, name: "Ada Obi" }];
const AT = "2026-10-06T09:14:00.000Z";

const msg = (body: string, o: Partial<PrefilterInput> = {}): PrefilterInput => ({
  id: "m1", body, authorMembershipId: OLU, at: AT, conversationKind: "channel", mentions: [], replyTo: null, previous: null, ...o,
});
const score = (body: string, o: Partial<PrefilterInput> = {}, x: { otherInDirect?: string | null } = {}) => prefilter(msg(body, o), readers, x);
const MIN = LOOP_LIMITS.prefilterMin;
const KEEP = LOOP_LIMITS.builtinAccept;

describe("normalising", () => {
  it("lower case, straight quotes, single spaces; quoted lines and code blocks out; at most 2,000 characters", () => {
    expect(normaliseForPrefilter("I’ll  SEND\nthe deck")).toBe("i'll send the deck");
    expect(normaliseForPrefilter("> I'll send it tomorrow\nok")).toBe("ok");
    expect(normaliseForPrefilter("look:\n```\nI'll send the deck\n```\nthanks")).toBe("look: thanks");
    expect(normaliseForPrefilter("x".repeat(3000))).toHaveLength(2000);
    expect(normaliseForPrefilter("ｉ’ｌｌ")).toBe("i'll");
  });
});

describe("promises", () => {
  const promises: [string, boolean][] = [
    // [text, kept without the model (≥ 0.7)]
    ["I'll send the deck Thursday", true],
    ["I will send the invoice tomorrow", true],
    ["I'm going to finish the report by Friday", true],
    ["I am going to update the roadmap EOD", true],
    ["I'm gonna draft the brief tonight", true],
    ["Let me check the numbers and get back to you by 3pm", true],
    ["Leave it with me, I'll have it done by Monday", true],
    ["I can fix the login bug tomorrow", true],
    ["I can review the copy this afternoon", true],
    ["Thanks, I'll send the deck tomorrow", true],
    ["I'll send the deck", false],
    ["I'll write up the notes", false],
    ["I can take a look at it", false],
  ];
  it.each(promises)("%s", (text, kept) => {
    const r = score(text);
    expect(r.signals).toContain("promise");
    expect(r.score >= KEEP, `${text}: ${r.score}`).toBe(kept);
  });

  const notPromises = ["I'll be late", "I'll be there at 3pm", "I'll try to send it tomorrow", "I'll see what I can do", "I'll think about it", "Maybe I'll send it tomorrow",
    "I might send it Friday", "I'll let you know tomorrow", "Shall I send the deck?", "If I have time I'll do it", "I'd love to help tomorrow", "I'll be offline this afternoon"];
  it.each(notPromises)("not kept: %s", (text) => {
    const r = score(text);
    expect(r.score < KEEP, `${text}: ${r.score}`).toBe(true);
  });

  it("a promise that ends in a question is worth less", () => {
    expect(score("I'll send it tomorrow?").score).toBeLessThan(score("I'll send it tomorrow").score);
  });
});

describe("asks", () => {
  it("a named person (vocative, mention, direct thread) makes an ask worth the model's look", () => {
    const vocative = score("Ben, can you fix the login bug by Friday?");
    expect(vocative.signals).toContain("ask");
    expect(vocative.addressee).toBe(BEN);
    expect(vocative.score).toBeGreaterThanOrEqual(KEEP);
    const full = score("Ben Okafor: could you review the pricing page?");
    expect(full.addressee).toBe(BEN);
    expect(full.score).toBeGreaterThanOrEqual(MIN);
    const greeting = score("Hey Ada, could you send the logo files tomorrow?");
    expect(greeting.addressee).toBe(ADA);
    const trailing = score("Can you send the logo files by Friday, Ada?");
    expect(trailing.addressee).toBe(ADA);
    const mention = score("@ben would you mind checking the figures today", { mentions: [BEN] });
    expect(mention.addressee).toBe(BEN);
    expect(mention.score).toBeGreaterThanOrEqual(MIN);
    const direct = score("Can you send me the contract tomorrow?", { conversationKind: "direct" }, { otherInDirect: ADA });
    expect(direct.addressee).toBe(ADA);
    expect(direct.score).toBeGreaterThanOrEqual(KEEP);
  });

  it("an ask of nobody in particular stays under the model's cut", () => {
    for (const q of ["Can someone send the deck?", "Could you all review this?", "please review"]) expect(score(q).score, q).toBeLessThan(MIN);
  });

  it("questions for information are not asks", () => {
    for (const q of ["Ben, did you see the email?", "Ada, have you finished the report?"]) expect(score(q).score, q).toBeLessThan(MIN);
  });

  it("a courtesy thanks is politeness, not a negative", () => {
    expect(score("Ben, can you review the deck by Friday? Thanks").score).toBeGreaterThanOrEqual(KEEP);
    expect(score("Thanks Ben, can you send the copy?").score).toBeLessThan(score("Ben, can you send the copy?").score + 0.01);
  });

  it("never addresses the writer, nor a first name two readers share", () => {
    expect(score("Olu, can you send it tomorrow?").addressee).toBeNull();
    const twoBens = prefilter(msg("Ben, can you send it tomorrow?"), [...readers, { membershipId: BEN2, name: "Ben Ade" }]);
    expect(twoBens.addressee).toBeNull();
    expect(twoBens.score).toBeLessThan(KEEP);
    // A first name under three letters is not enough.
    expect(prefilter(msg("Al, can you send it tomorrow?"), [...readers, { membershipId: BEN2, name: "Al Smith" }]).addressee).toBeNull();
  });
});

describe("agreements", () => {
  const ask = { id: "m0", authorMembershipId: BEN, body: "Olu, can you fix the login bug by Friday?", at: "2026-10-06T09:10:00.000Z" };

  it("“On it” in reply to someone's ask of the writer, with a date: kept", () => {
    const r = score("On it", { replyTo: ask });
    expect(r.signals).toEqual(["agreement"]);
    expect(r.score).toBe(0.8);
    expect(r.agreesTo).toEqual({ id: "m0", askerMembershipId: BEN });
    expect(r.addressee).toBe(BEN);
    expect(r.what).toBe("Fix the login bug");
    expect(r.dueWords).toBe("by Friday");
  });

  it("the previous message counts within 30 minutes, not after", () => {
    expect(score("Sure, will do", { previous: ask }).score).toBe(0.8);
    expect(score("Sure, will do", { previous: { ...ask, at: "2026-10-06T08:00:00.000Z" } }).score).toBe(0);
  });

  it("short agreements count even under six characters", () => {
    for (const a of ["np", "ok", "yes", "On it", "Will do", "Got it!", "Of course", "No problem", "I can do that", "Leave it with me"]) {
      expect(score(a, { replyTo: ask }).signals, a).toContain("agreement");
    }
  });

  it("not an agreement: the ask was someone else's, of someone else, the writer's own, or no ask at all", () => {
    expect(score("On it", { replyTo: { ...ask, body: "Ada, can you fix the login bug by Friday?" } }).score).toBe(0);
    expect(score("On it", { replyTo: { ...ask, authorMembershipId: OLU } }).score).toBe(0);
    expect(score("On it", { replyTo: { ...ask, body: "The login bug is back" } }).score).toBe(0);
    expect(score("On it")).toMatchObject({ score: 0, signals: [] });
  });

  it("an agreement with a maybe is not kept without the model", () => {
    expect(score("Sure, I'll try", { replyTo: ask }).score).toBeLessThan(KEEP);
  });

  it("in a direct thread an ask of nobody named is of the other person", () => {
    const dm = { ...ask, body: "Can you fix the login bug by Friday?" };
    expect(score("On it", { replyTo: dm, conversationKind: "direct" }, { otherInDirect: BEN }).score).toBe(0.8);
  });
});

describe("the cuts and the rest", () => {
  it("skips very short promises and asks, and plain chatter", () => {
    for (const q of ["Hi all", "Morning!", "lol", "Great work everyone", "The build is green", "Lunch?", ""]) expect(score(q).score, q).toBeLessThan(MIN);
  });

  it("reads only the message's own words: a quoted line or code block never counts", () => {
    expect(score("> I'll send the deck Thursday\nInteresting").score).toBe(0);
    expect(score("```\nI'll send the deck Thursday\n```").score).toBe(0);
  });

  it("signals are those at 0.35 or more, strongest first", () => {
    const r = score("Ben, can you review it by Friday? I'll send the deck tomorrow");
    expect(r.signals.length).toBe(2);
    expect(r.score).toBe(Math.max(...[r.score]));
  });
});

describe("builtinTitle", () => {
  it("the work after the trigger, without its date words", () => {
    expect(builtinTitle("I'll send the deck Thursday", "promise")).toBe("Send the deck");
    expect(builtinTitle("I'll send the deck to Ben by Thursday.", "promise")).toBe("Send the deck to Ben");
    expect(builtinTitle("Ben, can you fix the login bug by Friday?", "ask")).toBe("Fix the login bug");
    expect(builtinTitle("Could you please review the pricing page tomorrow", "ask")).toBe("Review the pricing page");
    expect(builtinTitle("Let me just check the numbers. Back soon", "promise")).toBe("Check the numbers");
    expect(builtinTitle("Make sure to update the roadmap EOD", "ask")).toBe("Update the roadmap");
  });
  it("null when fewer than two words are left, or for an agreement", () => {
    expect(builtinTitle("Leave it with me", "promise")).toBeNull();
    expect(builtinTitle("I'll do it tomorrow", "promise")).toBe("Do it");
    expect(builtinTitle("I'll go", "promise")).toBeNull();
    expect(builtinTitle("On it", "agreement")).toBeNull();
  });
  it("at most 120 characters", () => {
    const t = builtinTitle(`I'll ${"write ".repeat(40)}the deck`, "promise");
    expect(t!.length).toBeLessThanOrEqual(120);
  });
});
