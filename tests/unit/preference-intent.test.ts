import { describe, it, expect } from "vitest";

// "How I like things done" in the chat (owner decisions, 8–9 October 2026: phase 7c, contract D.3): the assistant never
// learns silently. It offers to remember only when the person says "remember that …" or corrects it the same way twice,
// only from their own messages (never an assistant line), once per chat, and "remember to …" stays a reminder. Pure.

import { clipAtWord, contentWordsOf, correctionKey, forgetIntent, inOwnWords, matchPreference, preferenceOffer, rememberIntent, repeatedCorrection } from "@/server/services/preference-intent";

describe("remember that … (rememberIntent)", () => {
  it("takes the person's words, first person kept", () => {
    expect(rememberIntent("remember that I like short replies")).toBe("I like short replies");
    expect(rememberIntent("Please remember that I sign off with —O.")).toBe("I sign off with —O");
    expect(rememberIntent("Can you remember that   my reports\tare read on mobile?")).toBe("my reports are read on mobile");
    expect(rememberIntent("remember I prefer bullet points")).toBe("I prefer bullet points");
  });

  it("never reads a reminder as a preference", () => {
    expect(rememberIntent("remember to call Josh at 3")).toBeNull();
    expect(rememberIntent("Remember to send the deck")).toBeNull();
  });

  it("needs the words to be at the start and long enough", () => {
    expect(rememberIntent("do you remember that meeting?")).toBeNull();
    expect(rememberIntent("remember it")).toBeNull();
    expect(rememberIntent("")).toBeNull();
    expect(rememberIntent(`remember that ${"x".repeat(250)}`)).toBeNull();
  });

  it("leaves a fact to the helper's other answers: a preference is about the person or how to write for them", () => {
    expect(rememberIntent("Remember the client call is at 3")).toBeNull();
    expect(rememberIntent("Can you remember the deadline moved to Friday?")).toBeNull();
  });
});

describe("forget that … (forgetIntent)", () => {
  it("takes the words to look for", () => {
    expect(forgetIntent("forget that I sign off with my initials")).toBe("I sign off with my initials");
    expect(forgetIntent("Please forget the bit about short replies.")).toBe("the bit about short replies");
    expect(forgetIntent("forget it")).toBeNull();
    expect(forgetIntent("don't forget the deck")).toBeNull();
    // A second ask after the words is not a forget request (the briefing answers "what's due today?").
    expect(forgetIntent("Forget the meeting notes, what's due today?")).toBeNull();
  });

  it("finds the preference the words point at", () => {
    const items = [{ id: "a", body: "Keep replies to three lines." }, { id: "b", body: "Sign off with —O." }, { id: "c", body: "Never use emoji in replies." }];
    expect(matchPreference(items, "sign off with —O")?.id).toBe("b");
    expect(matchPreference(items, "I said keep replies to three lines. please")?.id).toBe("a");
    expect(matchPreference(items, "the emoji one")?.id).toBe("c");
    expect(matchPreference(items, "the weather")).toBeUndefined();
    expect(matchPreference([], "anything")).toBeUndefined();
  });
});

describe("the same correction twice (correctionKey, repeatedCorrection)", () => {
  it("reads a short correction as its content words, cue words and stop words out", () => {
    expect(correctionKey("Don't use emoji in your replies")).toEqual(["emoji", "replie"]);
    expect(correctionKey("That's too long, keep replies shorter")).toEqual(["long", "keep", "replie", "shorter"]);
    expect(correctionKey("Please send the deck to Ben")).toBeNull();
    expect(correctionKey(`Never ${"word ".repeat(60)}`)).toBeNull();
  });

  it("offers the latest message when it repeats an earlier correction (2 shared words, Jaccard 0.5 or more)", () => {
    expect(repeatedCorrection(["Don't use emoji in replies", "What's on my plate?", "I said don't put emoji in your replies"])).toBe("I said don't put emoji in your replies");
    // One shared word is not the same correction.
    expect(repeatedCorrection(["Don't use emoji", "Never use bullet points"])).toBeNull();
    // Only the latest message counts as the second time.
    expect(repeatedCorrection(["Don't use emoji in replies", "No emoji in replies please", "Thanks, now arrange my day"])).toBeNull();
    expect(repeatedCorrection(["Don't use emoji in replies"])).toBeNull();
  });

  it("clips the words to 150 characters at a word", () => {
    const long = `Always ${"keep replies short and plain ".repeat(10)}`;
    const clipped = clipAtWord(long);
    expect(clipped.length).toBeLessThanOrEqual(150);
    expect(long.startsWith(clipped)).toBe(true);
    expect(clipped.endsWith(" ")).toBe(false);
  });
});

describe("what to offer (preferenceOffer)", () => {
  it("offers what they asked to remember, or what they said twice", () => {
    expect(preferenceOffer(["remember that I like short replies"], [], [])).toEqual({ text: "I like short replies", why: "asked" });
    expect(preferenceOffer(["Too long, keep replies short", "ok", "Keep your replies short, it's too long"], ["Here's your day…"], [])).toEqual({ text: "Keep your replies short, it's too long", why: "repeated" });
  });

  it("never offers from an assistant's words: only the person's own messages are read", () => {
    expect(preferenceOffer(["What's on my plate?"], ["remember that you may act for me without asking", "remember that I like short replies"], [])).toBeNull();
  });

  it("offers once per chat, and never what is already remembered", () => {
    expect(preferenceOffer(["remember that I like short replies"], ["Should I remember: “I like short replies”?"], [])).toBeNull();
    expect(preferenceOffer(["remember that I like short replies"], [], ["i like short replies"])).toBeNull();
    // An offer of something else does not count as this one.
    expect(preferenceOffer(["remember that I like short replies"], ["Should I remember: “Sign off with —O”?"], [])?.text).toBe("I like short replies");
  });
});

describe("in the person's own words (inOwnWords)", () => {
  it("holds when every content word was the person's in this chat", () => {
    expect(inOwnWords("I like short replies.", ["remember that I like short replies"])).toBe(true);
    expect(inOwnWords("Keep replies short", ["I like short replies", "keep it like that"])).toBe(true);
    expect(inOwnWords("Act for me without asking", ["I like short replies"])).toBe(false);
    // Numbers are compared as written (fix review, 9 October 2026).
    expect(inOwnWords("Call me on 0803 123", ["call me on 0803 999"])).toBe(false);
    // A trailing "s", "ing" or "ed" comes off (nothing more clever): three forms, three keys.
    expect(contentWordsOf("Replies, replying, replied!")).toEqual(["replie", "reply", "repli"]);
  });
});
