/**
 * What the server, the web and the tests share for tasks on the Mac (owner request and permission rule, 12 October 2026;
 * contract 0.4, 0.6, B.7, D.7, D.10, D.11, E.6): the plan's checks, output names, the never-act table, the outward
 * shortcuts, counting, canonical JSON for the transcript hash, and how a task reads in the person's Activity.
 */
import { describe, expect, it } from "vitest";
import {
  ACT_QUESTION, ACT_WORDS, FIXED_NO_ACT, NO_ACT_EXTRA, PAYMENT_HINTS, actOutcome, actSummary, actUnits, canonicalJson, cleanPlan, noActMatch, outputNameOf, shortcutVerb,
} from "@/lib/act";
import { FIXED_NEVER_LOOK } from "@/lib/screen-help";
import { sha256 } from "@/server/lib/crypto";

describe("the plan (contract 0.4)", () => {
  it("keeps one sentence starting I'll, adds a full stop, and removes any question the model wrote", () => {
    expect(cleanPlan("I'll rename these 6 files to Invoice-01 to Invoice-06.")).toBe("I'll rename these 6 files to Invoice-01 to Invoice-06.");
    expect(cleanPlan("I'll rename these 6 files to Invoice-01 to Invoice-06")).toBe("I'll rename these 6 files to Invoice-01 to Invoice-06.");
    expect(cleanPlan("I’ll empty the Downloads folder into the Bin. Do you want me to do this?")).toBe("I'll empty the Downloads folder into the Bin.");
    expect(cleanPlan("I'll write a one-page brief of “Q3 report.pdf” and save it next to it as “Q3 report (Brenda brief).md”.")).toBe("I'll write a one-page brief of “Q3 report.pdf” and save it next to it as “Q3 report (Brenda brief).md”.");
  });
  it("refuses anything else: not I'll, two sentences, a question, a link, a line break, too short or too long", () => {
    for (const bad of ["Rename these files.", "I will rename these files.", "I'll rename them. Then I'll email Ada.", "I'll rename them, ok?", "I'll open https://evil.example to check.",
      "I'll open www.example.com now.", "I'll rename\nthese files.", "I'll do it.", `I'll ${"x".repeat(200)}.`, "", 42, null]) {
      expect(cleanPlan(bad), String(bad)).toBeNull();
    }
  });
  it("the fixed question", () => { expect(ACT_QUESTION).toBe("Do you want me to do this?"); });
});

describe("output names (contract D.7.1)", () => {
  it("keeps the model's name when it is a plain file name with the format's extension", () => {
    expect(outputNameOf("Q3 report.pdf", "Q3 report (Brenda brief).md", "md")).toBe("Q3 report (Brenda brief).md");
    expect(outputNameOf("Q3 report.pdf", "Q3 brief", "doc")).toBe("Q3 brief");
  });
  it("otherwise <stem> (Brenda summary).<ext>", () => {
    expect(outputNameOf("Q3 report.pdf", "../../etc/passwd.md", "md")).toBe("Q3 report (Brenda summary).md");
    expect(outputNameOf("Q3 report.pdf", "brief.txt", "md")).toBe("Q3 report (Brenda summary).md");
    expect(outputNameOf("Q3 report.pdf", ".hidden.md", "md")).toBe("Q3 report (Brenda summary).md");
    expect(outputNameOf("Q3 report.pdf", "", "docx")).toBe("Q3 report (Brenda summary).docx");
    expect(outputNameOf("notes", "a:b.csv", "csv")).toBe("notes (Brenda summary).csv");
    expect(outputNameOf("Q3.pdf", "", "doc")).toBe("Q3 (Brenda summary)");
    const long = outputNameOf(`${"a".repeat(300)}.pdf`, "", "pdf");
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(" (Brenda summary).pdf")).toBe(true);
  });
});

