import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

// The notch's notification queue, summary and pager (owner decision, 9 October 2026: notch notifications, "A plus the
// grafts"): desktop/src/notify.js, a classic browser script that also loads in Node. One card at a time, never chained;
// two or more together open the summary; the pager's order, steps and Mark all read; the hold times; the 3-second linger
// (and the 5 October rule that an island opened by hovering folds at once).

type Ids = string[];
type State = { known: Map<string, number>; held: Set<string>; shown: Set<string>; newest: number | null };
type Pager = { ids: Ids; index: number; seen: Set<string> };
type Finished = { finished: true };
type ArrivalInput = { list: { id: string; at?: number }[]; now: number; cardOpen?: boolean; pagerOpen?: boolean; quiet?: boolean; away?: boolean };
type NotifyApi = {
  T: { BURST_MS: number; AWAY_MS: number; LINGER_MS: number; ASK_HOLD_MS: number; SUMMARY_HOLD_MS: number; DONE_HOLD_MS: number; ACT_MS: number; ENTER_GUARD_MS: number;
    HOLD: { base: number; perWord: number; min: number; max: number }; DOTS_MAX: number; SKEW_MS: number };
  GROUP_RANK: Record<string, number>;
  countWords(text: unknown): number;
  holdMs(o: { words?: number; waits?: boolean; summary?: boolean; done?: boolean }): number;
  order(items: { id: string; group: string; at: number }[]): Ids;
  initial(): State;
  arrival(s: State, input: ArrivalInput): { action: "pager-insert" | "bar" | "hold" | "summary" | "single" | "none"; ids: Ids; fresh: Ids; s: State };
  pagerStart(ids: Ids, placeId?: string | null, seen?: Set<string>): Pager;
  pagerInsert(p: Pager, ids: Ids): Pager;
  pagerStep(p: Pager, dir: number): Pager | Finished;
  pagerRemove(p: Pager, id: string): Pager | Finished;
  dotWindow(count: number, index: number, max?: number): { from: number; to: number };
  leaveFold(o: { origin: string; sticky?: boolean; left?: number; grace?: number }): { mode: "stay" | "now" | "after"; ms: number };
  markAllRead(items: { id: string; group: string }[]): { read: Ids; keep: Ids };
  away(lastMoveAt: number, now: number): boolean;
};

const require = createRequire(import.meta.url);
const Notify = require("../../desktop/src/notify.js") as NotifyApi;

const list = (...ids: string[]) => ids.map((id) => ({ id }));
const pager = (p: Pager | Finished): Pager => { if ("finished" in p) throw new Error("finished"); return p; };

describe("the scripts", () => {
  it("parse as plain JavaScript (node --check), as the notch loads them", () => {
    for (const f of ["desktop/src/notify.js", "desktop/src/main.js"]) expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
  });
  it("declare one global each and nothing else", () => {
    expect(Object.isFrozen(Notify)).toBe(true);
    // Phase 8 (owner decisions, 8 October 2026: calls) adds the ring's rules: CALL_POLL, ringAction, ringPollMs and
    // ringRetryMs (tests/unit/notch-calls.test.ts checks them).
    expect(Object.keys(Notify).sort()).toEqual(["CALL_POLL", "GROUP_RANK", "T", "arrival", "away", "countWords", "dotWindow", "holdMs", "initial", "leaveFold", "markAllRead", "order", "pagerInsert", "pagerRemove", "pagerStart", "pagerStep", "ringAction", "ringPollMs", "ringRetryMs"]);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(Notify.countWords("New message from Ada")).toBe(4);
    expect(Notify.countWords("  two\n\twords  ")).toBe(2);
    expect(Notify.countWords("")).toBe(0);
    expect(Notify.countWords("   ")).toBe(0);
    expect(Notify.countWords(null)).toBe(0);
    expect(Notify.countWords(42)).toBe(0);
  });
});

describe("holdMs", () => {
  it("holds 3 s plus 0.3 s a word, between 6 and 14 s", () => {
    expect(Notify.holdMs({ words: 0 })).toBe(6000);
    expect(Notify.holdMs({})).toBe(6000);
    expect(Notify.holdMs({ words: 10 })).toBe(6000);
    expect(Notify.holdMs({ words: 20 })).toBe(9000);
    expect(Notify.holdMs({ words: 30 })).toBe(12000);
    expect(Notify.holdMs({ words: 37 })).toBe(14000);
    expect(Notify.holdMs({ words: 500 })).toBe(14000);
    expect(Notify.holdMs({ words: -3 })).toBe(6000);
  });
  it("holds an ask 15 s, the summary 10 s and the end card 4 s, whatever the words", () => {
    expect(Notify.holdMs({ words: 80, waits: true })).toBe(15000);
    expect(Notify.holdMs({ words: 2, summary: true })).toBe(10000);
    expect(Notify.holdMs({ done: true, summary: true, waits: true })).toBe(4000);
    expect(Notify.T.LINGER_MS).toBe(3000);
    expect(Notify.T.ACT_MS).toBe(600);
  });
});

