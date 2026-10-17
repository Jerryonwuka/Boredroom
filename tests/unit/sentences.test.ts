/**
 * Sentences as her answer streams in (owner request, 12 October 2026: "short spoken answers first, streamed"; contract
 * D.6.5): each whole sentence is spoken as soon as it is complete; abbreviations and numbers never end one.
 */
import { describe, expect, it } from "vitest";
import { SentenceBuffer, splitSentences, takeSentences } from "@/server/lib/sentences";

describe("splitSentences", () => {
  it("splits after . ! ? and … followed by whitespace, keeping closing quotes", () => {
    expect(splitSentences("That's the Export button. Click it! Done? Yes… then wait.")).toEqual(["That's the Export button.", "Click it!", "Done?", "Yes…", "then wait."]);
    expect(splitSentences("She said “go.” Then left.")).toEqual(["She said “go.”", "Then left."]);
  });
  it("never inside a number, never after an abbreviation", () => {
    expect(splitSentences("It costs 3.5 pounds. Next.")).toEqual(["It costs 3.5 pounds.", "Next."]);
    expect(splitSentences("Use a format, e.g. PDF or Word. Dr. Obi agreed. Ask Mr. Ade vs. Ms. Ola, etc. then No. 4 is fine.")).toEqual(["Use a format, e.g. PDF or Word.", "Dr. Obi agreed.", "Ask Mr. Ade vs. Ms. Ola, etc. then No. 4 is fine."]);
  });
  it("the rest without an ending is the last sentence; empty text has none", () => {
    expect(splitSentences("No ending here")).toEqual(["No ending here"]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("SentenceBuffer, as the pieces stream", () => {
  it("gives each sentence once it is whole, and the rest on flush", () => {
    const b = new SentenceBuffer();
    expect(b.push("That's the Exp")).toEqual([]);
    expect(b.push("ort button.")).toEqual([]);
    expect(b.push(" Click")).toEqual(["That's the Export button."]);
    expect(b.push(" it, then 3.")).toEqual([]);
    expect(b.push("5 seconds later it saves.\n")).toEqual(["Click it, then 3.5 seconds later it saves."]);
    expect(b.push("Last bit")).toEqual([]);
    expect(b.flush()).toEqual(["Last bit"]);
    expect(b.flush()).toEqual([]);
  });
  it("takeSentences leaves an unfinished sentence", () => {
    expect(takeSentences("One. Two")).toEqual({ sentences: ["One."], rest: " Two" });
  });
});