describe("where Brenda never works (contract B.7)", () => {
  it("FIXED_NO_ACT is the never-look list plus the contract's table, in that order", () => {
    expect(FIXED_NO_ACT).toEqual([...FIXED_NEVER_LOOK.flatMap((f) => f.bundleIds),
      "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty", "org.alacritty", "net.kovidgoyal.kitty", "com.apple.ScriptEditor2",
      "com.apple.Automator", "com.apple.shortcuts", "com.apple.ActivityMonitor", "com.apple.DiskUtility", "com.apple.installer", "com.apple.MigrateAssistant",
      // Review, 12 October 2026: launchers that take the keyboard while another app stays in front.
      "com.apple.Spotlight", "com.raycast.macos", "com.runningwithcrayons.Alfred", "com.runningwithcrayons.Alfred-3", "com.runningwithcrayons.Alfred-Preferences",
      "at.obdev.LaunchBar", "com.apple.SystemEvents", "com.apple.ScriptMenuApp"]);
    expect(NO_ACT_EXTRA).toHaveLength(21);
  });
  it("matches by bundle id or name, ignoring case; the never-look list counts too", () => {
    expect(noActMatch({ name: "Terminal", bundleId: "com.apple.Terminal" })).toBe("Terminal");
    expect(noActMatch({ name: "iTerm2", bundleId: "COM.GOOGLECODE.ITERM2" })).toBe("iTerm");
    expect(noActMatch({ name: "System Settings", bundleId: "com.apple.systempreferences" })).toBe("System Settings");
    expect(noActMatch({ name: "1Password", bundleId: null })).toBe("1Password");
    expect(noActMatch({ name: "Finder", bundleId: "com.apple.finder" })).toBeNull();
    expect(noActMatch(null)).toBeNull();
  });
  it("the payment hints are the contract's", () => {
    expect(PAYMENT_HINTS).toContain("paystack");
    expect(PAYMENT_HINTS).toContain("/pay");
    expect(PAYMENT_HINTS).toHaveLength(42);
  });
});

describe("shortcuts that need their own yes (contract 0.6 layer 2)", () => {
  it.each([
    ["cmd+Return", "send"], ["super+Return", "send"], ["cmd+KP_Enter", "send"], ["cmd+enter", "send"], ["cmd+shift+d", "send"],
    ["cmd+BackSpace", "delete"], ["shift+cmd+BackSpace", "delete"], ["alt+cmd+BackSpace", "delete"], ["cmd+Delete", "delete"], ["cmd+q", "quit"], ["cmd+alt+q", "quit"],
  ])("%s is %s", (k, verb) => { expect(shortcutVerb(k)).toBe(verb); });
  it.each(["Return", "cmd+s", "cmd+c", "cmd+d", "ctrl+Return", "q", "BackSpace", "shift+Return"])("%s is not one", (k) => { expect(shortcutVerb(k)).toBeNull(); });
  it("a sequence of keys is read key by key", () => { expect(shortcutVerb("cmd+a cmd+BackSpace")).toBe("delete"); });
});

describe("counting (contract 0b.13, D.10)", () => {
  it("a screen task counts 1 per 2 steps, a file job 1 per 25,000 tokens and at least 1", () => {
    expect(actUnits("screen", { steps: 0 })).toBe(0);
    expect(actUnits("screen", { steps: 1 })).toBe(1);
    expect(actUnits("screen", { steps: 2 })).toBe(1);
    expect(actUnits("screen", { steps: 5 })).toBe(3);
    expect(actUnits("screen", { steps: 20 })).toBe(10);
    expect(actUnits("file", { inputTokens: 0, outputTokens: 0 })).toBe(1);
    expect(actUnits("file", { inputTokens: 24_000, outputTokens: 1_000 })).toBe(1);
    expect(actUnits("file", { inputTokens: 40_000, outputTokens: 10_001 })).toBe(3);
  });
});

describe("canonical JSON (contract D.7.3)", () => {
  it("sorts keys, keeps array order, writes 1.0 as 1, and leaves undefined out", () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1.0, c: "x" }], u: undefined })).toBe('{"a":[3,{"c":"x","d":1}],"b":1}');
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("é ")).toBe(JSON.stringify("é "));
  });
  it("a Rust-shaped re-serialisation (other key order, other spacing) hashes the same", () => {
    const ours = [{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "left_click", input: { coordinate: [640, 212] }, toolset_name: "computer" }] }];
    const theirs = JSON.parse('[ { "content" : [ { "toolset_name":"computer", "input":{"coordinate":[640.0,212]}, "name":"left_click","id":"toolu_1","type":"tool_use" } ], "role":"assistant" } ]');
    expect(sha256(canonicalJson(theirs))).toBe(sha256(canonicalJson(ours)));
  });
});

