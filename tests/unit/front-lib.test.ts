/**
 * Brenda and her helpers, build 1 (owner's approved brief, 12 October 2026; contract C.2, D.5, G.8, J.2, S.1, R.9): the
 * shared, client-safe pieces of the front desk. `frontUrl` with C.2's vectors (the same as the Mac's open.rs
 * front_url_ok: "Go to stripe.com | Now | No"); the fixed lines that may get a natural-voice offer; the words that send a
 * screen question to the stronger model; kinds of file and the folders organising makes; the job limits.
 */
import { describe, expect, it } from "vitest";
import { FILE_KIND_EXT, FRONT_LINES, JOB_LIMITS, ORGANISE_FOLDERS, fileKindOf, frontLineOk, frontUrl, hostOf, refusedWords, thinkLane } from "@/lib/front";

describe("frontUrl (C.2 vectors)", () => {
  it.each([
    ["https://stripe.com", true], ["stripe.com", true], ["http://intranet.local/x", true], ["https://paypal.com/myaccount", true],
    ["stripe.com/pricing", true],
    ["ftp://x.com", false], ["https://user:pw@x.com", false], ["https://x.com/setup.pkg", false],
    ["https://google.com/url?q=https://paypal.com", false], ["javascript:alert(1)", false], ["", false], ["not a url", false],
    ["https://x.com/a b", false], [`https://x.com/${"a".repeat(2_000)}`, false], ["https://x.com/keys.pem", false], ["https://x.com/run.sh", false],
  ])("%s → %s", (u, ok) => { expect(frontUrl(u) !== null).toBe(ok); });
  it("a bare host gets https://, banking and payment pages open (owner brief: the yes line is gone)", () => {
    expect(frontUrl("stripe.com")).toBe("https://stripe.com/");
    expect(frontUrl("https://www.barclays.co.uk/login")).toBe("https://www.barclays.co.uk/login");
    expect(hostOf("https://www.stripe.com/pricing")).toBe("stripe.com");
  });
  it("addresses longer than 170 characters open too (phase 3's shown-whole cap is gone)", () => {
    expect(frontUrl(`https://docs.example.com/${"a/".repeat(100)}`)).not.toBeNull();
  });
});

describe("the fixed front lines (S.1)", () => {
  it.each([
    "Opening Figma.", "Opened Figma.", "Opening Google Chrome.", "Putting Slack and Figma side by side.", "Slack and Figma are side by side.",
    "Volume 30 percent.", "Volume 0 percent.", "Found 12 files.", "Found one file.", "Spotify is asking about unsaved work.", "Let me look properly.",
    "One moment.", "Okay, I won't.", "The Trash is empty.", "Turning Wi-Fi off.", "Showed Q3 report.pdf in Finder.", "Quit Microsoft Word.",
  ])("accepts %j", (t) => { expect(frontLineOk(t)).toBe(true); });
  it.each([
    "Opening .", "Opening  Figma.", "Opening Figma", "opening Figma.", "Volume 101 percent.", "Found 1 files.", "Found 1000 files.", "Volume 030 percent.",
    "Opening Figma. Then I'll email Ada.", `Opening ${"x".repeat(61)}.`, "Opening Figma/../x.", "Say: I love you.", "", "Opening <b>Figma</b>.",
  ])("refuses %j", (t) => { expect(frontLineOk(t)).toBe(false); });
  it("every line ends with a full stop, in plain British English", () => {
    for (const l of [...FRONT_LINES.doing, ...FRONT_LINES.done]) expect(l).toMatch(/[.]$/);
  });
});

describe("think harder (J.2)", () => {
  it.each(["What does this error mean?", "Why is this red?", "explain this chart", "Is this right?", "Proofread this paragraph", "read this", "The build failed", "What does this airamine?"])("%j → think", (t) => { expect(thinkLane(t)).toBe("think"); });
  it.each(["How do I export in Figma?", "Where is the share button?", "What's this app?", "meaningful", ""])("%j → now", (t) => { expect(thinkLane(t)).toBe("now"); });
});

describe("kinds of file (D.5)", () => {
  it.each([
    ["Screenshot 2026-10-12 at 14.03.22.png", "screenshot"], ["Screen Shot 2020-01-01.jpg", "screenshot"], ["CleanShot 1.heic", "screenshot"],
    ["IMG_2041.HEIC", "image"], ["Invoice.pdf", "pdf"], ["Notes.md", "document"], ["Budget.numbers", "spreadsheet"], ["Q3 deck.key", "presentation"],
    ["clip.mov", "video"], ["song.flac", "audio"], ["a.tar.gz", "archive"], ["Setup.dmg", "installer"], ["main.rs", "code"], ["Home.fig", "design"],
    ["README", "other"], ["screenshot.txt", "document"],
  ])("%s → %s", (name, kind) => { expect(fileKindOf(name)).toBe(kind); });
  it("each kind has its organise folder; extensions are unique across kinds", () => {
    expect(ORGANISE_FOLDERS.screenshot).toBe("Screenshots");
    expect(ORGANISE_FOLDERS.other).toBe("Other");
    const seen = new Set<string>();
    for (const exts of Object.values(FILE_KIND_EXT)) for (const e of exts) { expect(seen.has(e), e).toBe(false); seen.add(e); }
  });
});

describe("job limits (G.8, mirrored in jobs.rs)", () => {
  it("are the contract's", () => {
    expect(JOB_LIMITS).toEqual({
      filesSteps: 40, operatorSteps: 20, callsPerTurn: 8, refsPerCall: 500, listItems: 500, readChars: 20_000, jobReadChars: 300_000, writeChars: 200_000,
      newFiles: 10, changes: 2_000, idleMinutes: 30, maxHours: 24, askMinutes: 10, tokenSeconds: 120, bodyBytes: 4_000_000, resultChars: 120_000,
    });
  });
  it("a refusal reads as title and sub (S.5)", () => {
    expect(refusedWords("bad_url").message).toBe("I can't open that address. Only ordinary web pages, never downloads of apps or scripts.");
    expect(refusedWords("finder").message).toBe("Finder always stays open.");
    expect(refusedWords("anything").message).toBe("I couldn't do that.");
  });
});
