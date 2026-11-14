import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The timer card on the desktop (owner request, 14 November 2026: "a floating card that lives on your desktop when you're
// working on a task"). desktop/src/timer-card.js loads in Node with a tiny stand-in for the few elements it touches (no
// JSDOM): `apply` takes only Rust's typed messages, sets the task's name with textContent only, counts a running timer
// on from when the message arrived and leaves a paused one still; the page can send six fixed words and nothing else.

type View = { id: string; title: string; state: string; elapsed: number; estimateMinutes: number | null };
type Api = {
  STATES: string[]; PRESSES: string[]; WORDS: Record<string, string>;
  apply(m: unknown): boolean; press(a: string): boolean; hms(s: number): string; viewOf(m: unknown): View | null;
  secondsAt(v: View, at: number, now: number): number; shareOf(v: View, s: number): number | null; _reset(): void;
};

const require = createRequire(import.meta.url);
const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const Card = require("../../desktop/src/timer-card.js") as Api;

/** A stand-in element. innerHTML is a trap: setting it fails the test. */
class El {
  textContent = "";
  title = "";
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  set innerHTML(_: string) { throw new Error("the card sets text, never HTML"); }
}

const ID = "0b6f1c1e-52a4-4a0e-9b7c-6f6f2a1d9c11";
const timer = (o: Record<string, unknown> = {}) => ({ t: "timer", id: ID, title: "Write the partner FAQ", state: "running", elapsed: 3725, ...o });
let els: Record<string, El>;
let buttons: El[];
let sent: { cmd: string; args: unknown }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
  els = Object.fromEntries(["card", "title", "clock", "state", "toggle", "toggle-mark", "est", "est-bar"].map((id) => [id, new El()]));
  const stop = new El(); stop.dataset.press = "stop";
  const hide = new El(); hide.dataset.press = "hide";
  els.toggle.dataset.press = "pause"; els.title.dataset.press = "open";
  buttons = [els.title, hide, els.toggle, stop];
  sent = [];
  vi.stubGlobal("document", { getElementById: (id: string) => els[id], querySelectorAll: () => buttons });
  vi.stubGlobal("window", { __TAURI__: { core: { invoke: (cmd: string, args: unknown) => { sent.push({ cmd, args }); return Promise.resolve(); } } } });
  Card._reset();
});
afterEach(() => { Card._reset(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("the clock", () => {
  it("is written as My Day writes it", () => {
    expect(Card.hms(0)).toBe("00:00:00");
    expect(Card.hms(3725)).toBe("01:02:05");
    expect(Card.hms(36_000 + 59)).toBe("10:00:59");
    expect(Card.hms(-4)).toBe("00:00:00");
    expect(Card.hms(Number.NaN)).toBe("00:00:00");
  });

  it("a running timer counts on from when the word arrived; a paused or interrupted one stands still", () => {
    const running = Card.viewOf(timer())!;
    expect(Card.secondsAt(running, 1_000, 1_000)).toBe(3725);
    expect(Card.secondsAt(running, 1_000, 61_900)).toBe(3785);
    expect(Card.secondsAt(running, 5_000, 1_000)).toBe(3725); // a clock set back never runs the timer backwards
    for (const state of ["paused", "interrupted"]) expect(Card.secondsAt(Card.viewOf(timer({ state }))!, 0, 600_000)).toBe(3725);
  });

  it("the estimate's share stops at the whole of it, and there is none without an estimate", () => {
    const v = Card.viewOf(timer({ estimateMinutes: 60 }))!;
    expect(Card.shareOf(v, 1800)).toBe(0.5);
    expect(Card.shareOf(v, 9000)).toBe(1);
    expect(Card.shareOf(Card.viewOf(timer())!, 1800)).toBeNull();
  });
});

describe("what counts as a timer", () => {
  it("takes Rust's message and tidies the task's name", () => {
    expect(Card.viewOf(timer({ title: "  Fix\tthe‮checkout\nbug  ", estimateMinutes: 45 }))).toEqual({ id: ID, title: "Fix the checkout bug", state: "running", elapsed: 3725, estimateMinutes: 45 });
    expect(Card.viewOf(timer({ title: "" }))!.title).toBe("Untitled task");
    expect([...Card.viewOf(timer({ title: "x".repeat(400) }))!.title]).toHaveLength(120);
    expect(Card.viewOf(timer({ elapsed: 12.9 }))!.elapsed).toBe(12);
    expect(Card.viewOf(timer({ estimateMinutes: 0 }))!.estimateMinutes).toBeNull();
  });

  it("ignores anything else", () => {
    for (const bad of [null, "timer", {}, { t: "ring" }, timer({ state: "stopped" }), timer({ id: "x" }), timer({ id: 7 }), timer({ elapsed: "90" }), timer({ elapsed: Number.NaN })]) {
      expect(Card.viewOf(bad), JSON.stringify(bad)).toBeNull();
      expect(Card.apply(bad)).toBe(false);
    }
    expect(els.title.textContent).toBe("");
  });
});

describe("the card", () => {
  it("running: the task, On the clock, Pause, and the seconds tick", () => {
    expect(Card.apply(timer({ title: "<img src=x onerror=alert(1)>", estimateMinutes: 120 }))).toBe(true);
    expect(els.card.hidden).toBe(false);
    expect(els.card.dataset.state).toBe("running");
    expect(els.title.textContent).toBe("<img src=x onerror=alert(1)>"); // text, never markup
    expect(els.state.textContent).toBe("On the clock");
    expect(els.clock.textContent).toBe("01:02:05");
    expect(els.toggle.dataset.press).toBe("pause");
    expect(els.toggle.attrs.get("aria-label")).toBe("Pause the timer");
    expect(els.est.hidden).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(els.clock.textContent).toBe("01:02:08");
  });

  it("paused: Resume, grey digits' state, and the clock stands still; a fresh word corrects the clock", () => {
    Card.apply(timer({ state: "paused", elapsed: 600 }));
    expect(els.card.dataset.state).toBe("paused");
    expect(els.state.textContent).toBe("Paused");
    expect(els.toggle.dataset.press).toBe("resume");
    expect(els.toggle.attrs.get("aria-label")).toBe("Resume the timer");
    expect(els.est.hidden).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(els.clock.textContent).toBe("00:10:00");
    Card.apply(timer({ elapsed: 610 }));
    vi.advanceTimersByTime(2000);
    expect(els.clock.textContent).toBe("00:10:12");
  });

  it("no timer: the card empties and stops counting", () => {
    Card.apply(timer());
    expect(Card.apply({ t: "clear" })).toBe(true);
    expect(els.card.hidden).toBe(true);
    expect(els.title.textContent).toBe("");
    const shown = els.clock.textContent;
    vi.advanceTimersByTime(5000);
    expect(els.clock.textContent).toBe(shown);
  });
});

describe("presses", () => {
  it("sends one of six words to the one command, and nothing else", () => {
    expect(Card.PRESSES).toEqual(["ready", "open", "pause", "resume", "stop", "hide"]);
    for (const word of Card.PRESSES) expect(Card.press(word)).toBe(true);
    expect(sent).toEqual(Card.PRESSES.map((action) => ({ cmd: "timer_card_press", args: { action } })));
    for (const bad of ["yes", "act_answer", "", "PAUSE", "stop "]) expect(Card.press(bad)).toBe(false);
    expect(sent).toHaveLength(6);
  });

  it("Pause, Resume and Stop wait for the next word, four seconds at most, so a press is not sent twice; × never waits", () => {
    Card.apply(timer());
    Card.press("pause");
    expect(buttons.filter((b) => b.disabled).map((b) => b.dataset.press)).toEqual(["open", "pause", "stop"]);
    Card.apply(timer({ state: "paused" }));
    expect(buttons.some((b) => b.disabled)).toBe(false);
    Card.press("stop");
    expect(els.toggle.disabled).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(buttons.some((b) => b.disabled)).toBe(false);
    Card.press("open"); Card.press("hide");
    expect(buttons.some((b) => b.disabled)).toBe(false);
  });

  it("the page calls one command, listens to nothing and fetches nothing", () => {
    const src = file("desktop/src/timer-card.js");
    expect(src.match(/invoke\(/g)).toHaveLength(1);
    expect(src).toContain('invoke("timer_card_press"');
    for (const no of ["listen(", "fetch(", "XMLHttpRequest", "innerHTML", "eval(", "localStorage"]) expect(src, no).not.toContain(no);
    const html = file("desktop/src/timer-card.html");
    expect(html).not.toMatch(/<script(?![^>]*src="timer-card\.js")/);
    expect(html.match(/data-press="(\w+)"/g)).toEqual(['data-press="open"', 'data-press="hide"', 'data-press="pause"', 'data-press="stop"']);
  });
});