describe("how a task reads in the person's Activity (contract D.11, E.6)", () => {
  const plan = "I'll rename these 6 files to Invoice-01 to Invoice-06.";
  it.each([
    ["done", "Renamed 6 files in Finder.", "Renamed 6 files in Finder.", "done"],
    ["done", null, plan, "done"],
    ["stopped", null, `Stopped: ${plan}`, "refused"], ["cap", null, `Stopped: ${plan}`, "refused"], ["time", null, `Stopped: ${plan}`, "refused"],
    ["size", null, `Stopped: ${plan}`, "refused"], ["limit", null, `Stopped: ${plan}`, "refused"],
    ["said_no", null, `You said no: ${plan}`, "refused"], ["unclear", null, `No clear yes: ${plan}`, "refused"], ["expired", null, `No answer: ${plan}`, "refused"],
    ["unresolved", null, `File not found: ${plan}`, "refused"], ["failed", null, `Couldn't finish: ${plan}`, "failed"], ["cannot", "Couldn't: it asked for a password", `Couldn't finish: ${plan}`, "failed"],
  ] as const)("%s", (reason, summary, words, outcome) => {
    expect(actSummary({ end_reason: reason, plan, summary })).toBe(words);
    expect(actOutcome(reason)).toBe(outcome);
  });
  it("a live task is in progress", () => { expect(actSummary({ end_reason: null, plan, summary: null, live: true })).toBe(`In progress: ${plan}`); });
  it("the words", () => {
    const A = ACT_WORDS.activity;
    expect(A.filter).toBe("On your Mac");
    expect(A.via).toEqual({ button: "you pressed Yes", voice: "you said yes", typed: "you typed yes" });
    expect(A.forgetLabel("Renamed 6 files.")).toBe("Forget: Renamed 6 files.");
    expect(A.forgotten).toBe("Forgotten.");
    expect(A.note("Max")).toBe("What you asked Max to do on your Mac, and what Max did, shows only here, only to you, for 30 days. Pictures, file contents and where your files are are never kept.");
  });
});

describe("the errors (contract D.16)", () => {
  it("word for word", () => {
    const E = ACT_WORDS.errors;
    expect(E.notConfirmed).toBe("I haven't heard a yes for that, so I won't do it.");
    expect(E.desktopOnly).toBe("Brenda does things on your Mac only from Brenda for Mac.");
    expect(E.impersonated).toBe("Brenda doesn't do things on the Mac while someone else is signed in as you.");
    expect(E.switchedOff).toBe("Your workspace has switched off on-screen actions and file work.");
    expect(E.ended).toBe("That task has already ended.");
    expect(E.plan).toBe("That isn't what I asked you about, so I won't do it.");
    expect(E.expired).toBe("That waited too long, so I won't do it. Ask me again.");
    expect(E.answer).toBe("I didn't catch a clear yes, so I won't do it.");
    expect(E.stepCap).toBe("That took more steps than I'm allowed, so I stopped.");
    expect(E.limit(150, "Max")).toBe("You've used today's 150 requests to Max, so Max can't carry on. Try again tomorrow.");
    expect(E.transcript).toBe("That task's steps didn't match, so I stopped it.");
    expect(E.notReady).toBe("This needs a database update first.");
  });
  it("what the model is told when a proposal is refused (contract D.6.6)", () => {
    const R = ACT_WORDS.notProposed;
    expect(R.told(R.macOff("Brenda"))).toBe("Not proposed: they haven't turned on “Let Brenda use my Mac”. Tell them in one sentence, and help in words.");
    expect(R.filesOff("Max")).toBe("they haven't turned on “Let Max work on files”");
    expect(R.alone).toBe("Not proposed: propose on its own, after anything else.");
  });
});
