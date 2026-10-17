// The ring round what Brenda points at (owner request, 12 October 2026; contract A.5, B.4.2, C.5). Plain JavaScript, loadable
// by Node for the unit tests (tests/unit/notch-companion.test.ts). Rust sizes the window (the ring, 16 points of room on each
// side, 40 for the label above or below) and calls `window.Ring.apply(msg)`. No invoke, no listen, no network; the label
// is text (textContent, 24 characters at most).
//
// A clean ring (owner report, 12 October 2026: "some of the highlighted items have very wiggly lines, I don't like
// that"; companion2 contract E, 0b.10). The hand-drawn ring (24 jittered points, a stroke running past its start and a
// fainter second stroke) is gone: one smooth closed path, a rounded rectangle (radius min(12, w/2, h/2)) or an ellipse
// round a small control, starting at the top centre and running clockwise, 2 points in her coat colour over a soft outer
// glow in its edge shade (the glow is an owner-approved exception to "no glow", 12 October 2026), drawn in one 250 ms
// stroke, then the glow breathes gently (1.6 s) while it stays. Reduced motion: there at once, no breathing.
//
// Messages: {t:"ring", w, h, shape:"circle"|"box", label, seed, labelAt:"below"|"above", draw, colour?, glow?} where w and
// h are the window's own size as Rust's `ring_frame` makes it (the ring is that less 16 points of room each side and 40
// for the label); `colour` and `glow` are `#rrggbb` (her `face.mid` and `face.edge`), else orange (today's Rust sends
// none); `seed` is ignored (kept for compatibility); {t:"tap"} (a 300 ms ripple at the centre of a small window Rust puts
// where each click lands while she works, the ring hidden); {t:"clear"} (fades out in 300 ms).