describe("order", () => {
  // Good news last, as the approved mockup's rules note says (review, 9 October 2026: it was before the reports).
  it("puts what waits on you first, then what is due, people, reports, good news; newest first within each", () => {
    const items = [
      { id: "report", group: "report", at: 900 },
      { id: "good", group: "good", at: 800 },
      { id: "msg-old", group: "people", at: 100 },
      { id: "msg-new", group: "people", at: 700 },
      { id: "due", group: "time", at: 50 },
      { id: "ask-old", group: "ask", at: 10 },
      { id: "ask-new", group: "ask", at: 600 },
    ];
    expect(Notify.order(items)).toEqual(["ask-new", "ask-old", "due", "msg-new", "msg-old", "report", "good"]);
  });
  it("breaks ties by id, so the same inbox always pages the same way, and puts unknown groups with the reports", () => {
    const a = [{ id: "b", group: "people", at: 5 }, { id: "a", group: "people", at: 5 }, { id: "x", group: "mystery", at: 99 }, { id: "r", group: "report", at: 100 }];
    expect(Notify.order(a)).toEqual(["a", "b", "r", "x"]);
    expect(Notify.order([...a].reverse())).toEqual(["a", "b", "r", "x"]);
  });
});

describe("arrival", () => {
  it("opens one arriving alone as its card", () => {
    const r = Notify.arrival(Notify.initial(), { list: list("n1"), now: 1 });
    expect(r.action).toBe("single");
    expect(r.ids).toEqual(["n1"]);
    expect(r.s.shown.has("n1")).toBe(true);
  });

  it("opens the summary for two or more arriving together", () => {
    const r = Notify.arrival(Notify.initial(), { list: list("n2", "n1"), now: 1 });
    expect(r.action).toBe("summary");
    expect(r.ids).toEqual(["n2", "n1"]);
  });

  it("opens the summary on launch with 5 unread", () => {
    const r = Notify.arrival(Notify.initial(), { list: list("a", "b", "c", "d", "e"), now: 1 });
    expect(r.action).toBe("summary");
    expect(r.ids).toHaveLength(5);
  });

  it("only joins the bar while a card is open, and never opens it once the card closes", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("n1"), now: 1 });
    expect(r.action).toBe("single");
    r = Notify.arrival(r.s, { list: list("n2", "n1"), now: 2, cardOpen: true });
    expect(r.action).toBe("bar");
    expect(r.ids).toEqual(["n2"]);
    expect(r.s.shown.has("n2")).toBe(true);
    // The card closed: the next poll (nothing new) opens nothing, and nor does any later one.
    r = Notify.arrival(r.s, { list: list("n2", "n1"), now: 3 });
    expect(r.action).toBe("none");
    r = Notify.arrival(r.s, { list: list("n2", "n1"), now: 4 });
    expect(r.action).toBe("none");
  });

  it("puts arrivals right behind the current card while the pager is open", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("a", "b"), now: 1 });
    r = Notify.arrival(r.s, { list: list("c", "a", "b"), now: 2, pagerOpen: true, cardOpen: true });
    expect(r.action).toBe("pager-insert");
    expect(r.ids).toEqual(["c"]);
    let p = Notify.pagerStart(["a", "b"], "a");
    p = Notify.pagerInsert(p, r.ids);
    expect(p.ids).toEqual(["a", "c", "b"]);
  });

  it("holds through quiet hours, then opens the summary for three or its card for one", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("a"), now: 1, quiet: true });
    expect(r.action).toBe("hold");
    r = Notify.arrival(r.s, { list: list("c", "b", "a"), now: 2, quiet: true });
    expect(r.action).toBe("hold");
    expect([...r.s.held].sort()).toEqual(["a", "b", "c"]);
    r = Notify.arrival(r.s, { list: list("c", "b", "a"), now: 3 });
    expect(r.action).toBe("summary");
    expect(r.ids).toEqual(["c", "b", "a"]);
    expect(r.s.held.size).toBe(0);

    let one = Notify.arrival(Notify.initial(), { list: list("x"), now: 1, quiet: true });
    expect(one.action).toBe("hold");
    one = Notify.arrival(one.s, { list: list("x"), now: 2 });
    expect(one.action).toBe("single");
    expect(one.ids).toEqual(["x"]);
  });

  it("holds while the person is away, and releases on the first movement back", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("a", "b"), now: 1, away: true });
    expect(r.action).toBe("hold");
    r = Notify.arrival(r.s, { list: list("a", "b"), now: 2, away: false });
    expect(r.action).toBe("summary");
    let one = Notify.arrival(Notify.initial(), { list: list("a"), now: 1, away: true });
    one = Notify.arrival(one.s, { list: list("a"), now: 2 });
    expect(one.action).toBe("single");
  });

  it("drops from held what was read elsewhere meanwhile", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("a", "b"), now: 1, quiet: true });
    r = Notify.arrival(r.s, { list: list("b"), now: 2, quiet: true });
    expect([...r.s.held]).toEqual(["b"]);
    r = Notify.arrival(r.s, { list: list("b"), now: 3 });
    expect(r.action).toBe("single");
    expect(r.ids).toEqual(["b"]);
  });

  it("does not open again what was shown, and records when each id was first seen", () => {
    const s = Notify.initial();
    s.shown.add("seen-on-the-day-card");
    const r = Notify.arrival(s, { list: list("seen-on-the-day-card"), now: 42 });
    expect(r.action).toBe("none");
    expect(r.s.known.get("seen-on-the-day-card")).toBe(42);
    expect(r.fresh).toEqual(["seen-on-the-day-card"]);
  });

  // Review, 9 October 2026: the state carries the newest 20 unread; reading one brings an older one into it, which must
  // never open on its own (that was the banned chain again, one more card after every read).
  it("never treats an older unread one coming into the newest 20 as arrived", () => {
    const at = (id: string, t: number) => ({ id, at: t });
    // Launch: 30 unread, the state carries the newest 20 (n29..n10).
    const window = (from: number) => Array.from({ length: 20 }, (_, i) => at(`n${from - i}`, (from - i) * 60_000)); // a minute apart
    let r = Notify.arrival(Notify.initial(), { list: window(29), now: 1, cardOpen: true });
    expect(r.action).toBe("bar");
    expect(r.s.newest).toBe(29 * 60_000);
    // All 20 read: the next poll brings the 10 older ones (n9..n0). Nothing opens.
    r = Notify.arrival(r.s, { list: Array.from({ length: 10 }, (_, i) => at(`n${9 - i}`, (9 - i) * 60_000)), now: 2 });
    expect(r.action).toBe("none");
    expect(r.fresh).toEqual([]);
    expect(r.s.known.size).toBe(10);
    // One read at a time: the 21st comes in, and still nothing opens.
    let s2 = Notify.arrival(Notify.initial(), { list: window(29), now: 1 }).s;
    const next = window(28).slice(0, 19).concat([at("n9", 9 * 60_000)]);
    const r2 = Notify.arrival(s2, { list: next, now: 2 });
    expect(r2.action).toBe("none");
    s2 = r2.s;
    // A notification newer than all of them still arrives, and one a moment older (a slower write) too.
    const r3 = Notify.arrival(s2, { list: [at("new", 40 * 60_000), at("late-write", 29 * 60_000 - 10_000), ...next], now: 3 });
    expect(r3.action).toBe("summary");
    expect(r3.ids).toEqual(["new", "late-write"]);
  });

  it("forgets what is no longer unread, so the state never grows", () => {
    let r = Notify.arrival(Notify.initial(), { list: list("a", "b", "c"), now: 1 });
    expect(r.s.shown.size).toBe(3);
    r = Notify.arrival(r.s, { list: list("c"), now: 2 });
    expect([...r.s.known.keys()]).toEqual(["c"]);
    expect([...r.s.shown]).toEqual(["c"]);
  });

  it("never changes the state it is given", () => {
    const s = Notify.initial();
    Notify.arrival(s, { list: list("a", "b"), now: 1 });
    expect(s.known.size + s.held.size + s.shown.size).toBe(0);
  });

  it("knows the timing constants of the contract", () => {
    expect(Notify.T.BURST_MS).toBe(15000);
    expect(Notify.away(0, Notify.T.AWAY_MS)).toBe(false);
    expect(Notify.away(0, Notify.T.AWAY_MS + 1)).toBe(true);
    expect(Notify.away(NaN, 1)).toBe(false);
  });
});

