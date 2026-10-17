import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Brenda for Mac, phase 2: doing things on the Mac only when the person asks and says yes (owner rule, 12 October 2026:
// "Brenda cannot take any action except I explicitly give an instruction … if it's a core task, Brenda should confirm, oh,
// do you want me to do this? And then I'll say, yes"; contract C.9). desktop/src/act.js, a classic browser script that
// also loads in Node: both consents word for word (Brenda, and a renamed assistant), the permission steps, the asking and
// step cards, every `because`, the endings, every refusal row, the file line, the clock, and the yes grammar's vectors
// (contract 0.5, the same table as Rust's yes.rs and src/lib/act.ts). Then the page: Yes is act_answer and nothing else,
// and no file in desktop/src calls the act or look routes.

type Para = { lead?: string; text: string };
type Consent = { title: string; paras: Para[]; notNow: string; turnOn: string; footer: string };
type Words = Record<string, string>;
type ActApi = {
  QUESTION: string;
  ANSWER_MS: number;
  BECAUSE: Record<string, string>;
  consentMac(name: string): Consent;
  consentFiles(name: string): Consent;
  consentText(c: Consent): string;
  permissionWords(name: string): Record<string, Words>;
  fileLine(file: unknown, output: unknown): string;
  taskOf(t: unknown): Record<string, unknown> | null;
  askCard(task: unknown, o?: { keysLabel?: string }): Words;
  stepCard(ask: unknown): Words & { saidNo: Words };
  outcome(kind: string): { title: string; ms: number };
  noteOf(note: unknown): string;
  elapsed(ms: number): string;
  doingWords(o?: Record<string, unknown>): Words;
  whyPaused(why: unknown): string;
  pausedWords(why: unknown): Words;
  workingWords(o?: Record<string, unknown>): Words;
  doneCard(evt?: Record<string, unknown>, task?: unknown): Words;
  stoppedCard(evt?: Record<string, unknown>, o?: Record<string, unknown>): Words;
  cannotCard(reason: unknown): Words;
  failedCard(evt?: Record<string, unknown>, o?: Record<string, unknown>): Words;
  chatLine(kind: string, evt?: Record<string, unknown>, task?: unknown): string;
  refusal(reason: string, o?: Record<string, unknown>): { title: string; sub: string };
  verdict(text: unknown, name?: string): "yes" | "no" | "unclear";
  typedAnswer(text: unknown, name?: string): { verdict: string; answer: string };
  statusOf(s: unknown): Record<string, unknown> | null;
};

const require = createRequire(import.meta.url);
const Act = require("../../desktop/src/act.js") as ActApi;
const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// Contract E.2, word for word.
const MAC_BRENDA = `Let Brenda do things on your Mac when you ask

When you ask her to do something on your screen, like “rename these files” or “fill in this form from my notes”, Brenda can move the pointer, click and type for you, one step at a time, while you watch.

Only when you ask, and only after you say yes. She tells you exactly what she'll do and asks “Do you want me to do this?”. Nothing happens until you press Yes or say “yes”. Silence means no. Before anything she can't undo, like sending, deleting, paying or signing in, she asks again.

You can stop her at once. Press Esc, hold her keys, or press Stop. If you move the mouse or type while she works, she pauses and asks.

Where she never works. Password managers, Keychain, System Settings, Terminal, messaging and call apps, the apps on your never-look list, and banking and payment pages (she spots those by their addresses, which can miss some). Never during a Boredroom call, or while she can tell your screen is being shared (she can't always tell, so stop her before you share).

What leaves your Mac. While she works, a picture of the screen after each step goes, through Boredroom's own account, to Anthropic, to decide the next step. The pictures and the steps are never kept. A short note of what she did stays in your Activity for 30 days, and only you can see it.

Your Mac will ask. macOS will ask you to allow Brenda under Accessibility. That's the permission that lets an app use the mouse and keyboard. She uses it only during a task you said yes to.

[ Not now ] [ Let Brenda use my Mac ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

const MAC_MAX = `Let Max do things on your Mac when you ask

When you ask Max to do something on your screen, like “rename these files” or “fill in this form from my notes”, Max can move the pointer, click and type for you, one step at a time, while you watch.

Only when you ask, and only after you say yes. Max tells you exactly what Max will do and asks “Do you want me to do this?”. Nothing happens until you press Yes or say “yes”. Silence means no. Before anything Max can't undo, like sending, deleting, paying or signing in, Max asks again.

You can stop Max at once. Press Esc, hold Max's keys, or press Stop. If you move the mouse or type while Max works, Max pauses and asks.

Where Max never works. Password managers, Keychain, System Settings, Terminal, messaging and call apps, the apps on your never-look list, and banking and payment pages (Max spots those by their addresses, which can miss some). Never during a Boredroom call, or while Max can tell your screen is being shared (Max can't always tell, so stop Max before you share).

What leaves your Mac. While Max works, a picture of the screen after each step goes, through Boredroom's own account, to Anthropic, to decide the next step. The pictures and the steps are never kept. A short note of what Max did stays in your Activity for 30 days, and only you can see it.

Your Mac will ask. macOS will ask you to allow Brenda under Accessibility. That's the permission that lets an app use the mouse and keyboard. Max uses it only during a task you said yes to.

[ Not now ] [ Let Max use my Mac ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

// Contract E.3, word for word.
const FILES_BRENDA = `Let Brenda work on files when you ask

Ask her to summarise a PDF, tidy a spreadsheet or draft a document from a file, and Brenda works on it while you carry on. Select the file in Finder, have it open in front of you, or drop it on her.

Only the file you give her, and only after you say yes. She tells you what she'll make and where she'll save it, and asks “Do you want me to do this?”. She reads only that file.

Your file stays as it is. She always saves a new file next to it. She never changes or replaces yours.

Stopping. Press Esc, hold her keys, or press Stop, and she stops at once. While she works on a file, Esc and her keys are hers to stop it, so she looks at your screen again once it's done.

What leaves your Mac. The file's text (or, for small PDFs and pictures, the file itself) goes through Boredroom's own account to Anthropic to do the work. Nothing from it is kept on Boredroom's servers, and your workspace can't see it. The file's name and what she made stay in your Activity for 30 days, only for you.

Your Mac will ask. Next, your Mac asks whether Brenda can control Finder, so she can see which files you've selected. It may also ask about your Documents or Desktop folder the first time she opens a file there.

[ Not now ] [ Let Brenda work on files ]`;

const FILES_MAX = `Let Max work on files when you ask

Ask Max to summarise a PDF, tidy a spreadsheet or draft a document from a file, and Max works on it while you carry on. Select the file in Finder, have it open in front of you, or drop it on Max.

Only the file you give Max, and only after you say yes. Max tells you what Max will make and where Max will save it, and asks “Do you want me to do this?”. Max reads only that file.

Your file stays as it is. Max always saves a new file next to it. Max never changes or replaces yours.

Stopping. Press Esc, hold Max's keys, or press Stop, and Max stops at once. While Max works on a file, Esc and Max's keys are there to stop it, so Max looks at your screen again once it's done.

What leaves your Mac. The file's text (or, for small PDFs and pictures, the file itself) goes through Boredroom's own account to Anthropic to do the work. Nothing from it is kept on Boredroom's servers, and your workspace can't see it. The file's name and what Max made stay in your Activity for 30 days, only for you.

Your Mac will ask. Next, your Mac asks whether Brenda can control Finder, so Max can see which files you've selected. It may also ask about your Documents or Desktop folder the first time Max opens a file there.

[ Not now ] [ Let Max work on files ]`;

const TASK = { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", kind: "screen", plan: "I'll rename these 6 files to Invoice-01 to Invoice-06.", question: "Do you want me to do this?", planSha256: "a".repeat(64), answerBy: "2026-10-12T10:31:05Z", risky: false, stepCap: 20, file: null, output: null };
const FILE_TASK = { ...TASK, kind: "file", plan: "I'll write a one-page brief of “Q3 report.pdf” and save it next to it as “Q3 report (Brenda brief).md”.", file: { source: "finder_selection", name: "Q3 report.pdf" }, output: { format: "md", name: "Q3 report (Brenda brief).md" } };

describe("the script", () => {
  it("parses as plain JavaScript and loads after look.js and before main.js in the notch and the preview", () => {
    for (const f of ["desktop/src/act.js", "desktop/src/main.js"]) expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
    for (const page of ["desktop/src/index.html", "desktop/preview.html"]) {
      const html = file(page);
      const at = (n: string) => html.search(new RegExp(`src="(?:src/)?${n}\\.js"`));
      expect(at("act")).toBeGreaterThan(at("look"));
      expect(at("act")).toBeLessThan(at("main"));
    }
  });
  it("is frozen and pure: it never reads the page, invokes Rust or reaches the network", () => {
    expect(Object.isFrozen(Act)).toBe(true);
    expect(file("desktop/src/act.js")).not.toMatch(/\bdocument\.[a-z]|\bwindow\.[a-z_]|\binvoke\(|__TAURI__|\bfetch\(|XMLHttpRequest/);
  });
});

describe("the consents (contract E.2, E.3)", () => {
  it("are the contract's words for Brenda", () => {
    expect(Act.consentText(Act.consentMac("Brenda"))).toBe(MAC_BRENDA);
    expect(Act.consentText(Act.consentFiles("Brenda"))).toBe(FILES_BRENDA);
  });
  it("name a renamed assistant wherever she would be named, and keep Brenda where it is the app's name", () => {
    expect(Act.consentText(Act.consentMac("Max"))).toBe(MAC_MAX);
    expect(Act.consentText(Act.consentFiles("Max"))).toBe(FILES_MAX);
    for (const t of [MAC_MAX, FILES_MAX]) expect(t).not.toMatch(/\b(she|her|She|Her|she'll|She'll)\b/);
    expect(Act.consentMac("  ").title).toBe("Let Brenda do things on your Mac when you ask");
  });
  it("words the Mac's own permission steps (contract E.4)", () => {
    const w = Act.permissionWords("Max");
    expect(w.accessibility).toEqual({ title: "One more step on your Mac", sub: "Your Mac will ask you to allow Brenda under Privacy & Security › Accessibility. Turn on Brenda there. Max uses it only during a task you said yes to.", notNow: "Not now", go: "Continue" });
    expect(w.accessibilityDenied.title).toBe("Allow Brenda in System Settings");
    expect(w.accessibilityDenied.sub).toBe("Privacy & Security › Accessibility, then turn on Brenda. You may need to quit and reopen Brenda afterwards.");
    expect([w.accessibilityDenied.notNow, w.accessibilityDenied.check, w.accessibilityDenied.open]).toEqual(["Not now", "Check again", "Open System Settings"]);
    expect(w.accessibilityDenied.stillOff).toBe("Brenda isn't allowed yet. Turn it on in that list, then check again.");
    expect(w.finder.sub).toBe("Your Mac will ask whether Brenda can control Finder. Say OK so Max can see which files you select. You can say no: dropping files on Max still works.");
    expect(w.finder.go).toBe("Continue");
    expect(w.finderDenied.sub).toBe("Finder said no, so drop files on Max instead. You can change it in System Settings › Privacy & Security › Automation.");
  });
});

describe("asking (contract A.6)", () => {
  it("shows the plan as written, the fixed question, where to answer, No and Yes, do it", () => {
    const w = Act.askCard(TASK, { keysLabel: "⌃ ⌘" });
    expect(w.plan).toBe("I'll rename these 6 files to Invoice-01 to Invoice-06.");
    expect(w.question).toBe("Do you want me to do this?");
    expect(w.hint).toBe("Answer with Yes or No, or hold ⌃ ⌘ and say it. I'll wait a minute.");
    expect([w.no, w.yes, w.placeholder, w.listening, w.wait, w.saidYes]).toEqual(["No", "Yes, do it", "Or type yes or no", "Listening for your answer…", "One moment…", "You said yes."]);
    expect(w.file).toBe("");
    expect(w.risky).toBe("");
    expect(Act.askCard({ ...TASK, risky: true }).risky).toBe("I'll ask again before anything I can't undo.");
  });
  it("adds the file line for a file job: the file and what she will make, both as text", () => {
    expect(Act.askCard(FILE_TASK).file).toBe("Q3 report.pdf → Q3 report (Brenda brief).md");
    expect(Act.fileLine({ name: "Q3 report.pdf" }, { format: "doc", name: "Q3 brief" })).toBe("Q3 report.pdf → “Q3 brief” in Boredroom");
    expect(Act.fileLine({ name: "a‮b.pdf\n" }, { name: "x.md" })).toBe("a b.pdf → x.md");
    expect(Act.fileLine(null, null)).toBe("");
  });
  it("takes only a TaskView that reads as one: an id and a plan that starts \"I'll\"", () => {
    expect(Act.taskOf(TASK)?.plan).toBe(TASK.plan);
    expect(Act.taskOf({ ...TASK, plan: "Rename the files." })).toBeNull();
    expect(Act.taskOf({ ...TASK, id: "<script>" })).toBeNull();
    expect(Act.taskOf(null)).toBeNull();
    expect(Act.taskOf({ ...TASK, question: "Shall I? Press yes now!" })?.question).toBe("Do you want me to do this?");
    expect(Act.taskOf({ ...FILE_TASK, output: { format: "exe", name: "x" } })?.output).toEqual({ format: "md", name: "x" });
  });
  it("says what an answer led to", () => {
    expect(Act.outcome("no")).toEqual({ title: "Okay, I won't.", ms: 3000 });
    expect(Act.outcome("unclear")).toEqual({ title: "I didn't catch a clear yes, so I won't do it.", ms: 5000 });
    expect(Act.outcome("expired")).toEqual({ title: "I didn't hear a yes, so I won't do it.", ms: 5000 });
    expect(Act.outcome("new_request").title).toBe("Okay, I'll ask you about that instead.");
    expect(Act.ANSWER_MS).toBe(60_000);
  });
});

describe("outward steps (contract A.7.3)", () => {
  it("asks again with the step and why, for every kind", () => {
    const want: Record<string, string> = { send: "this sends something", submit: "this submits a form", delete: "this deletes something", pay: "this pays for something", share: "this shares something", publish: "this publishes something", sign_in: "this signs in", accept_terms: "this accepts terms", overwrite: "this replaces a file", quit: "this quits an app", other: "this can't be undone" };
    expect(Act.BECAUSE).toEqual(want);
    for (const [kind, because] of Object.entries(want)) expect(Act.stepCard({ kind, what: "press Send on the email to Ada" }).because).toBe(`I'm waiting because ${because}.`);
    const w = Act.stepCard({ kind: "send", what: "press Send on the email to Ada." });
    expect([w.title, w.question, w.no, w.yes]).toEqual(["Next I'll press Send on the email to Ada.", "Do you want me to do this?", "No, stop here", "Yes, do it"]);
    expect(w.saidNo).toEqual({ title: "Stopped before that step.", sub: "What I did before it stays done." });
    expect(Act.stepCard({ kind: "odd", what: "" }).because).toBe("I'm waiting because this can't be undone.");
  });
});

describe("doing, pausing and working (contract A.7, A.8)", () => {
  it("words the doing bar and card, with Stop when Esc could not be had", () => {
    const w = Act.doingWords({ step: 3, note: "Opening Finder…" });
    expect([w.bar, w.title, w.step, w.note, w.first, w.stop, w.kbd]).toEqual(["Working on it, Esc stops me", "Working on it", "Step 3", "Opening Finder…", "I'm using your mouse and keyboard. Press Esc to stop me.", "Stop", "esc"]);
    const s = Act.doingWords({ escRegistered: false });
    expect([s.bar, s.first, s.kbd]).toEqual(["Working on it", "I'm using your mouse and keyboard. Press Stop to stop me.", ""]);
    expect(Act.noteOf("x".repeat(80))).toHaveLength(48);
  });
  it("says why she paused", () => {
    expect(Act.pausedWords("moved")).toEqual({ title: "I paused", sub: "You moved the pointer, so I stopped for a moment.", stop: "Stop", go: "Carry on" });
    expect(Act.whyPaused("typed")).toBe("You typed something, so I stopped for a moment.");
    expect(Act.whyPaused("focus")).toBe("Another window came to the front, so I stopped for a moment.");
  });
  it("keeps a file job's clock", () => {
    expect(Act.elapsed(42_000)).toBe("0:42");
    expect(Act.elapsed(725_000)).toBe("12:05");
    expect(Act.elapsed(3_729_000)).toBe("1:02:09");
    expect(Act.elapsed(-5)).toBe("0:00");
    const w = Act.workingWords({ file: { name: "Q3 report.pdf" }, output: { format: "md", name: "Q3 report (Brenda brief).md" }, ms: 42_000 });
    expect([w.bar, w.title, w.sub, w.stop]).toEqual(["Working on Q3 report.pdf, 0:42", "Working on Q3 report.pdf", "I'll save Q3 report (Brenda brief).md next to it. You can carry on. Esc stops me.", "Stop"]);
    expect(Act.workingWords({ file: { name: "a.pdf" }, escRegistered: false }).sub).toBe("You can carry on.");
  });
});

describe("endings (contract A.7.5, A.7.6, A.8.4)", () => {
  it("says what was done: a screen task, a file saved next to the original, a Boredroom document", () => {
    expect(Act.doneCard({ kind: "screen", summary: "Renamed 6 files in Finder.", steps: 7 })).toMatchObject({ title: "Renamed 6 files in Finder.", sub: "Done in 7 steps.", ok: "OK" });
    expect(Act.doneCard({ summary: "x", steps: 1 }).sub).toBe("Done in 1 step.");
    expect(Act.doneCard({ kind: "file", output: { name: "Q3 report (Brenda brief).md", folder: "Documents" }, summary: "I've saved your brief next to the PDF." }, Act.taskOf(FILE_TASK)))
      .toMatchObject({ title: "Saved Q3 report (Brenda brief).md", sub: "Next to Q3 report.pdf in Documents.", reveal: "Show in Finder", open: "Open", ok: "OK", said: "I've saved your brief next to the PDF." });
    expect(Act.doneCard({ kind: "file", doc: { href: "/app/a/docs/1", title: "Q3 brief" } })).toMatchObject({ title: "Saved “Q3 brief” in Boredroom", open: "Open", ok: "OK" });
  });
  it("says where she stopped, and the reason's own words when there is one", () => {
    expect(Act.stoppedCard({ why: "esc", step: 5, note: "Renaming Invoice-04…" })).toEqual({ title: "Stopped.", sub: "I stopped before step 5. What I did before that stays done.", last: "The last thing I did: Renaming Invoice-04…" });
    expect(Act.stoppedCard({ why: "button", step: 1 }).sub).toBe("I stopped before doing anything.");
    expect(Act.stoppedCard({ why: "said_no", step: 3 })).toMatchObject({ title: "Stopped before that step.", sub: "What I did before it stays done." });
    expect(Act.stoppedCard({ why: "locked" })).toMatchObject({ title: "Your Mac locked", sub: "So I stopped. What I did before that stays done." });
    expect(Act.stoppedCard({ why: "esc" }, { kind: "file" })).toEqual({ title: "Stopped.", sub: "Your file is as it was.", last: "" });
    expect(Act.cannotCard("Finder asked for a password")).toEqual({ title: "I stopped", sub: "Finder asked for a password.", last: "What I did before that stays done." });
    expect(Act.failedCard({ message: "Claude couldn't be reached just now, so I stopped." })).toEqual({ title: "I couldn't finish that", sub: "Claude couldn't be reached just now, so I stopped. What I did before that stays done.", last: "" });
    expect(Act.failedCard({ code: "ACT_LIMIT", message: "You've used today's 150 requests to Max, so Max can't carry on. Try again tomorrow." }).title).toBe("You've used today's requests");
  });
  it("keeps one short line for the chat, and nothing else about the task", () => {
    expect(Act.chatLine("done", { summary: "Renamed 6 files in Finder." })).toBe("Renamed 6 files in Finder.");
    expect(Act.chatLine("stopped")).toBe("Stopped.");
    expect(Act.chatLine("said_no", { verdict: "no" })).toBe("Okay, I won't.");
    expect(Act.chatLine("said_no", { verdict: "unclear" })).toBe("I didn't catch a clear yes, so I won't do it.");
    expect(Act.chatLine("expired")).toBe("I didn't hear a yes, so I won't do it.");
  });
});

describe("refusals (contract A.10)", () => {
  const r = (reason: string, o: Record<string, unknown> = {}) => Act.refusal(reason, { name: "Max", app: { name: "1Password" }, ...o });
  it("says every row of the table", () => {
    // Phase 3 (companion2 M.7): the switches' new names; the card offers Turn it on (main.js).
    expect(r("use_mac_off")).toEqual({ title: "Doing things on your Mac is off", sub: "Turn on “Do things when I ask” in Help on this Mac. Max asks before every task." });
    expect(r("files_off")).toEqual({ title: "Working on files is off", sub: "Turn on “Work on my files” in Help on this Mac." });
    expect(r("unresolved", { message: "I couldn't find an app called “Figmaa” on this Mac" })).toEqual({ title: "I couldn't find an app called “Figmaa” on this Mac.", sub: "Nothing was done." });
    expect(r("act_not_available")).toEqual({ title: "On-screen actions aren't on in this workspace", sub: "" });
    expect(r("forbidden_app")).toEqual({ title: "I never work in 1Password", sub: "Password managers, Keychain, System Settings, Terminal, and messaging and call apps are always off limits." });
    expect(r("payment_page")).toEqual({ title: "I don't work on banking or payment pages", sub: "Do this one yourself." });
    expect(r("on_call")).toEqual({ title: "I don't look or work on your screen during a Boredroom call", sub: "Try again when the call ends." });
    expect(r("sharing")).toEqual({ title: "Your screen looks shared", sub: "I don't look or work while it's being shared." });
    expect(r("busy_task")).toEqual({ title: "I'm still on the last job", sub: "Wait for it to finish, or stop it in the notch." });
    expect(r("answer_first")).toEqual({ title: "Answer this one first", sub: "" });
    expect(r("cap", { n: 20 })).toEqual({ title: "That took more steps than I'm allowed", sub: "I stopped after 20 steps. What I did stays done." });
    expect(r("too_big", { n: 14 })).toEqual({ title: "This task got too big to send", sub: "I stopped after 14 steps. What I did stays done." });
    expect(r("time")).toEqual({ title: "That took longer than ten minutes", sub: "I stopped. What I did stays done." });
    expect(r("display_gone")).toEqual({ title: "That screen went away", sub: "So I stopped." });
    expect(r("locked")).toEqual({ title: "Your Mac locked", sub: "So I stopped." });
    expect(r("offline")).toEqual({ title: "I can't reach Boredroom right now", sub: "So I stopped." });
    expect(r("file_unresolved")).toEqual({ title: "I couldn't find that file", sub: "Select it in Finder or drop it on me, then ask again." });
    expect(r("file_too_big")).toEqual({ title: "That file is too big for me", sub: "I can work on files up to 25 MB." });
    expect(r("file_type")).toEqual({ title: "I can't read that kind of file yet", sub: "PDF, Word, text, Markdown, CSV, Excel and pictures work." });
    expect(r("file_scan")).toEqual({ title: "That PDF is a scan", sub: "It's too big for me to read as pictures. Try a smaller one." });
    expect(r("file_long", { pages: 212 })).toEqual({ title: "That file is too long for me", sub: "It's about 212 pages; I can read about 150." });
    expect(r("file_failed", { message: "Word couldn't be made" })).toEqual({ title: "I couldn't make that file", sub: "Word couldn't be made. Your file is as it was." });
    expect(r("pdf_unavailable")).toEqual({ title: "I can't make PDFs on this Mac yet", sub: "Ask for a Word document or Markdown instead." });
    expect(r("ACT_LIMIT", { message: "You've used today's 150 requests to Max" })).toEqual({ title: "You've used today's requests", sub: "You've used today's 150 requests to Max." });
    expect(r("anything else", { message: "Boredroom refused it" })).toEqual({ title: "I couldn't do that", sub: "Boredroom refused it." });
  });
});

describe("the yes grammar (contract 0.5: the same vectors as Rust and the server)", () => {
  const YES = ["yes", "Yes.", "yeah", "yep", "sure", "ok", "okay", "Yes please", "yes, do it", "Yes, I need you to do this.", "go ahead", "Do it", "please do", "Brenda, yes", "Max, yes go ahead", "yes yes", "OK, go ahead", "alright do it", "correct", "yes please go ahead", "yeah go for it", "yes thank you",
    // Review, 12 October 2026: everyday yeses, her name anywhere.
    "Yes, Brenda.", "Yes please Brenda", "Do it, Brenda.", "Yes, thanks Brenda.", "Yes, I need you to do this, Brenda.", "Yes, do it now.", "Yeah, go.", "Yes, go ahead and do it.",
    "Yeah, that's fine, do it.", "Yes, you can do it.", "Max, yes go ahead Max"];
  const NO = ["no", "No.", "nope", "no thanks", "not now", "don't", "stop", "cancel", "never mind", "no, don't do that", "No thanks, I'll do it myself later", "Cancel that, I changed my mind completely"];
  const UNCLEAR = ["", "hmm", "yes?", "yes but only the first three", "yes, wait", "maybe", "do it later", "yes and also rename the folder", "what will you do?", "sure, if it's quick", "yes no", "yeah actually rename them to receipts", "okay but not the PDFs", "I think so", "sounds good", "yes I need you to rename them", "and do it", "yes and", "go ahead and", "do it and also rename the folder"];
  it("hears a yes only in the plain shapes of yes", () => { for (const t of YES) expect(Act.verdict(t, "Max"), t).toBe("yes"); });
  it("hears a no", () => { for (const t of NO) expect(Act.verdict(t, "Max"), t).toBe("no"); });
  it("treats everything else as unclear, which is no", () => {
    for (const t of UNCLEAR) expect(Act.verdict(t, "Max"), t).toBe("unclear");
    expect(Act.verdict(null)).toBe("unclear");
    expect(Act.verdict("yes ".repeat(11))).toBe("unclear");
    expect(Act.verdict("Don’t")).toBe("no");
  });
  it("sends a typed answer as yes only on a yes", () => {
    expect(Act.typedAnswer("Yes please", "Max")).toEqual({ verdict: "yes", answer: "yes" });
    expect(Act.typedAnswer("maybe", "Max")).toEqual({ verdict: "unclear", answer: "no" });
    expect(Act.typedAnswer("no", "Max")).toEqual({ verdict: "no", answer: "no" });
  });
});

describe("Rust's ActStatus (contract B.11)", () => {
  it("is kept only when it reads as one; a missing one hides every act feature", () => {
    expect(Act.statusOf(null)).toBeNull();
    expect(Act.statusOf({ available: true })).toBeNull();
    const s = Act.statusOf({ supported: true, available: true, useMac: true, fileWork: false, accessibility: "nonsense", finder: "denied", escRegistered: true, task: { id: "t1", kind: "screen", phase: "running", plan: "I'll do it.", step: 3, startedAt: 5 } });
    expect(s).toMatchObject({ supported: true, useMac: true, fileWork: false, accessibility: "unknown", finder: "denied", escRegistered: true, task: { id: "t1", phase: "running", step: 3 } });
    expect(Act.statusOf({ supported: true, task: { id: "t1", phase: "exploding" } })?.task).toBeNull();
  });
  // Phase 3 (companion2 I.2): this build's Rust says what macOS answered for each folder, that it runs plans, and a plan's
  // phases; today's says none of it.
  it("keeps the folders, plans and a plan task from this build's Rust", () => {
    const s = Act.statusOf({ supported: true, folders: { documents: "granted", desktop: "nope", downloads: "denied" }, plans: 1, task: { id: "t2", kind: "plan", phase: "scoping", plan: "I'll open Figma." } });
    expect(s).toMatchObject({ folders: { documents: "granted", desktop: "unknown", downloads: "denied" }, plans: 1, task: { id: "t2", kind: "plan", phase: "scoping" } });
    expect(Act.statusOf({ supported: true })).toMatchObject({ folders: null, plans: 0 });
  });
});

// ---- plans (companion2 contract D, H.2.1, M.7) ----------------------------------------------------------------------
type PlanApi = ActApi & {
  partNote(step: unknown): string; partWords(part: unknown): string; folderWorkingWords(o?: Record<string, unknown>): Record<string, unknown>;
  planDoneCard(evt?: Record<string, unknown>): Record<string, unknown>; unresolvedCard(evt?: Record<string, unknown>, task?: unknown): Record<string, unknown>;
  scopingWords(plan: unknown): { plan: string; wait: string }; showWhich(n: number, open: boolean): string; localNames(v: unknown): string[];
  planLines(t: unknown): { text: string; icon: string }[]; folderName(f: unknown): string;
};
describe("plans: one sentence, its lines, one yes (companion2 D, M.7)", () => {
  const A = Act as PlanApi;
  const none = { source: "none", name: "" };
  const view = {
    id: "9b2f6c1e-1d2a-4c3b-9e8f-7a6b5c4d0001", kind: "plan", v: 2, plan: "I'll open Figma, make a new file called “Landing v2” and remind you at 3pm to review it.",
    question: "Do you want me to do this?", planSha256: "", answerBy: "2026-10-12T10:31:05Z", risky: false, stepCap: 20, needsScope: false, file: null, output: null,
    lines: ["Open Figma (Applications)", "On your screen: Make a new design file and name it “Landing v2”.", "Remind you at 15:00: review Landing v2"],
    steps: [
      { i: 0, kind: "open", target: "app", name: "Figma", url: "", folder: none, words: [], kinds: [], sinceDays: 0 },
      { i: 1, kind: "screen", goal: "Make a new design file and name it “Landing v2”." },
      { i: 2, kind: "boredroom", summary: "Remind you at 15:00: review Landing v2", outward: false },
    ],
  };
  it("takes a v2 TaskView with its steps and lines, and refuses a malformed one", () => {
    const t = A.taskOf(view) as Record<string, unknown> & { steps: Record<string, unknown>[] };
    expect(t).toMatchObject({ id: view.id, kind: "plan", v: 2, plan: view.plan, question: "Do you want me to do this?", needsScope: false, lines: view.lines, answerBy: Date.parse(view.answerBy) });
    expect(t.steps.map((s: Record<string, unknown>) => s.kind)).toEqual(["open", "screen", "boredroom"]);
    expect(A.taskOf({ ...view, v: 1 })).toBeNull();
    expect(A.taskOf({ ...view, steps: [] })).toBeNull();
    expect(A.taskOf({ ...view, steps: [{ ...view.steps[0], i: 1 }] })).toBeNull();
    expect(A.taskOf({ ...view, steps: [{ ...view.steps[0], target: "installer" }] })).toBeNull();
    expect(A.taskOf({ ...view, steps: [{ i: 0, kind: "launch" }] })).toBeNull();
    expect(A.taskOf({ ...view, steps: Array.from({ length: 7 }, (_, i) => ({ ...view.steps[1], i })) })).toBeNull();
    expect(A.taskOf({ ...view, steps: [{ i: 0, kind: "folder", folder: { source: "named", name: "Library" } }] })).toMatchObject({ steps: [{ folder: none }] });
    // While Brenda for Mac is finding what the plan names, no lines.
    expect(A.taskOf({ ...view, needsScope: true, lines: null })).toMatchObject({ needsScope: true, lines: null });
  });
  it("draws the sentence, the lines with their icons, and the fixed question", () => {
    const w = A.askCard(view) as unknown as { plan: string; question: string; lines: { text: string; icon: string }[]; file: string };
    expect(w.plan).toBe(view.plan);
    expect(w.question).toBe("Do you want me to do this?");
    expect(w.file).toBe("");
    expect(w.lines).toEqual([{ text: "Open Figma (Applications)", icon: "open" }, { text: "On your screen: Make a new design file and name it “Landing v2”.", icon: "pointer" }, { text: "Remind you at 15:00: review Landing v2", icon: "check" }]);
    expect(A.planLines({ steps: view.steps, lines: ["One line for all of it"] })).toEqual([{ text: "One line for all of it", icon: "check" }]);
    expect(A.scopingWords(view.plan)).toEqual({ plan: view.plan, wait: "Getting that ready…" });
    expect([A.showWhich(14, false), A.showWhich(14, true)]).toEqual(["Show the 14", "Hide them"]);
    expect(A.localNames(["Q3 report.pdf", "", "x".repeat(300), 4])).toEqual(["Q3 report.pdf", `${"x".repeat(119)}…`]);
  });
  it("says what each part is doing (M.7)", () => {
    expect(A.partNote(view.steps[0])).toBe("Opening Figma…");
    expect(A.partNote({ kind: "open", target: "url", url: "https://www.figma.com/files" })).toBe("Opening figma.com…");
    expect(A.partNote({ kind: "open", target: "url", url: "javascript:alert(1)" })).toBe("");
    expect(A.partNote({ kind: "open", target: "folder", folder: { source: "named", name: "documents" } })).toBe("Opening Documents…");
    expect(A.partNote({ kind: "open", target: "folder", folder: { source: "named", name: "home" } })).toBe("Opening your home folder…");
    expect(A.partNote({ kind: "open", target: "file", name: "Invoice 1042.pdf" })).toBe("Opening Invoice 1042.pdf…");
    expect(A.partNote({ kind: "open", target: "reveal", name: "Invoice 1042.pdf" })).toBe("Showing Invoice 1042.pdf in Finder…");
    expect(A.partNote(view.steps[2])).toBe("Making the change in Boredroom…");
    expect(A.partNote(view.steps[1])).toBe("");
    expect([A.partWords({ k: 2, of: 3 }), A.partWords({ k: 4, of: 3 }), A.partWords(null)]).toEqual(["Part 2 of 3", "", ""]);
    expect(Act.doingWords({ step: 5, part: { k: 2, of: 3 } }).step).toBe("Part 2 of 3");
    expect(Act.doingWords({ step: 5 }).step).toBe("Step 5");
  });
  it("words a folder job's progress, then its saving", () => {
    const w = A.folderWorkingWords({ folder: { name: "Documents", done: 3, of: 14 }, output: { format: "docx", name: "Documents summary.docx" }, ms: 65_000 });
    expect(w).toEqual({ bar: "Reading 4 of 14, 1:05", reading: "Reading 4 of 14", title: "Working on Documents", sub: "Reading 4 of 14 documents. I'll save “Documents summary.docx” in Documents. You can carry on. Esc stops me.", stop: "Stop", saving: false });
    const s = A.folderWorkingWords({ folder: { name: "Documents", done: 14, of: 14 }, output: { format: "docx", name: "Documents summary.docx" }, escRegistered: false });
    expect([s.bar, s.sub, s.saving]).toEqual(["Saving “Documents summary.docx”…", "Saving “Documents summary.docx”…", true]);
  });
  it("ends with Boredroom's summary, where it saved, and what it skipped; or why it couldn't get ready", () => {
    expect(A.planDoneCard({ summary: "Opened Figma and set a reminder for 15:00" })).toMatchObject({ kind: "plan", title: "Opened Figma and set a reminder for 15:00.", sub: "Done.", outputs: [], doc: null });
    expect(A.planDoneCard({ summary: "I've written a summary of each of the 14 documents in Documents into Documents summary.docx.", outputs: [{ name: "Documents summary.docx", folder: "Documents" }], skipped: 2 }))
      .toMatchObject({ sub: "Saved in Documents. I skipped 2: they were too long or couldn't be read.", reveal: "Show in Finder", open: "Open", ok: "OK" });
    const opens = { steps: [view.steps[0]] };
    expect(A.unresolvedCard({ message: "I couldn't find an app called “Figmaa” on this Mac.", settings: null }, opens)).toEqual({ title: "I couldn't find an app called “Figmaa” on this Mac.", sub: "Nothing was opened.", settings: null, open: "Open System Settings", ok: "OK" });
    expect(A.unresolvedCard({ message: "Your Mac hasn't let Brenda into Documents.", settings: "files" }, { steps: [] })).toMatchObject({ sub: "Nothing was done.", settings: "files" });
    expect(Act.chatLine("done", { kind: "plan", summary: "Opened Figma" }, { kind: "plan" })).toBe("Opened Figma.");
    expect(Act.chatLine("unresolved", { message: "I couldn't find that folder." })).toBe("I couldn't find that folder.");
  });
});

describe("the notch page (contract 0.2, 0.9, C.0, C.9)", () => {
  const main = file("desktop/src/main.js");
  const src = readdirSync(fileURLToPath(new URL("../../desktop/src", import.meta.url))).filter((f) => /\.(js|html|css)$/.test(f));
  it("never calls the act or look routes: no file in desktop/src names them", () => {
    for (const f of src) expect(file(`desktop/src/${f}`), f).not.toMatch(/\/assistant\/act|\/assistant\/look/);
  });
  it("Yes on a task is act_answer and nothing else", () => {
    expect(main).toMatch(/if \(act === "act-yes"\) return answerTask\("yes", "button"\);/);
    const body = main.slice(main.indexOf("async function answerTask("), main.indexOf("/** Enter in the asking card's box"));
    const invokes = [...body.matchAll(/invoke\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(invokes).toEqual(["act_answer"]);
    expect(body).not.toMatch(/\bcall\(|\/brenda\/confirm/);
    // The Yes button is never a card's Enter target (a stray Enter is never a yes).
    expect(main).not.toMatch(/data-act="act-yes"[^>]*data-main/);
  });
  it("starts nothing: a task appears only as Rust's asking event, and Y and N never answer one", () => {
    expect([...main.matchAll(/phase: "asking"/g)].length).toBeGreaterThan(0);
    expect(main).not.toMatch(/invoke\("act_(?:start|propose|run|step)/);
    expect(main).toMatch(/Y and N are never used for tasks/);
  });
  it("guards every new command, so today's Rust (without them) keeps working", () => {
    for (const cmd of ["act_status", "act_answer", "act_stop", "act_continue", "act_expect_answer", "act_set_use_mac", "act_set_file_work", "act_request_accessibility", "act_open_accessibility_settings", "act_reveal", "act_open_output", "act_file_from_drop", "look_set_options", "look_follow_up", "look_drop_held", "speak_queue", "companion_set_look", "companion_speaking"]) {
      expect(main, cmd).toContain(`"${cmd}"`);
    }
    for (const m of main.matchAll(/invoke\("(act_stop|act_continue|act_expect_answer|act_reveal|act_open_output|act_open_accessibility_settings|look_drop_held|companion_set_look|companion_speaking|speak_queue)"/g)) {
      const call = main.slice(m.index, main.indexOf(";\n", m.index));
      expect(call, m[1]).toMatch(/\.catch\(/);
    }
    expect(main).toMatch(/actStatus = await invoke\("act_status"\)\.then\(Act\.statusOf\)\.catch\(\(\) => null\);/);
  });
});