const Ring = (() => {
  const ROOM = 16, LABEL = 40, LABEL_MAX = 24, RADIUS = 12;
  /** Her colour when Rust does not send one (today's binary): the accent orange (contract 0b.9). */
  const ORANGE = "#FF6C02";
  const HEX = /^#[0-9a-f]{6}$/i;
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
  const num = (v, lo, hi, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const clip = (v, n) => { const c = [...(typeof v === "string" ? v : "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()]; return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };
  /** A colour Rust sent, if it is exactly `#rrggbb`; otherwise the fallback. Nothing else reaches the page's styles. */
  const colourOf = (v, fallback = ORANGE) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback.toLowerCase());
  const f = (v) => (Math.round(v * 100) / 100).toString();
  /** Relative luminance (WCAG) of `#rrggbb`, 0 (black) to 1 (white). */
  function luminance(hex) {
    const c = colourOf(hex);
    const lin = (i) => { const v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  }
  /** Above this a coat colour is too light to be the ring's line on light windows. */
  const LIGHT = 0.8;
  /**
   * The ring's line and glow colours from her coat (Rust's `colour` and `glow`). Review, 12 October 2026: her default
   * coat is near-white (#ececf0), which drawn as the line on a light window read as two thin grey lines (the dark contact
   * shadow either side of a white one), close to the "wiggly lines" the owner disliked, and most Mac windows are light.
   * A light coat draws the line in the accent orange and keeps the coat for the glow; any other coat is the line itself.
   */
  function ringColours(colour, glow) {
    const coat = colourOf(colour);
    const edge = colourOf(glow, coat);
    return luminance(coat) > LIGHT ? { ring: ORANGE.toLowerCase(), glow: coat } : { ring: coat, glow: edge };
  }

  /**
   * The ring's path (pure; contract E): one closed path round a w × h box at (ox, oy), from the top centre, clockwise.
   * A box is a rounded rectangle of radius min(12, w/2, h/2); a circle is the ellipse inside the box. The same every time
   * for the same size: there is no randomness any more.
   */
  function ringPath(shape, w, h, ox = 0, oy = 0) {
    const W = Math.max(1, num(w, 0, 8000, 1)), H = Math.max(1, num(h, 0, 8000, 1));
    const x = num(ox, -8000, 8000, 0), y = num(oy, -8000, 8000, 0);
    const cx = x + W / 2;
    if (shape === "box") {
      const r = Math.min(RADIUS, W / 2, H / 2);
      return `M${f(cx)} ${f(y)} H${f(x + W - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + W)} ${f(y + r)} V${f(y + H - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + W - r)} ${f(y + H)} H${f(x + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + H - r)} V${f(y + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
    }
    const rx = W / 2, ry = H / 2;
    return `M${f(cx)} ${f(y)} A${f(rx)} ${f(ry)} 0 0 1 ${f(cx)} ${f(y + H)} A${f(rx)} ${f(ry)} 0 0 1 ${f(cx)} ${f(y)} Z`;
  }

  /** Where the ring and its label sit in the window of `m.w` by `m.h` points (pure; contract B.4.5, Rust's ring_frame). */
  function layout(m) {
    const W = num(m.w, 0, 4000, 92), H = num(m.h, 0, 4000, 132);
    const w = Math.max(8, W - 2 * ROOM), h = Math.max(8, H - 2 * ROOM - LABEL);
    const above = m.labelAt === "above";
    const left = ROOM, top = ROOM + (above ? LABEL : 0);
    return { w, h, left, top, shape: m.shape === "box" ? "box" : "circle", labelX: left + w / 2, labelY: above ? top - 8 - 22 : top + h + 8, label: clip(m.label, LABEL_MAX) };
  }

  let el = null;
  function els() {
    if (el) return el;
    if (typeof document !== "object" || !document) return null;
    const svg = document.querySelector(".ring");
    if (!svg) return null;
    el = { body: document.body, svg, halo: svg.querySelector(".halo"), main: svg.querySelector(".main"), tap: svg.querySelector(".tap"), label: document.querySelector(".label") };
    return el;
  }
  const reduced = (m) => m?.reduce === true || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) || !!el?.body?.classList.contains("reduce");
  /** Restarts a CSS animation class. */
  function replay(node, cls) { if (!node) return; node.classList.remove(cls); void node.getBoundingClientRect?.(); node.classList.add(cls); }

  function ring(m, e) {
    const L = layout(m);
    const d = ringPath(L.shape, L.w, L.h, L.left, L.top);
    e.body.classList.remove("clear", "tapmode");
    if (m.reduce === true) e.body.classList.add("reduce");
    // Her coat colour, and its edge shade for the glow (contract E: Rust's `colour` and `glow`, checked here); a light
    // coat draws the line in orange (`ringColours`).
    const rc = ringColours(m.colour, m.glow);
    e.body.style.setProperty("--ring", rc.ring);
    e.body.style.setProperty("--glow", rc.glow);
    for (const node of [e.halo, e.main]) {
      if (!node) continue;
      node.setAttribute("d", d);
      node.setAttribute("pathLength", "1");
    }
    e.svg.classList.remove("drawing", "drawn");
    if (m.draw !== false && !reduced(m)) replay(e.svg, "drawing");
    else e.svg.classList.add("drawn");
    if (e.label) {
      e.label.textContent = L.label;
      e.label.style.left = `${L.labelX.toFixed(1)}px`;
      e.label.style.top = `${L.labelY.toFixed(1)}px`;
      e.label.classList.toggle("on", !!L.label);
    }
  }

  function apply(msg) {
    const e = els();
    if (!e || !msg || typeof msg !== "object") return false;
    if (msg.t === "ring") { ring(msg, e); return true; }
    if (msg.t === "tap") {
      // Its own small window, centred where the click lands: the ripple at the window's centre, no ring.
      const cx = typeof innerWidth === "number" && innerWidth > 0 ? innerWidth / 2 : 24, cy = typeof innerHeight === "number" && innerHeight > 0 ? innerHeight / 2 : 24;
      e.body.classList.remove("clear"); e.body.classList.add("tapmode");
      if (typeof msg.colour === "string") e.body.style.setProperty("--ring", ringColours(msg.colour).ring);
      if (e.tap) { e.tap.setAttribute("cx", cx.toFixed(1)); e.tap.setAttribute("cy", cy.toFixed(1)); }
      if (!reduced(msg)) replay(e.svg, "tapping");
      return true;
    }
    if (msg.t === "clear") { e.body.classList.add("clear"); e.svg.classList.remove("tapping"); return true; }
    return false;
  }
  function reset() { el = null; }

  return Object.freeze({ ORANGE, apply, ringPath, layout, colourOf, luminance, ringColours, _reset: reset });
})();
if (typeof window === "object" && window) window.Ring = Ring;
if (typeof module === "object" && module && module.exports) module.exports = Ring;