describe("the pager", () => {
  it("starts at the kept place, else at the first", () => {
    expect(Notify.pagerStart(["a", "b", "c"], "b").index).toBe(1);
    expect(Notify.pagerStart(["a", "b", "c"], "gone").index).toBe(0);
    expect(Notify.pagerStart(["a", "b", "c"]).index).toBe(0);
    expect([...Notify.pagerStart(["a", "b", "c"], "c").seen]).toEqual(["c"]);
    // Opened again where it folded: the cards seen before keep their dimmed dots (review, 9 October 2026).
    expect([...Notify.pagerStart(["a", "b", "c"], "b", new Set(["a", "gone"])).seen].sort()).toEqual(["a", "b"]);
    expect(Notify.pagerStart([], null)).toEqual({ ids: [], index: 0, seen: new Set() });
  });

  it("inserts right behind the current card, never twice", () => {
    let p = Notify.pagerStart(["a", "b", "c"], "b");
    p = Notify.pagerInsert(p, ["x", "y", "a"]);
    expect(p.ids).toEqual(["a", "b", "x", "y", "c"]);
    expect(p.index).toBe(1);
    expect(Notify.pagerInsert(Notify.pagerStart(["a"]), []).ids).toEqual(["a"]);
  });

  it("steps forward and back; past the last it finishes, before the first it stays", () => {
    let p = Notify.pagerStart(["a", "b"]);
    expect(Notify.pagerStep(p, -1)).toBe(p);
    p = pager(Notify.pagerStep(p, 1));
    expect(p.index).toBe(1);
    expect([...p.seen].sort()).toEqual(["a", "b"]);
    expect(Notify.pagerStep(p, 1)).toEqual({ finished: true });
    expect(pager(Notify.pagerStep(p, -1)).index).toBe(0);
  });

  it("removes an id read elsewhere, keeping the current card", () => {
    const p = Notify.pagerStart(["a", "b", "c", "d"], "c");
    const before = pager(Notify.pagerRemove(p, "a"));
    expect(before.ids).toEqual(["b", "c", "d"]);
    expect(before.ids[before.index]).toBe("c");
    const after = pager(Notify.pagerRemove(p, "d"));
    expect(after.ids[after.index]).toBe("c");
    expect(Notify.pagerRemove(p, "nope")).toBe(p);
    // The current one leaving: the card after it takes its place; the last one's, the one before.
    const self = pager(Notify.pagerRemove(p, "c"));
    expect(self.ids[self.index]).toBe("d");
    const last = pager(Notify.pagerRemove(Notify.pagerStart(["a", "b"], "b"), "b"));
    expect(last.ids[last.index]).toBe("a");
    expect(Notify.pagerRemove(Notify.pagerStart(["a"]), "a")).toEqual({ finished: true });
  });

  it("shows at most 12 dots, a window around the current one", () => {
    expect(Notify.dotWindow(8, 3)).toEqual({ from: 0, to: 8 });
    expect(Notify.dotWindow(12, 11)).toEqual({ from: 0, to: 12 });
    expect(Notify.dotWindow(20, 0)).toEqual({ from: 0, to: 12 });
    expect(Notify.dotWindow(20, 10)).toEqual({ from: 4, to: 16 });
    expect(Notify.dotWindow(20, 19)).toEqual({ from: 8, to: 20 });
    expect(Notify.dotWindow(0, 0)).toEqual({ from: 0, to: 0 });
    for (let i = 0; i < 30; i++) {
      const w = Notify.dotWindow(30, i);
      expect(w.to - w.from).toBe(12);
      expect(i >= w.from && i < w.to).toBe(true);
    }
  });

  it("Mark all read reads the notices and keeps the asks", () => {
    const r = Notify.markAllRead([{ id: "ask1", group: "ask" }, { id: "m", group: "people" }, { id: "due", group: "time" }, { id: "ask2", group: "ask" }, { id: "rep", group: "report" }]);
    expect(r.read).toEqual(["m", "due", "rep"]);
    expect(r.keep).toEqual(["ask1", "ask2"]);
  });
});

