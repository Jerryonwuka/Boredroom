/**
 * The notch's front desk and helpers (Brenda and her helpers, build 1; owner's approved brief, 12 October 2026; contract
 * Q.1, S.2 to S.8, F.0, M.2). desktop/src/front.js, a classic browser script that also loads in Node: the Q.1 API word
 * for word (the strip, the ask, chooser and job cards, the click consent in both naming versions, the settings card's new
 * rows, the short-line cache), and the rule that nothing new shows with today's binary or before 0060.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type Rec = Record<string, unknown>;
type FrontApi = {
  WORDS(name: string): Rec;
  stripModel(o: Rec): Rec; askModel(e: Rec, name: string): Rec; chooseModel(e: Rec): Rec; foundModel(e: Rec): Rec; doneModel(e: Rec): Rec;
  refusedModel(e: Rec, name: string): Rec; jobCardModel(job: Rec, nowMs: number): Rec; jobAskModel(ask: Rec): Rec; jobEndModel(e: Rec, name: string): Rec;
  consentModel(name: string): Rec; settingsRows(lookStatus: Rec, name: string): Rec;
  lineKey(v: Rec | null, text: string): string | null;
  LineCache(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null): { get(k: string): string | null; put(k: string, a: string): boolean };
  meta(where: string, ymd: string, nowMs: number): string; elapsed(ms: number): string; frontOn(lookStatus: Rec | null, data: Rec | null): boolean;
};
const require = createRequire(import.meta.url);
const F = require(fileURLToPath(new URL("../../desktop/src/front.js", import.meta.url))) as FrontApi;

describe("the Q.1 API", () => {
  it("exports every function the contract names", () => {
    for (const k of ["WORDS", "stripModel", "askModel", "chooseModel", "foundModel", "doneModel", "refusedModel", "jobCardModel", "jobAskModel", "jobEndModel", "consentModel", "settingsRows", "lineKey", "LineCache", "meta", "elapsed", "frontOn"]) {
      expect(typeof (F as unknown as Rec)[k], k).toBe("function");
    }
  });
});

describe("F.0: nothing new with today's binary (v2), phase 3's (v3) or before 0060", () => {
  it.each([
    [{ v: 4, front: { ready: true } }, { look: { front: { ready: true } } }, true],
    [{ v: 2 }, { look: { front: { ready: true } } }, false],
    [{ v: 3, front: { ready: true } }, { look: { front: { ready: true } } }, false],
    [{ v: 4, front: { ready: true } }, { look: { front: { ready: false } } }, false],
    [{ v: 4, front: { ready: true } }, { look: {} }, false],
    [{ v: 4, front: { ready: false } }, { look: { front: { ready: true } } }, false],
    [null, null, false],
  ])("%j with %j → %s", (s, d, want) => { expect(F.frontOn(s as Rec | null, d as Rec | null)).toBe(want); });
});

describe("the Doing it strip (F.1)", () => {
  it("doing, a job's count with Stop, done with Undo ('Volume 30%'), paused", () => {
    expect(F.stripModel({ kind: "front", phase: "doing", line: "Opening Figma." })).toEqual({ dot: "live", text: "Opening Figma", count: null, stop: false, undo: false });
    expect(F.stripModel({ kind: "job", phase: "doing", line: "Organising your Desktop.", k: 23, of: 64 })).toEqual({ dot: "live", text: "Organising your Desktop", count: "23 of 64", stop: true, undo: false });
    expect(F.stripModel({ kind: "front", phase: "done", line: "Volume 30 percent.", undo: true })).toEqual({ dot: "done", text: "Volume 30%", count: null, stop: false, undo: true });
    expect(F.stripModel({ kind: "job", phase: "paused", line: "Paused while your Mac was asleep", paused: true })).toMatchObject({ dot: "paused", text: "Paused while your Mac was asleep" });
  });
  it("'One moment' gets Stop after a second; Claude busy's own retry says so (review, 16 October 2026)", () => {
    expect(F.stripModel({ kind: "front", phase: "routing" })).toEqual({ dot: "none", text: "One moment", count: null, stop: false, undo: false });
    expect(F.stripModel({ kind: "front", phase: "routing", slow: true })).toMatchObject({ text: "One moment", stop: true });
    expect(F.stripModel({ kind: "front", phase: "routing", retrying: true, slow: true })).toMatchObject({ text: "Claude is busy, trying again…", stop: true });
  });
});

describe("cards (F.2, S.3, S.4, S.6)", () => {
  it("the ask card: neutral, No and the verb, the hint and its minute", () => {
    expect(F.askModel({ question: "Empty the Trash for good?", because: "This can't be undone.", yes: "Empty the Trash", waitMs: 60000 }, "Max")).toEqual({
      title: "Empty the Trash for good?", because: "This can't be undone.", hint: "Answer with Yes or No, or hold ⌃ ⌘ and say it. I'll wait a minute.", no: "No", yes: "Empty the Trash", waitMs: 60000,
    });
  });
  it("the chooser and the meta line ('Downloads, changed 8 October'; the year when it isn't this one)", () => {
    expect(F.chooseModel({ question: "Which one?", options: [{ name: "Q3.key", where: "Downloads", when: "2026-10-08" }] })).toEqual({ title: "Which one?", options: [{ i: 0, name: "Q3.key", meta: "Downloads, changed 8 October" }], none: "None of these" });
    expect(F.meta("Downloads", "2025-10-08", Date.parse("2026-10-12T12:00:00Z"))).toBe("Downloads, changed 8 October 2025");
    // Words already written stay as they are (integration, 16 October 2026: Date.parse read "changed 8 October" as 2001).
    expect(F.meta("Downloads", "changed 8 October", Date.parse("2026-10-12T12:00:00Z"))).toBe("Downloads, changed 8 October");
    expect(F.meta("Downloads", "", Date.parse("2026-10-12T12:00:00Z"))).toBe("Downloads");
  });
  it("a job that couldn't be done as asked says the helper's reason; a folder macOS refused offers System Settings (G.3, G.5)", () => {
    expect(F.jobEndModel({ phase: "stopped", why: "cannot", summary: "I only work in your Desktop, Documents, Downloads and the folders you add.", undo: false }, "Max"))
      .toMatchObject({ title: "I couldn't do that", sub: "I only work in your Desktop, Documents, Downloads and the folders you add.", settings: null });
    expect(F.jobEndModel({ phase: "stopped", why: "cannot", summary: "Your Mac hasn't let me into your Desktop", undo: true, settings: true }, "Max"))
      .toMatchObject({ sub: "Your Mac hasn't let me into your Desktop. What I did before that stays done.", settings: { label: "Open System Settings", pane: "files" }, undo: true });
    expect(F.jobEndModel({ phase: "failed", message: "I couldn't reach Claude just now", undo: false, settings: true }, "Max")).toMatchObject({ settings: { pane: "files" } });
  });
  it("a job's Trash ask and its running card", () => {
    expect(F.jobAskModel({ kind: "delete", what: "move 41 screenshots to the Trash", question: "Move 41 screenshots to the Trash?", because: "You can put them back from the Trash.", count: 41 })).toEqual({
      title: "Move 41 screenshots to the Trash?", because: "You can put them back from the Trash.", wait: "I'll wait 10 minutes.", no: "No", yes: "Move to Trash",
    });
    const now = Date.now();
    expect(F.jobCardModel({ title: "Organise your Desktop", doing: "Organising your Desktop", done: 23, of: 64, startedAt: now - 12_000, note: "Moving files" }, now)).toEqual({
      title: "Organising your Desktop", pct: 36, count: "23 of 64", elapsed: "0:12", note: "Moving files", sub: "You can carry on. I'll tell you when it's done.",
    });
    expect([F.elapsed(12_000), F.elapsed(65_000), F.elapsed(760_000)]).toEqual(["0:12", "1:05", "12:40"]);
  });
  it("Undo's end card counts what came back and what was left", () => {
    expect(F.jobEndModel({ phase: "undone", restored: 3, skipped: 1 }, "Max")).toMatchObject({ title: "Put back", sub: "I put back 3 items. 1 had changed since, so I left it." });
  });
  it("busy, Claude unreachable and Boredroom offline offer Try again (white, never with a switch to turn on); others don't (review, 16 October 2026)", () => {
    for (const code of ["AI_BUSY", "AI_FAILED", "OFFLINE", "FRONT_OFFLINE"]) expect(F.refusedModel({ code }, "Max")).toMatchObject({ retry: "Try again", enable: null });
    expect(F.refusedModel({ status: 0 }, "Max")).toMatchObject({ retry: "Try again" });
    expect(F.refusedModel({ code: "AI_NO_CREDIT" }, "Max")).toMatchObject({ retry: null });
    expect(F.refusedModel({ why: "mac_off" }, "Max")).toMatchObject({ retry: null, enable: { which: "mac" } });
    expect(F.refusedModel({ title: "I can't open that address", sub: "x" }, "Max")).toMatchObject({ retry: null });
  });
  it("an organised folder's done card offers Show in Finder for it (review, 16 October 2026)", () => {
    expect(F.jobEndModel({ phase: "done", summary: "I moved 64 files into 7 folders on your Desktop.", outputs: [], undo: true, ms: 12_000, folder: "Desktop" }, "Max"))
      .toMatchObject({ title: "I moved 64 files into 7 folders on your Desktop.", sub: "Done in 12 seconds.", undo: true, folder: { title: "Desktop", label: "Show in Finder" } });
    expect(F.jobEndModel({ phase: "done", summary: "Done.", outputs: [], undo: false, ms: 1_000 }, "Max")).toMatchObject({ folder: null });
  });
  it("a refusal shows its title and sub; OK", () => {
    expect(F.refusedModel({ title: "I can't open that address", sub: "Only ordinary web pages, never downloads of apps or scripts." }, "Max")).toMatchObject({ title: "I can't open that address", sub: "Only ordinary web pages, never downloads of apps or scripts.", enable: null, ok: "OK" });
  });
});

describe("the click consent (S.7), both naming versions", () => {
  it("Brenda", () => {
    expect(F.consentModel("Brenda")).toEqual({
      title: "Let Brenda click and type for you?",
      lead: "For things there's no direct way to do, Brenda can use your mouse and keyboard in your apps, like you would, while you watch.",
      promises: ["She always stops and asks before anything that sends, submits, pays or deletes.", "Esc, her keys or Stop stops her at once.",
        "Never in password managers, Keychain, System Settings, Terminal or messaging and call apps, and never on banking or payment pages."],
      notNow: "Not now", allow: "Let Brenda click and type", footer: "You can turn this off in Help on this Mac.",
    });
  });
  it("a renamed assistant: never 'she' beside the name", () => {
    const c = F.consentModel("Max");
    expect(c.title).toBe("Let Max click and type for you?");
    expect(c.promises).toEqual(["Max always stops and asks before anything that sends, submits, pays or deletes.", "Esc, Max's keys or Stop stops Max at once.",
      "Never in password managers, Keychain, System Settings, Terminal or messaging and call apps, and never on banking or payment pages."]);
    expect(JSON.stringify(c)).not.toMatch(/\b(she|her|Brenda)\b/i);
  });
});

describe("the settings card's new rows (S.8)", () => {
  it("Check with me, Clicking and typing, Folders I work in", () => {
    const r = F.settingsRows({ v: 4, front: { ready: true, checkEvery: true, clickConsent: false, folders: [{ source: "named", name: "desktop", title: "Desktop", state: "granted" }, { source: "added", name: "Projects", title: "Projects", state: "unknown" }] } }, "Max") as Record<string, Rec>;
    expect(r.check).toEqual({ label: "Check with me before every task", sub: "Max asks “Do you want me to do this?” before anything, even opening an app. Off: your request is the go-ahead for routine things; Max still asks before deleting, sending, paying or anything to do with security.", on: true, error: "That couldn't be saved. Try again." });
    expect(r.click).toMatchObject({ label: "Clicking and typing for you", on: false, words: "Not yet. I'll ask the first time." });
    expect(r.folders).toMatchObject({ label: "Folders I work in", sub: "Desktop, Documents and Downloads, plus folders you add. Never Library, system or hidden folders.", add: "Add a folder…" });
    expect((r.folders.rows as Rec[])[0]).toMatchObject({ words: "Desktop: allowed", remove: null });
    expect((r.folders.rows as Rec[])[1]).toMatchObject({ remove: "Remove" });
  });
});

describe("the first short line's clips (M.2)", () => {
  it("lineKey and the cache (oldest out; storage that throws is memory only)", () => {
    expect(F.lineKey({ id: "abc", speed: "normal" }, "Opening Figma.")).toBe("abc|normal|Opening Figma.");
    expect(F.lineKey(null, "Opening Figma.")).toBeNull();
    const store: Record<string, string> = {};
    const c = F.LineCache({ getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } });
    expect(c.put("k1", "AAAA")).toBe(true);
    expect(c.get("k1")).toBe("AAAA");
    expect(Object.keys(store)).toEqual(["brenda.lines.v1"]);
    for (let i = 0; i < 45; i++) c.put(`k${i + 2}`, "BBBB");
    expect(c.get("k1")).toBeNull();
    const broken = F.LineCache({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined });
    expect(broken.put("x", "AAAA")).toBe(true);
    expect(broken.get("x")).toBe("AAAA");
  });
});
