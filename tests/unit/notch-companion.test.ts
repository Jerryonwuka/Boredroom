import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The companion by the pointer and the ring (owner request, 12 October 2026: "Clicky's companion cursor that follows you
// around, in the colour of your Brenda"; contract A.4, A.5, B.4.1, B.4.2, C.5, C.9). desktop/src/companion.js and ring.js load
// in Node with a tiny stand-in for the few elements they touch (no JSDOM): `apply` takes only Rust's typed messages, rejects
// bad colours and unknown states, sets words with textContent only, and the pages can call nothing (no invoke, no listen,
// no network). The ring's hand-drawn path and layout are pure.

type Msg = Record<string, unknown>;
type Api = { apply(m: unknown): boolean; lookOf(m: unknown): Record<string, unknown>; STATES: string[]; QUESTION: string; _reset(): void };
type RingApi = { ORANGE: string; apply(m: unknown): boolean; ringPath(shape: string, w: number, h: number, ox?: number, oy?: number): string; layout(m: Msg): Record<string, unknown>; colourOf(v: unknown, fallback?: string): string; luminance(hex: string): number; ringColours(colour: unknown, glow?: unknown): { ring: string; glow: string }; _reset(): void };

const require = createRequire(import.meta.url);
const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** A stand-in element: what the scripts read and write, recorded. innerHTML is a trap: setting it fails the test. */
class El {
  textContent = "";
  className = "";
  dataset: Record<string, string> = {};
  attrs = new Set<string>();
  props = new Map<string, string>();
  classes = new Set<string>();
  children: El[] = [];
  style = {
    setProperty: (k: string, v: string) => { this.props.set(k, v); },
    removeProperty: (k: string) => { this.props.delete(k); },
  } as Record<string, unknown>;
  classList = {
    toggle: (c: string, on?: boolean) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
    add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
    contains: (c: string) => this.classes.has(c),
  };
  toggleAttribute(name: string, on?: boolean) { const v = on ?? !this.attrs.has(name); if (v) this.attrs.add(name); else this.attrs.delete(name); return v; }
  setAttribute(name: string, v: string) { this.props.set(`@${name}`, v); }
  getAttribute(name: string) { return this.props.get(`@${name}`) ?? null; }
  set innerHTML(_v: string) { throw new Error("innerHTML was set"); }
  animate() { return { cancel() {} }; }
  getBoundingClientRect() { return {}; }
  querySelector(s: string) { return (this as unknown as { q?: (s: string) => El | null }).q?.(s) ?? null; }
}

function companionPage() {
  const els: Record<string, El> = { ".cmp": new El(), ".body": new El(), ".face": new El(), ".pill": new El(), ".pill .l1": new El(), ".pill .l2": new El(), ".pill .l3": new El() };
  const bars = Array.from({ length: 5 }, () => new El());
  return { els, bars, document: { title: "", querySelector: (s: string) => els[s] ?? null, querySelectorAll: (s: string) => (s === ".wave i" ? bars : []) } };
}

let Companion: Api;
let page: ReturnType<typeof companionPage>;
const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  page = companionPage();
  g.document = page.document;
  delete require.cache[require.resolve("../../desktop/src/companion.js")];
  Companion = require("../../desktop/src/companion.js") as Api;
  Companion._reset();
});
afterEach(() => { delete g.document; });