describe("leaving the island", () => {
  it("folds an island opened by hovering at once, after the 120 ms grace (5 October)", () => {
    expect(Notify.leaveFold({ origin: "hover", grace: 120 })).toEqual({ mode: "after", ms: 120 });
    expect(Notify.leaveFold({ origin: "hover" })).toEqual({ mode: "after", ms: 120 });
    expect(Notify.leaveFold({ origin: "hover", grace: 0 })).toEqual({ mode: "now", ms: 0 });
  });
  it("keeps one that arrived on its own what is left of its hold, at least 3 s", () => {
    expect(Notify.leaveFold({ origin: "auto", left: 9000 })).toEqual({ mode: "after", ms: 9000 });
    expect(Notify.leaveFold({ origin: "auto", left: 1200 })).toEqual({ mode: "after", ms: 3000 });
    expect(Notify.leaveFold({ origin: "auto" })).toEqual({ mode: "after", ms: 3000 });
  });
  it("keeps the pager and a card opened by a press 3 s", () => {
    expect(Notify.leaveFold({ origin: "pager", left: 9000 })).toEqual({ mode: "after", ms: 3000 });
    expect(Notify.leaveFold({ origin: "user" })).toEqual({ mode: "after", ms: 3000 });
  });
  it("keeps whatever is sticky", () => {
    for (const origin of ["hover", "auto", "pager", "user"]) expect(Notify.leaveFold({ origin, sticky: true, left: 10 }).mode).toBe("stay");
  });
});
