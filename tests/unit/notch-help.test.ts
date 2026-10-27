import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Brenda for Mac, phase 3: one clear setup, and never just "I can't" (owner report and requests, 12 October 2026: "I
// wanted Brenda to assist me with some things, like open an app on my desktop, and it said it can't do that, why?";
// "when I turned this setting on, I stopped seeing my Brenda"; companion2 contract A, F, J.5). desktop/src/help.js, a
// classic browser script that also loads in Node: the setup card's words (M.1), the steps' (M.2), the companion's status
// (M.5) and the reply offers (M.6) word for word, in both naming versions; the ticks, the steps for each binary and each
// permission, what this Mac tells Boredroom (A.6), when "Set up on my Mac" opens the card (0b.3). Then the page: the
// card's "Turn these on" calls `help_setup` (or today's three commands) and nothing else, "Ask again" is the Look
// button's flow, and setup never starts a task.

type Rows = Record<"look" | "mac" | "files", { shown: boolean; on: boolean; ticked: boolean; disabled: boolean; needsLook: boolean }>;
type Para = { lead?: string; text: string; keys?: string };
type SetupWords = { title: string; lead: string; rows: Record<"look" | "mac" | "files", { label: string; sub: string }>; on: string; needsLook: string; promises: string[]; read: string; less: string;
  headings: Record<string, string>; notNow: string; turnOnMany: string; turnOnOne: string; footer: string; errors: Record<string, string> };
type StepWords = Record<string, Record<string, string>> & {
  folders: Record<string, string> & { allowed(f: string): string; notAllowed(f: string): string };
  done: Record<string, string> & { asked(words: string): string };
  again: Record<string, string> & { title(label: string): string };
};
type HelpApi = {
  KEYS: string; SETUP_FRESH_MS: number; KEEP_MS: number; ABILITIES: string[]; FOLDERS: string[]; WHYS: string[]; SHOWN_WHYS: string[]; HIDDEN_WHYS: string[];
  setupWords(name?: string, keys?: string): SetupWords;
  readEverything(name?: string, keys?: string, v?: number): { key: string; heading: string; paras: Para[] }[];
  setupTicks(st: Record<string, unknown>, focus?: string | null, o?: { request?: boolean }): Rows;
  toggleTick(rows: Rows, which: string): Rows;
  toTurnOn(rows: Rows): string[];
  turnOnLabel(rows: Rows, name?: string): string | null;
  setupSteps(look: unknown, act: unknown, binary: number, o?: Record<string, unknown>): string[];
  stepWords(name?: string, keys?: string): StepWords;
  folderLines(folders: unknown, name?: string): { lines: string[]; denied: boolean };
  doneLines(look: unknown, act: unknown, name?: string): string[];
  enableWords(which: string, name?: string, needs?: string[] | null): { line: string; button: string; focus: string } | null;
  enableNeedsOf(r: unknown): string[];
  offerWords(name?: string): Record<string, string>;
  setupOf(r: unknown): string | null | undefined;
  enableOf(r: unknown): string | null;
  keptOf(k: unknown, now?: number): { words: string; at: number } | null;
  companionWords(why: unknown, name?: string): { shown: boolean | null; sentence: string; tray: string };
  companionWhyOf(look: unknown): string | null;
  macStateBody(look: unknown, act: unknown, setupSeen?: unknown): { version: number; state: Record<string, unknown> & { supported: boolean }; setupSeen: string | null };
  setupFresh(setupAt: unknown, lastSeen: unknown, serverNowMs: number): boolean;
};

const require = createRequire(import.meta.url);
// The page's one scope: look.js and act.js load before help.js and it reads them from there.
const g = globalThis as Record<string, unknown>;
g.Look = require("../../desktop/src/look.js");
g.Act = require("../../desktop/src/act.js");
const Help = require("../../desktop/src/help.js") as HelpApi;
const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const off = { look: false, mac: false, files: false };

describe("the setup card's words (M.1)", () => {
  it("says Brenda's words exactly", () => {
    const w = Help.setupWords("Brenda");
    expect(w.title).toBe("Let Brenda help on this Mac");
    expect(w.lead).toBe("Choose what Brenda can do here. She does something only when you ask, and checks with you first.");
    expect(w.rows.look).toEqual({ label: "See my screen when I ask", sub: "Hold ⌃ ⌘ and ask. She looks once at the screen your pointer is on, answers, and can point at things. The picture is never kept." });
    expect(w.rows.mac).toEqual({ label: "Do things when I ask", sub: "Open apps, files, folders and pages, and click and type for you, one step at a time. She says exactly what she'll do and asks “Do you want me to do this?”. Nothing happens until you say yes." });
    expect(w.rows.files).toEqual({ label: "Work on my files", sub: "Find your files, read them and write summaries or new files next to them while you carry on. She never changes or replaces yours." });
    expect(w.on).toBe("On");
    expect(w.needsLook).toBe("Doing things and working on files need this: it's how she knows what you mean.");
    expect(w.promises).toEqual([
      "Only when you ask. Silence means no. Esc, her keys or Stop stops her at once.",
      "Never in password managers, Keychain, System Settings, Terminal, or messaging and call apps, never on banking or payment pages, and never installers or scripts.",
      "Your workspace can't see any of this. Only you can see which of these are on, in Boredroom › Settings › Your assistant.",
    ]);
    expect([w.read, w.less]).toEqual(["Read everything", "Show less"]);
    expect(w.headings).toEqual({ look: "Seeing your screen", mac: "Doing things", files: "Your files", leaves: "What leaves your Mac", kept: "What's kept" });
    expect([w.notNow, w.turnOnMany, w.turnOnOne]).toEqual(["Not now", "Turn these on", "Turn this on"]);
    expect(w.footer).toBe("Your Mac asks for its own permissions next. Turn any of it off from the menu bar or Settings › Your assistant.");
    expect(w.errors).toEqual({ failed: "That couldn't be turned on. Try again.", needsLook: "Seeing your screen needs to be on for that." });
  });
  it("uses the name, never she or her, for a renamed assistant", () => {
    const w = Help.setupWords("Max");
    expect(w.title).toBe("Let Max help on this Mac");
    expect(w.lead).toBe("Choose what Max can do here. Max does something only when you ask, and checks with you first.");
    expect(w.rows.look.sub).toBe("Hold ⌃ ⌘ and ask. Max looks once at the screen your pointer is on, answers, and can point at things. The picture is never kept.");
    expect(w.rows.mac.sub).toBe("Open apps, files, folders and pages, and click and type for you, one step at a time. Max says exactly what Max will do and asks “Do you want me to do this?”. Nothing happens until you say yes.");
    expect(w.rows.files.sub).toBe("Find your files, read them and write summaries or new files next to them while you carry on. Max never changes or replaces yours.");
    expect(w.needsLook).toBe("Doing things and working on files need this: it's how Max knows what you mean.");
    expect(w.promises[0]).toBe("Only when you ask. Silence means no. Esc, Max's keys or Stop stops Max at once.");
    for (const s of JSON.stringify(w).match(/\b(she|her|She|Her)\b/g) ?? []) expect(s, "no she/her for Max").toBeUndefined();
    expect(Help.setupWords("  ").title).toBe("Let Brenda help on this Mac");
  });
  it("keeps the old consents' words whole under Read everything, in five sections", () => {
    const r = Help.readEverything("Brenda");
    expect(r.map((s) => s.heading)).toEqual(["Seeing your screen", "Doing things", "Your files", "What leaves your Mac", "What's kept"]);
    const text = (k: string) => r.find((s) => s.key === k)!.paras.map((p) => (p.lead ? `${p.lead} ${p.text}` : p.text));
    expect(text("look")[0]).toMatch(/^Hold Control\+Command and ask\. Brenda looks once at the screen your pointer is on/);
    expect(text("look").at(-1)).toMatch(/^She never looks at password manager, messaging or call apps\./);
    expect(text("mac")[0]).toMatch(/^When you ask her to do something on your screen/);
    expect(text("mac")).toHaveLength(4);
    expect(text("files")[0]).toMatch(/^Ask her to summarise a PDF/);
    expect(text("leaves").map((t) => t.split(".")[0])).toEqual(["Who else sees the picture", "What leaves your Mac", "What leaves your Mac"]);
    expect(text("kept")).toEqual([expect.stringMatching(/^Nothing is kept\./), expect.stringMatching(/^Your workspace can't see it\./), "Your workspace can't see any of this. Only you can see which of these are on, in Boredroom › Settings › Your assistant."]);
    // Phase 1's words for a phase 1 Rust (every picture shown first).
    expect(Help.readEverything("Brenda", "⌃ ⌘", 1)[0].paras[0].text).toMatch(/the window in front of you/);
    expect(JSON.stringify(Help.readEverything("Max"))).not.toMatch(/\b(she|her)\b/i);
  });
});

describe("the ticks (0b.1, A.1 items 2 and 3)", () => {
  const t = (rows: Rows) => Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [v.ticked, v.disabled, v.on]]));
  it("pre-ticks every ability that is off when there is no focus", () => {
    expect(t(Help.setupTicks(off, null))).toEqual({ look: [true, false, false], mac: [true, false, false], files: [true, false, false] });
    expect(Help.turnOnLabel(Help.setupTicks(off, null), "Brenda")).toBe("Turn these on");
  });
  it("with a focus while something is on, ticks that ability, the others as they are", () => {
    expect(t(Help.setupTicks({ look: true, mac: false, files: false }, "mac"))).toEqual({ look: [true, true, true], mac: [true, false, false], files: [false, false, false] });
    expect(Help.toTurnOn(Help.setupTicks({ look: true, mac: false, files: false }, "mac"))).toEqual(["mac"]);
    expect(Help.turnOnLabel(Help.setupTicks({ look: true, mac: false, files: false }, "mac"))).toBe("Turn this on");
    expect(t(Help.setupTicks({ look: true, mac: true, files: false }, "files"))).toEqual({ look: [true, true, true], mac: [true, true, true], files: [true, false, false] });
  });
  // Review, 12 October 2026 (experience-1): from the owner's all-off state, the hold, the Look button and the tray opened
  // the card focused on seeing, so only See was ticked and "find last week's invoice and open it" took three setups.
  it("with nothing on yet, or opened for a request, ticks every ability that is off", () => {
    const all = { look: [true, false, false], mac: [true, false, false], files: [true, false, false] };
    expect(t(Help.setupTicks(off, "look"))).toEqual(all);
    expect(t(Help.setupTicks(off, "files"))).toEqual(all);
    expect(Help.turnOnLabel(Help.setupTicks(off, "look"), "Brenda")).toBe("Turn these on");
    expect(t(Help.setupTicks({ look: true, mac: false, files: false }, "mac", { request: true }))).toEqual({ look: [true, true, true], mac: [true, false, false], files: [true, false, false] });
    expect(Help.toTurnOn(Help.setupTicks({ look: true, mac: false, files: false }, "mac", { request: true }))).toEqual(["mac", "files"]);
    // Rows this Mac doesn't offer stay hidden and unticked.
    expect(Help.toTurnOn(Help.setupTicks({ ...off, offer: { mac: false, files: false } }, "look"))).toEqual(["look"]);
  });
  it("shows an ability already on ticked, disabled and On, and never turns it on again", () => {
    const rows = Help.setupTicks({ look: true, mac: true, files: false }, null);
    expect(t(rows)).toEqual({ look: [true, true, true], mac: [true, true, true], files: [true, false, false] });
    expect(Help.toTurnOn(rows)).toEqual(["files"]);
    expect(Help.toggleTick(rows, "look")).toEqual(rows);
  });
  it("unticking seeing unticks and disables doing and files, with the needs-look line", () => {
    const rows = Help.toggleTick(Help.setupTicks(off, null), "look");
    expect(t(rows)).toEqual({ look: [false, false, false], mac: [false, true, false], files: [false, true, false] });
    expect([rows.mac.needsLook, rows.files.needsLook]).toEqual([true, true]);
    expect(Help.toggleTick(rows, "mac")).toEqual(rows);
    expect(Help.turnOnLabel(rows)).toBeNull();
    const back = Help.toggleTick(rows, "look");
    expect(t(back)).toEqual({ look: [true, false, false], mac: [false, false, false], files: [false, false, false] });
    expect(Help.toTurnOn(Help.toggleTick(back, "files"))).toEqual(["look", "files"]);
  });
  it("hides doing and files where this Mac or the workspace has none", () => {
    const rows = Help.setupTicks({ ...off, offer: { mac: false, files: false } }, null);
    expect([rows.mac.shown, rows.files.shown, rows.mac.ticked]).toEqual([false, false, false]);
    expect(Help.toTurnOn(rows)).toEqual(["look"]);
  });
});

describe("macOS's steps (A.1's table)", () => {
  const all = { useMac: true, fileWork: true, accessibility: "unknown", finder: "unknown", folders: { documents: "unknown", desktop: "unknown", downloads: "unknown" } };
  it("asks for each missing permission in order on this build's Rust", () => {
    expect(Help.setupSteps({ on: true, permission: "unknown" }, all, 3)).toEqual(["screen", "accessibility", "finder", "folders", "done"]);
    expect(Help.setupSteps({ on: true, permission: "denied" }, { ...all, accessibility: "denied" }, 3)).toEqual(["screen-denied", "accessibility-denied", "finder", "folders", "done"]);
    expect(Help.setupSteps({ on: true, permission: "granted" }, { ...all, accessibility: "granted", finder: "granted", folders: { documents: "granted", desktop: "denied", downloads: "granted" } }, 3)).toEqual(["done"]);
    expect(Help.setupSteps({ on: true, permission: "granted" }, { ...all, accessibility: "granted", finder: "denied", folders: { documents: "granted", desktop: "granted", downloads: "unknown" } }, 3)).toEqual(["folders", "done"]);
  });
  it("skips what is off, and on today's binary asks about Finder only as file work turns on", () => {
    expect(Help.setupSteps({ on: false, permission: "unknown" }, { ...all, useMac: false, fileWork: false }, 3)).toEqual(["done"]);
    expect(Help.setupSteps({ on: true, permission: "unknown" }, { ...all, folders: null }, 2)).toEqual(["screen", "accessibility", "done"]);
    expect(Help.setupSteps({ on: true, permission: "granted" }, { ...all, accessibility: "granted", finder: "denied", folders: null }, 2, { finderAsked: true })).toEqual(["finder-denied", "done"]);
    expect(Help.setupSteps({ on: true, permission: "granted" }, { ...all, accessibility: "granted", finder: "denied", folders: null }, 2)).toEqual(["done"]);
    expect(Help.setupSteps({ on: true, permission: "granted" }, null, 2)).toEqual(["done"]);
  });
  it("says each step's words (M.2), Brenda for macOS and System Settings, the name in the titles", () => {
    const w = Help.stepWords("Brenda");
    expect(w.screen).toEqual({ title: "Next: let Brenda see the screen", sub: "Your Mac will ask to let Brenda record this computer's screen. That's how she sees it when you ask: one picture each time, never a video.", skip: "Skip", go: "Continue" });
    expect(w["screen-denied"]).toEqual({ title: "Allow Boredroom in System Settings", sub: "Privacy & Security › Screen & System Audio Recording, then turn on Boredroom. You may need to quit and reopen Boredroom afterwards.", skip: "Skip", check: "Check again", open: "Open System Settings", stillOff: "Boredroom isn't allowed yet. Turn it on in that list, then check again." });
    expect(w.accessibility).toEqual({ title: "Next: let Brenda use the mouse and keyboard", sub: "Your Mac will ask you to allow Boredroom under Privacy & Security › Accessibility. She uses it only during a task you said yes to. Opening apps, files and pages works without it; clicking and typing need it.", skip: "Skip", go: "Continue" });
    expect(w["accessibility-denied"]).toEqual({ title: "Allow Boredroom in System Settings", sub: "Privacy & Security › Accessibility, then turn on Boredroom. You may need to quit and reopen Boredroom afterwards.", skip: "Skip", check: "Check again", open: "Open System Settings", stillOff: "Boredroom isn't allowed yet. Turn it on in that list, then check again." });
    expect(w.finder).toEqual({ title: "Next: let Brenda ask Finder", sub: "Your Mac will ask whether Brenda can control Finder. Say OK so she can see which files and folders you've selected. You can say no: dropping files on her still works.", skip: "Skip", go: "Continue" });
    expect(w["finder-denied"]).toEqual({ title: "Finder said no", sub: "So drop files on her, or name the folder. You can change it in System Settings › Privacy & Security › Automation.", open: "Open System Settings", ok: "OK" });
    expect([w.folders.title, w.folders.sub, w.folders.skip, w.folders.go, w.folders.denied, w.folders.open, w.folders.ok]).toEqual(["Last: your folders", "Your Mac will ask, once for each, whether Brenda may use your Documents, Desktop and Downloads folders. Say OK to the ones you want her to work in. She looks in a folder only when you ask.", "Skip", "Continue", "You can change it in System Settings › Privacy & Security › Files and Folders.", "Open System Settings", "OK"]);
    expect([w.done.title, w.done.sub, w.done.asked("open Figma"), w.done.again, w.done.ok]).toEqual(["Brenda can help on this Mac", "Hold ⌃ ⌘ and ask her anything about your screen, or to do something.", "You asked: “open Figma”.", "Ask again", "Done"]);
    const m = Help.stepWords("Max");
    expect(m.screen.title).toBe("Next: let Max see the screen");
    expect(m.screen.sub).toBe("Your Mac will ask to let Brenda record this computer's screen. That's how Max sees it when you ask: one picture each time, never a video.");
    expect(m.finder.sub).toBe("Your Mac will ask whether Brenda can control Finder. Say OK so Max can see which files and folders you've selected. You can say no: dropping files on Max still works.");
    expect(m.done.title).toBe("Max can help on this Mac");
    expect(m.done.sub).toBe("Hold ⌃ ⌘ and ask Max anything about your screen, or to do something.");
    expect(JSON.stringify(m)).not.toMatch(/\b(she|her|She|Her)\b/);
  });
  it("says what macOS answered for each folder, and what is on at the end", () => {
    expect(Help.folderLines({ documents: "denied", desktop: "granted", downloads: "unknown" })).toEqual({ lines: ["Documents: not allowed", "Desktop: allowed"], denied: true });
    expect(Help.folderLines(null)).toEqual({ lines: [], denied: false });
    expect(Help.doneLines({ on: true, permission: "granted" }, { useMac: true, accessibility: "denied", fileWork: true, finder: "denied" })).toEqual(["Seeing your screen: on", "Doing things: on (clicking and typing need Accessibility)", "Working on your files: on (Finder said no)"]);
    expect(Help.doneLines({ on: true, permission: "unknown" }, null)).toEqual(["Seeing your screen: on (Screen Recording isn't allowed yet)"]);
  });
});

describe("never just \"I can't\" (A.4, M.6)", () => {
  it("names the switch that is off and offers to turn it on", () => {
    expect(Help.enableWords("mac", "Brenda")).toEqual({ line: "“Do things when I ask” is off on this Mac.", button: "Turn it on", focus: "mac" });
    expect(Help.enableWords("files", "Max")).toEqual({ line: "“Work on my files” is off on this Mac.", button: "Turn it on", focus: "files" });
    expect(Help.enableWords("accessibility", "Brenda")).toEqual({ line: "Brenda needs Accessibility to click and type for you.", button: "Allow it", focus: "accessibility" });
    expect(Help.enableWords("accessibility", "Max")?.line).toBe("Max needs Accessibility to click and type for you.");
    expect(Help.enableWords("delete", "Max")).toBeNull();
    // Every switch the request needs, in one line and one press (review, 12 October 2026).
    expect(Help.enableWords("mac", "Brenda", ["mac", "files"])).toEqual({ line: "“Do things when I ask” and “Work on my files” are off on this Mac.", button: "Turn them on", focus: "mac" });
    expect(Help.enableWords("mac", "Brenda", ["mac"])?.button).toBe("Turn it on");
    expect(Help.offerWords("Brenda")).toEqual({ setup: "Set up", setupTitle: "Opens the setup on this Mac. Nothing turns on until you say so there.", screenOff: "Set up Brenda on this Mac" });
    expect(Help.offerWords("Max").screenOff).toBe("Set up Max on this Mac");
  });
  it("reads a reply's setup and enable strictly", () => {
    expect(Help.setupOf({ which: "all" })).toBeNull();
    expect(Help.setupOf({ which: "files" })).toBe("files");
    expect(Help.setupOf({ which: "everything" })).toBeUndefined();
    expect(Help.setupOf(undefined)).toBeUndefined();
    expect(Help.enableOf({ which: "accessibility" })).toBe("accessibility");
    expect(Help.enableOf({ which: "look" })).toBeNull();
    expect(Help.enableNeedsOf({ which: "mac", needs: ["mac", "files", "rm"] })).toEqual(["mac", "files"]);
    expect(Help.enableNeedsOf({ which: "files" })).toEqual(["files"]);
    expect(Help.enableNeedsOf({ which: "look", needs: ["mac"] })).toEqual([]);
  });
  it("keeps the person's words ten minutes, no longer", () => {
    expect(Help.keptOf({ words: "  open   Figma ", at: 1_000 }, 1_000 + 60_000)).toEqual({ words: "open Figma", at: 1_000 });
    expect(Help.keptOf({ words: "open Figma", at: 1_000 }, 1_000 + Help.KEEP_MS)).toBeNull();
    expect(Help.keptOf({ words: "", at: 1_000 }, 2_000)).toBeNull();
    expect(Help.keptOf(null)).toBeNull();
  });
});

describe("the companion's status (F, M.5)", () => {
  it("reads every shown reason as shown, in both naming versions", () => {
    for (const why of Help.SHOWN_WHYS) expect(Help.companionWords(why, "Brenda")).toEqual({ shown: true, sentence: "She's by your pointer. She steps aside while you type or keep still.", tray: "By your pointer" });
    expect(Help.companionWords("idle", "Max").sentence).toBe("Max is by your pointer. Max steps aside while you type or keep still.");
  });
  it("says why she is hidden, for every hidden reason", () => {
    const want: Record<string, [string, string]> = {
      setting_off: ["Hidden: “Show Brenda by my pointer” is off.", "Hidden: switched off"],
      screen_help_off: ["Hidden: seeing your screen is off. Set her up again to bring her back.", "Hidden: seeing your screen is off"],
      signed_out: ["Hidden: you're signed out.", "Hidden: signed out"],
      locked: ["Hidden while your Mac is locked.", "Hidden: Mac locked"],
      call: ["Hidden during a Boredroom call.", "Hidden during a call"],
      sharing: ["Hidden while your screen may be shared.", "Hidden: screen may be shared"],
      screenshot_tool: ["Hidden while you take a screenshot.", "Hidden: taking a screenshot"],
      mirrored: ["Hidden while your screen is mirrored.", "Hidden: screen mirrored"],
      full_screen: ["Hidden while an app is full screen.", "Hidden: an app is full screen"],
    };
    expect(Object.keys(want).sort()).toEqual([...Help.HIDDEN_WHYS].sort());
    for (const [why, [sentence, tray]] of Object.entries(want)) expect(Help.companionWords(why, "Brenda"), why).toEqual({ shown: false, sentence, tray });
    expect(Help.companionWords("screen_help_off", "Max").sentence).toBe("Hidden: seeing your screen is off. Set Max up again to bring Max back.");
    expect(Help.companionWords("setting_off", "Max").sentence).toBe("Hidden: “Show Max by my pointer” is off.");
  });
  it("with today's binary (no reason), works out what it can", () => {
    expect(Help.companionWords(null, "Brenda")).toEqual({ shown: null, sentence: "She's by your pointer while screen help is on. She steps aside while you type or keep still.", tray: "" });
    expect(Help.companionWhyOf({ on: true, companion: false })).toBe("setting_off");
    expect(Help.companionWhyOf({ on: false, companion: true })).toBe("screen_help_off");
    expect(Help.companionWhyOf({ on: true, companion: true })).toBeNull();
    expect(Help.companionWhyOf({ on: true, companion: true, companionWhy: "call" })).toBe("call");
    expect(Help.companionWhyOf({ on: true, companion: true, companionWhy: "<b>" })).toBeNull();
  });
});

describe("what this Mac tells Boredroom, for the person alone (A.6)", () => {
  it("is A.6's body from this build's Rust", () => {
    const look = { v: 3, supported: true, on: true, consent: 3, permission: "granted", companion: true, companionShown: false, companionWhy: "call", preview: false };
    const act = { useMac: true, accessibility: "denied", fileWork: true, finder: "granted", folders: { documents: "granted", desktop: "denied", downloads: "unknown" } };
    expect(Help.macStateBody(look, act, "2026-10-12T05:38:00.000Z")).toEqual({
      version: 1,
      state: { v: 1, binary: 3, supported: true, look: { on: true, permission: "granted" }, mac: { on: true, accessibility: "denied" }, files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "denied", downloads: "unknown" } }, companion: { on: true, shown: false, why: "call" }, preview: false },
      setupSeen: "2026-10-12T05:38:00.000Z",
    });
  });
  it("leaves today's binary's unknowns null, and counts seeing only under the current consent", () => {
    const b = Help.macStateBody({ v: 2, supported: true, on: true, consent: 1, permission: "weird", companion: false, preview: true }, null);
    expect(b.state).toEqual({ v: 1, binary: 2, supported: true, look: { on: false, permission: "unknown" }, mac: { on: false, accessibility: "unknown" }, files: { on: false, finder: "unknown", folders: null }, companion: { on: false, shown: null, why: null }, preview: true });
    expect(b.setupSeen).toBeNull();
    expect(Help.macStateBody(null, null).state.supported).toBe(false);
    // Nothing but on/off and macOS's answers: no names, paths or anything seen.
    expect(Object.keys(b).sort()).toEqual(["setupSeen", "state", "version"]);
  });
});