describe("the companion page (contract C.5)", () => {
  it("parses as plain JavaScript, loads face.css and companion.css, and can call nothing", () => {
    for (const f of ["desktop/src/companion.js", "desktop/src/ring.js", "desktop/src/render.js"]) expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
    const html = file("desktop/src/companion.html");
    expect(html).toContain('<link rel="stylesheet" href="face.css"><link rel="stylesheet" href="companion.css">');
    expect(html).toMatch(/<body aria-hidden="true"><div class="cmp" data-state="idle">/);
    expect(html).toContain('<script src="companion.js"></script>');
    for (const f of ["desktop/src/companion.js", "desktop/src/ring.js", "desktop/src/render.js", "desktop/src/companion.html", "desktop/src/ring.html", "desktop/src/render.html"]) {
      const s = file(f);
      expect(s, f).not.toMatch(/\binvoke\(|__TAURI__|\blisten\(|\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\.innerHTML\s*=|insertAdjacentHTML|\beval\(/);
      // No inline script: the app's CSP allows scripts from files only.
      expect(s.replace(/<script src="[a-z]+\.js"><\/script>/g, ""), f).not.toMatch(/<script/i);
    }
    // Her face is the notch's own (contract C.6): face.css holds `.face` and the 26-point size.
    expect(file("desktop/src/face.css")).toMatch(/\.face\.cmp \{ zoom: \.9286; \}/);
    expect(file("desktop/src/style.css")).not.toMatch(/^\.face \{ --lx/m);
  });
  it("wears the person's own assistant, and anything wrong is Brenda's", () => {
    expect(Companion.apply({ t: "look", colour: "orange", face: { hi: "#ffdcbd", mid: "#ff9447", edge: "#d0661c" }, visor: "band", eyes: "round", name: "Max" })).toBe(true);
    const f = page.els[".face"];
    expect([f.dataset.sphere, f.dataset.visor, f.dataset.eyes, f.props.get("--sphere-mid")]).toEqual(["orange", "band", "round", "#ff9447"]);
    Companion.apply({ t: "look", colour: "Orange!", face: { hi: "red", mid: "#ff9447", edge: "url(x)" }, visor: "<b>", eyes: "x", name: "y".repeat(50) });
    expect([f.dataset.sphere, f.dataset.visor, f.dataset.eyes, f.props.get("--sphere-hi"), f.props.get("--sphere-mid"), f.props.get("--sphere-edge")]).toEqual(["white", "bean", "pill", "#ffffff", "#ececf0", "#c9cad1"]);
    expect((page.document.title as string).length).toBeLessThanOrEqual(24);
  });
  it("takes only the contract's states, each with its face, and ignores an unknown one", () => {
    const want: Record<string, string> = { idle: "face cmp", listening: "face cmp listen", thinking: "face cmp think", speaking: "face cmp talk", pointing: "face cmp", asking: "face cmp alert", doing: "face cmp think", paused: "face cmp alert", done: "face cmp happy pleased", sad: "face cmp sad" };
    expect([...Companion.STATES].sort()).toEqual(Object.keys(want).sort());
    for (const [state, cls] of Object.entries(want)) {
      Companion.apply({ t: "state", state });
      expect(page.els[".cmp"].dataset.state).toBe(state);
      expect(page.els[".face"].className).toBe(cls);
    }
    Companion.apply({ t: "state", state: "sad" });
    expect(Companion.apply({ t: "state", state: "clicking" })).toBe(true);
    expect(page.els[".cmp"].dataset.state).toBe("sad");
    expect(Companion.apply({ t: "press", x: 1 })).toBe(false);
    expect(Companion.apply("state")).toBe(false);
    expect(Companion.apply(null)).toBe(false);
  });
  it("asks with the plan, the fixed question and where to answer, set as text and clipped", () => {
    Companion.apply({ t: "state", state: "asking", text: "I'll rename these 6 files to <b>Invoice</b>. ", sub: "Press Yes now!", hint: "" });
    expect(page.els[".pill .l1"].textContent).toBe("I'll rename these 6 files to <b>Invoice</b>.");
    // The question is always the fixed one: nothing Rust or the model sends can change it.
    expect(page.els[".pill .l2"].textContent).toBe("Do you want me to do this?");
    expect(page.els[".pill .l3"].textContent).toBe("Say yes or no while holding ⌃ ⌘, or answer in the notch.");
    expect(page.els[".cmp"].attrs.has("data-pill")).toBe(true);
    Companion.apply({ t: "state", state: "asking", text: "x".repeat(400) });
    expect([...page.els[".pill .l1"].textContent].length).toBe(200);
  });
  it("shows the step note while doing (48 characters) and the paused words, and no pill at rest", () => {
    Companion.apply({ t: "state", state: "doing", text: "Opening Finder… and then a great deal more than fits on one line", hint: "Esc stops me" });
    expect([...page.els[".pill .l1"].textContent].length).toBe(48);
    expect(page.els[".pill .l3"].textContent).toBe("Esc stops me");
    expect(page.els[".pill .l2"].textContent).toBe("");
    Companion.apply({ t: "state", state: "paused" });
    expect(page.els[".pill .l1"].textContent).toBe("Paused. Carry on in the notch?");
    Companion.apply({ t: "state", state: "idle" });
    expect(page.els[".pill .l1"].textContent).toBe("");
    expect(page.els[".cmp"].attrs.has("data-pill")).toBe(false);
  });
  it("flips, badges, fades and stops moving as Rust says", () => {
    Companion.apply({ t: "state", state: "idle", flip: { x: true, y: "yes" } });
    expect(page.els[".cmp"].attrs.has("data-flip-x")).toBe(true);
    expect(page.els[".cmp"].attrs.has("data-flip-y")).toBe(false);
    expect(page.els[".face"].props.get("--lx")).toBe("0.55"); // her eyes rest on the pointer, now to her right
    Companion.apply({ t: "badge", on: true });
    expect(page.els[".cmp"].attrs.has("data-badge")).toBe(true);
    Companion.apply({ t: "fade", visible: false });
    expect(page.els[".cmp"].classes.has("faded")).toBe(true);
    Companion.apply({ t: "fade", visible: true });
    expect(page.els[".cmp"].classes.has("faded")).toBe(false);
    Companion.apply({ t: "motion", reduce: true });
    expect(page.els[".cmp"].attrs.has("data-reduce")).toBe(true);
  });
  it("follows the microphone with the bars and her voice with her eyes, clamped", () => {
    Companion.apply({ t: "state", state: "listening" });
    Companion.apply({ t: "level", v: 7 });
    expect(page.els[".face"].props.get("--lvl")).toBe("1.00");
    expect(page.bars.map((b) => (b.style as Record<string, string>).height)).toEqual(["13px", "17px", "20px", "17px", "13px"]);
    Companion.apply({ t: "state", state: "speaking" });
    Companion.apply({ t: "level", v: 0.5 });
    expect(page.els[".face"].props.get("--talk")).toBe("0.500");
    expect(page.els[".face"].props.has("--lvl")).toBe(false);
    Companion.apply({ t: "level", v: "loud" });
    expect(page.els[".face"].props.get("--talk")).toBe("0.000");
  });
});

describe("the ring (contract A.5, B.4.5, C.5; the clean ring, companion2 E)", () => {
  const Ring = require("../../desktop/src/ring.js") as RingApi;
  // Owner report, 12 October 2026: "some of the highlighted items have very wiggly lines, I don't like that".
  it("is one smooth closed path from the top centre, clockwise: a rounded rectangle, or an ellipse round a small control", () => {
    expect(Ring.ringPath("box", 200, 40)).toBe("M100 0 H188 A12 12 0 0 1 200 12 V28 A12 12 0 0 1 188 40 H12 A12 12 0 0 1 0 28 V12 A12 12 0 0 1 12 0 Z");
    // The radius is min(12, w/2, h/2): a short box is a pill, never a corner past its middle.
    expect(Ring.ringPath("box", 60, 16, 16, 56)).toBe("M46 56 H68 A8 8 0 0 1 76 64 V64 A8 8 0 0 1 68 72 H24 A8 8 0 0 1 16 64 V64 A8 8 0 0 1 24 56 Z");
    expect(Ring.ringPath("circle", 52, 32, 16, 16)).toBe("M42 16 A26 16 0 0 1 42 48 A26 16 0 0 1 42 16 Z");
    // No randomness any more: no seed, no jitter, no second stroke; the same size draws the same ring.
    expect(Ring.ringPath("box", 140, 50)).toBe(Ring.ringPath("box", 140, 50));
    expect(Ring.ringPath("box", 140, 50)).not.toMatch(/C/);
    expect(Ring.ringPath("box", Number.NaN, -4)).toMatch(/^M0\.5 0 /);
    const src = file("desktop/src/ring.js");
    expect(src).not.toMatch(/Math\.random|mulberry|JITTER|echo/);
    expect(file("desktop/src/ring.html")).toContain('<path class="halo" pathLength="1"/><path class="main" pathLength="1"/><circle class="tap" r="6"/>');
  });
  it("wears her coat colour and its edge shade for the glow, only as #rrggbb; today's binary's ring is orange", () => {
    expect(Ring.colourOf("#FF9447")).toBe("#ff9447");
    for (const bad of ["red", "#fff", "url(x)", "#ff944780", "var(--x)", null, 5]) expect(Ring.colourOf(bad)).toBe("#ff6c02");
    expect(Ring.ORANGE).toBe("#FF6C02");
    const css = file("desktop/src/ring.css");
    // 2 points in her colour, a 6-point glow at 40% blurred 3, drawn in 250 ms from the top, breathing every 1.6 s, cleared in 300 ms.
    expect(css).toMatch(/\.ring \.main \{ stroke: var\(--ring\); stroke-width: 2; filter: drop-shadow\(0 0 \.75px rgb\(15 15 16 \/ \.55\)\); \}/);
    expect(css).toMatch(/\.ring \.halo \{ stroke: var\(--glow\); stroke-width: 6; opacity: \.4; filter: blur\(3px\); \}/);
    expect(css).toMatch(/animation: draw \.25s cubic-bezier\(\.3,0,\.2,1\) both, breathe 1\.6s ease-in-out \.25s infinite alternate/);
    expect(css).toMatch(/@keyframes draw \{ from \{ stroke-dashoffset: 1; \} to \{ stroke-dashoffset: 0; \} \}/);
    expect(css).toMatch(/@keyframes breathe \{ from \{ opacity: \.25; \} to \{ opacity: \.55; \} \}/);
    expect(css).toMatch(/body\.clear \.ring, body\.clear \.label \{ opacity: 0; transition: opacity \.3s ease-in; \}/);
    // Reduced motion: drawn at once, no breathing.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ring\.drawing path, \.ring\.drawing \.halo, \.ring\.tapping \.tap \{ animation: none; \}/);
  });
  // Review, 12 October 2026 (experience-2): her default coat is near-white, which read as a faint double grey outline on
  // light windows; a light coat draws the line in orange and keeps the coat for the glow.
  it("draws a light coat's ring in orange, so it is one clear line on light windows", () => {
    expect(Ring.ringColours("#ececf0", "#c9cad1")).toEqual({ ring: "#ff6c02", glow: "#ececf0" });
    expect(Ring.ringColours("#ffffff")).toEqual({ ring: "#ff6c02", glow: "#ffffff" });
    expect(Ring.ringColours("#74a3ff", "#416FD4")).toEqual({ ring: "#74a3ff", glow: "#416fd4" });
    expect(Ring.ringColours("#ffd54a", "#d0a015")).toEqual({ ring: "#ffd54a", glow: "#d0a015" });
    expect(Ring.ringColours(undefined)).toEqual({ ring: "#ff6c02", glow: "#ff6c02" });
    expect(Ring.luminance("#ececf0")).toBeGreaterThan(0.8);
    expect(Ring.luminance("#ffd54a")).toBeLessThan(0.8);
  });
  it("applies Rust's ring message: the path on both strokes, her colours, drawn or at once", () => {
    const g2 = globalThis as Record<string, unknown>;
    const mk = () => new El();
    const halo = mk(), main = mk(), tap = mk(), label = mk(), body = mk();
    const svg = Object.assign(mk(), { q: (s: string) => ({ ".halo": halo, ".main": main, ".tap": tap } as Record<string, El>)[s] ?? null });
    g2.document = { body, querySelector: (s: string) => ({ ".ring": svg, ".label": label } as Record<string, El>)[s] ?? null };
    Ring._reset();
    expect(Ring.apply({ t: "ring", w: 84, h: 104, shape: "circle", label: "Export", seed: 99, labelAt: "below", draw: true, colour: "#74a3ff", glow: "#416FD4" })).toBe(true);
    for (const n of [halo, main]) { expect(n.getAttribute("d")).toBe("M42 16 A26 16 0 0 1 42 48 A26 16 0 0 1 42 16 Z"); expect(n.getAttribute("pathLength")).toBe("1"); }
    expect([body.props.get("--ring"), body.props.get("--glow")]).toEqual(["#74a3ff", "#416fd4"]);
    expect(svg.classes.has("drawing")).toBe(true);
    expect(label.textContent).toBe("Export");
    // Today's binary: no colour, so orange; draw false (or reduced motion): there at once, no breathing.
    Ring.apply({ t: "ring", w: 84, h: 104, shape: "box", label: "", draw: false });
    expect([body.props.get("--ring"), body.props.get("--glow"), svg.classes.has("drawing"), svg.classes.has("drawn")]).toEqual(["#ff6c02", "#ff6c02", false, true]);
    Ring.apply({ t: "clear" });
    expect(body.classes.has("clear")).toBe(true);
    delete g2.document;
    Ring._reset();
  });
  it("lays the ring and its label out in the window Rust sized (ring_frame): 16 points of room, 40 for the label", () => {
    // Rust's own example (companion.rs bridge test): an 84 by 104 window round a 40 by 40 target grown by 6.
    expect(Ring.layout({ w: 84, h: 104, labelAt: "below", label: "Export" })).toMatchObject({ w: 52, h: 32, left: 16, top: 16, labelX: 42, labelY: 56, label: "Export", shape: "circle" });
    expect(Ring.layout({ w: 84, h: 104, labelAt: "above", label: "x", shape: "box" })).toMatchObject({ top: 56, labelY: 26, shape: "box" });
    expect(Ring.layout({ w: 84, h: 104, label: "An extremely long label for a ring" }).label).toHaveLength(24);
    expect(Ring.layout({ w: -5, h: Number.NaN })).toMatchObject({ w: 8, h: 60 });
  });
});