describe("\"Set up on my Mac\" from Boredroom (0b.3)", () => {
  const at = "2026-10-12T05:40:00.000Z", t = Date.parse(at);
  it("opens the card once, within 15 minutes of the press on the server's clock", () => {
    expect(Help.setupFresh(at, null, t + 60_000)).toBe(true);
    expect(Help.setupFresh(at, null, t + Help.SETUP_FRESH_MS)).toBe(true);
    expect(Help.setupFresh(at, null, t + Help.SETUP_FRESH_MS + 1)).toBe(false);
    expect(Help.setupFresh(at, at, t + 60_000)).toBe(false);
    expect(Help.setupFresh(at, "2026-10-12T05:30:00.000Z", t + 60_000)).toBe(true);
    expect(Help.setupFresh(null, null, t)).toBe(false);
    expect(Help.setupFresh("not a date", null, t)).toBe(false);
    // A press far in the future (a broken clock) is not taken.
    expect(Help.setupFresh(at, null, t - 5 * 60_000)).toBe(false);
  });
});

describe("the notch page (companion2 0.5, J.0, J.2)", () => {
  const main = file("desktop/src/main.js");
  const fn = (name: string, next: string) => main.slice(main.indexOf(name), main.indexOf(next, main.indexOf(name) + name.length));
  it("parses, and loads help.js after act.js and before main.js", () => {
    expect(() => execFileSync(process.execPath, ["--check", "desktop/src/help.js"], { stdio: "pipe" })).not.toThrow();
    const html = file("desktop/src/index.html");
    expect(html.indexOf('<script src="act.js">')).toBeLessThan(html.indexOf('<script src="help.js">'));
    expect(html.indexOf('<script src="help.js">')).toBeLessThan(html.indexOf('<script src="main.js">'));
    expect(file("desktop/src/help.js")).not.toMatch(/\binvoke\(|__TAURI__|\bfetch\(|innerHTML/);
  });
  it("Turn these on calls help_setup, or today's three commands, and nothing else", () => {
    const body = fn("async function helpTurnOn(", "/** Continue on one of macOS's steps");
    expect([...body.matchAll(/invoke\("([a-z_]+)"/g)].map((m) => m[1])).toEqual(["help_setup"]);
    expect(body).toMatch(/await turnOnOld\(a\)/);
    expect(body).not.toMatch(/\bcall\(|lookPressed|act_answer/);
    const old = fn("async function turnOnOld(", "const notAPress");
    expect([...old.matchAll(/invoke\("([a-z_]+)"/g)].map((m) => m[1])).toEqual(["set_screen_help", "act_set_use_mac", "act_set_file_work"]);
    expect(main).toMatch(/if \(act === "help-turn-on"\) return helpTurnOn\(\);/);
  });
  it("Ask again is the Look button's flow with the kept words, and nothing else", () => {
    const body = fn("function askAgain(", "/** A reply's offers");
    expect(body).toMatch(/screenAsk = \{ words: k\.words, at: Date\.now\(\) \};\s*return lookPressed\(\);/);
    expect(body).not.toMatch(/invoke\(|\bcall\(/);
  });
  it("opening the setup turns nothing on: the offers, the tray and Boredroom's flag only open the card", () => {
    const open = fn("function openHelp(", "/**\n * macOS's steps after");
    expect(open).not.toMatch(/invoke\(|\bcall\(/);
    for (const a of ["help-enable", "help-setup", "help-screen", "act-turn-on"]) expect(main).toMatch(new RegExp(`if \\(act === "${a}"\\)[^\\n]*openHelp\\(`));
    expect(main).toMatch(/listen\("brenda:\/\/help-setup"[\s\S]{0,200}openHelp\(/);
    const sync = fn("function syncLook(", "/** \"Screen help is off\"");
    expect(sync).toMatch(/Help\.setupFresh\(l\.setupAt/);
    expect(sync.slice(sync.indexOf("Help.setupFresh"))).not.toMatch(/invoke\("(?:set_screen_help|act_set|help_setup)/);
  });
  it("guards every new command, and feature-detects this build's Rust", () => {
    for (const m of main.matchAll(/invoke\("(help_open_privacy|help_request_finder|help_request_folders|help_setup)"/g)) {
      const at = m.index ?? 0;
      const stmt = main.slice(at, main.indexOf(";\n", at));
      const guarded = /\.catch\(/.test(stmt) || /try \{[\s\S]*$/.test(main.slice(Math.max(0, at - 1600), at));
      expect(guarded, m[1]).toBe(true);
    }
    expect(main).toMatch(/const lookV2 = \(\) => \(lookStatus\?\.v \?\? 1\) >= 2;/);
    expect(main).toMatch(/const lookV3 = \(\) => \(lookStatus\?\.v \?\? 1\) >= 3;/);
    expect(main).toMatch(/if \(lookV3\(\)\) return void invoke\("help_open_privacy"/);
    // Reported only once Boredroom takes it (0059), through the generic api command.
    expect(main).toMatch(/data\?\.look\?\.mac\?\.ready === true/);
    expect(main).toMatch(/call\("PUT", org\("\/screen-help\/mac"\), body\)/);
  });
});
