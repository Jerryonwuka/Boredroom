// The companion by the pointer (owner request, 12 October 2026: "Clicky's companion cursor that follows you around, in the
// colour of your Brenda"; contract A.4, B.4.2, C.5). Plain JavaScript, no build step, loadable by Node for the unit tests
// (tests/unit/notch-companion.test.ts, with a tiny stand-in for the page's elements).
//
// Rust drives this page and nothing else does: it calls `window.Companion.apply(msg)` with one typed message at a time
// (serde_json, so every string is a JSON string, never script), and moves the window itself. The page has no invoke, no
// listen and no network: it cannot start anything, answer anything or press anything (the owner's rule, 12 October 2026:
// nothing on screen can act; and the app's ACL gives this window no command at all). It only draws her: her face in the
// person's colour, visor and eyes, her mood for the state, and the small things beside her (the listening bars, the
// thinking dot, the doing arc, the file job's dot, the done check, a neutral pill).
//
// Everything it is given is checked: an unknown `t` or state is ignored, colours must be #rrggbb (else Brenda's), the visor
// and eyes come from their three shapes, numbers are clamped, and words are set with textContent only, clipped to the
// contract's lengths. The asking pill is the plan, then "Do you want me to do this?", then where to answer: it can never
// carry a button, because nothing here can be pressed (the window ignores the mouse).

const Companion = (() => {
  const BRENDA = { colour: "white", face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" }, visor: "bean", eyes: "pill", name: "Brenda" };
  const VISORS = ["bean", "band", "screen"];
  const EYES = ["pill", "round", "square"];
  const STATES = ["idle", "listening", "thinking", "speaking", "pointing", "asking", "doing", "paused", "done", "sad"];
  const HEX = /^#[0-9a-f]{6}$/i;
  // The face's mood for each state (contract A.4): resting, listen, think, talk, (leaning), alert, think, alert, happy, sad.
  const MOOD = { idle: "", listening: "listen", thinking: "think", speaking: "talk", pointing: "", asking: "alert", doing: "think", paused: "alert", done: "happy pleased", sad: "sad" };
  const QUESTION = "Do you want me to do this?";
  const LIMITS = { text: 200, sub: 120, hint: 120, name: 24 };
  /** The doing hint ("Esc stops me") shows for the first 5 s of a task only (contract A.4). */
  const HINT_MS = 5_000;
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

  const str = (v) => (typeof v === "string" ? v : "");
  const oneLine = (v) => str(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const clip = (v, n) => { const c = [...oneLine(v)]; return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };
  const num = (v, lo, hi, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const bool = (v) => v === true;

  /** The person's assistant's look as this page may draw it (as main.js's assistantOf): anything wrong is Brenda's. */
  function lookOf(m) {
    const f = m && typeof m.face === "object" && m.face ? m.face : {};
    const shades = [f.hi, f.mid, f.edge].every((v) => typeof v === "string" && HEX.test(v));
    return {
      colour: typeof m?.colour === "string" && /^[a-z]{1,16}$/.test(m.colour) ? m.colour : BRENDA.colour,
      face: shades ? { hi: f.hi, mid: f.mid, edge: f.edge } : BRENDA.face,
      visor: VISORS.includes(m?.visor) ? m.visor : BRENDA.visor,
      eyes: EYES.includes(m?.eyes) ? m.eyes : BRENDA.eyes,
      name: clip(m?.name, LIMITS.name) || BRENDA.name,
    };
  }

  // ---- the page (looked up once; a missing element is skipped, so a partial page never throws) ---------------------
  let el = null;
  function els() {
    if (el) return el;
    const d = typeof document === "object" && document ? document : null;
    if (!d) return null;
    const q = (s) => d.querySelector(s);
    el = { root: q(".cmp"), body: q(".body"), face: q(".face"), pill: q(".pill"), l1: q(".pill .l1"), l2: q(".pill .l2"), l3: q(".pill .l3"), bars: [...d.querySelectorAll(".wave i")] };
    return el.root ? el : (el = null);
  }

  const now = () => (typeof performance === "object" && performance && typeof performance.now === "function" ? performance.now() : Date.now());
  const state = { name: "idle", flip: { x: false, y: false }, reduce: false, doingSince: 0, hint: "", flight: null, hintTimer: null };

  /** Where her eyes rest: towards the pointer, which is up and to the left of her (mirrored when she flips). */
  function restEyes(e) {
    if (!e.face) return;
    e.face.style.setProperty("--lx", state.flip.x ? "0.55" : "-0.55");
    e.face.style.setProperty("--ly", state.flip.y ? "0.45" : "-0.45");
  }
  function setMood(e) {
    if (!e.face) return;
    const mood = MOOD[state.name] ?? "";
    e.face.className = `face cmp${mood ? ` ${mood}` : ""}`;
    if (state.name !== "speaking") e.face.style.removeProperty("--talk");
    if (state.name !== "listening") e.face.style.removeProperty("--lvl");
  }
  function setText(node, text) { if (node) node.textContent = text; }

  // ---- the messages (contract B.4.2) --------------------------------------------------------------------------------

  function look(m, e) {
    const a = lookOf(m);
    if (!e.face) return;
    e.face.dataset.sphere = a.colour;
    e.face.dataset.visor = a.visor;
    e.face.dataset.eyes = a.eyes;
    e.face.style.setProperty("--sphere-hi", a.face.hi);
    e.face.style.setProperty("--sphere-mid", a.face.mid);
    e.face.style.setProperty("--sphere-edge", a.face.edge);
    e.root.style.setProperty("--sphere-mid", a.face.mid);
    if (typeof document === "object" && document) document.title = a.name;
  }

  function setState(m, e) {
    if (!STATES.includes(m.state)) return; // an unknown state is ignored: she stays as she was
    const was = state.name;
    state.name = m.state;
    if (m.flip && typeof m.flip === "object") {
      state.flip = { x: bool(m.flip.x), y: bool(m.flip.y) };
      e.root.toggleAttribute("data-flip-x", state.flip.x);
      e.root.toggleAttribute("data-flip-y", state.flip.y);
    }
    e.root.dataset.state = state.name;
    setMood(e);
    if (state.name !== "pointing") restEyes(e);
    // Her pill: the plan and the fixed question while she asks; the step note while she works (and "Esc stops me" for its
    // first 5 s); "Paused. Carry on in the notch?" while she waits after a pause.
    let l1 = "", l2 = "", l3 = "";
    if (state.name === "asking") {
      l1 = clip(m.text, LIMITS.text);
      l2 = QUESTION; // never anything else: the question is fixed (contract 0.4)
      l3 = clip(m.hint, LIMITS.hint) || "Say yes or no while holding ⌃ ⌘, or answer in the notch.";
    } else if (state.name === "doing") {
      if (was !== "doing") state.doingSince = now();
      l1 = clip(m.text, 48);
      const hint = clip(m.hint, LIMITS.hint) || "Esc stops me";
      l3 = now() - state.doingSince < HINT_MS ? hint : "";
      clearTimeout(state.hintTimer);
      if (l3 && typeof setTimeout === "function") state.hintTimer = setTimeout(() => { if (state.name === "doing") { setText(e.l3, ""); } }, Math.max(0, HINT_MS - (now() - state.doingSince)));
    } else if (state.name === "paused") {
      l1 = clip(m.text, LIMITS.text) || "Paused. Carry on in the notch?";
      l3 = clip(m.sub, LIMITS.sub);
    }
    setText(e.l1, l1); setText(e.l2, l2); setText(e.l3, l3);
    e.root.toggleAttribute("data-pill", !!(l1 || l2 || l3));
    if (state.name !== "pointing" && state.flight) { try { state.flight.cancel(); } catch { /* already done */ } state.flight = null; }
  }

  /** The microphone's level while she listens (the bars and her eyes), or her voice's while she speaks (her eyes). */
  function level(m, e) {
    const v = num(m.v, 0, 1);
    if (state.name === "listening") {
      if (e.face) e.face.style.setProperty("--lvl", v.toFixed(2));
      // Five bars, the middle tallest, from 4 to 20 points.
      const shape = [0.55, 0.8, 1, 0.8, 0.55];
      e.bars.forEach((b, i) => { b.style.height = `${Math.round(4 + 16 * v * shape[i])}px`; });
    } else if (state.name === "speaking" && e.face && !state.reduce) e.face.style.setProperty("--talk", v.toFixed(3));
  }

  /** A flight begins (contract A.5): lean along it (at most 12°) and grow to 1.15× mid-way, for `ms`; her eyes look ahead. */
  function flight(m, e) {
    const ms = num(m.ms, 0, 3000);
    const dx = num(m.dx, -1e6, 1e6), dy = num(m.dy, -1e6, 1e6);
    const len = Math.hypot(dx, dy) || 1;
    if (e.face) { e.face.style.setProperty("--lx", (dx / len).toFixed(3)); e.face.style.setProperty("--ly", (dy / len).toFixed(3)); }
    if (state.reduce || !ms || !e.body || typeof e.body.animate !== "function") return;
    const lean = Math.max(-12, Math.min(12, (dx / len) * 12));
    try { if (state.flight) state.flight.cancel(); } catch { /* already done */ }
    state.flight = e.body.animate(
      [{ transform: "rotate(0deg) scale(1)" }, { transform: `rotate(${lean.toFixed(2)}deg) scale(1.15)`, offset: 0.5 }, { transform: "rotate(0deg) scale(1)" }],
      { duration: ms, easing: "ease-in-out" },
    );
  }

  function apply(msg) {
    const e = els();
    if (!e || !msg || typeof msg !== "object" || typeof msg.t !== "string") return false;
    switch (msg.t) {
      case "look": look(msg, e); return true;
      case "state": setState(msg, e); return true;
      case "level": level(msg, e); return true;
      case "flight": flight(msg, e); return true;
      case "badge": e.root.toggleAttribute("data-badge", bool(msg.on)); return true;
      case "motion": state.reduce = bool(msg.reduce); e.root.toggleAttribute("data-reduce", state.reduce); if (state.reduce && state.flight) { try { state.flight.cancel(); } catch { /* done */ } state.flight = null; } return true;
      case "fade": e.root.classList.toggle("faded", !bool(msg.visible)); return true;
      default: return false; // an unknown message is ignored
    }
  }

  /** For the tests: forget the page and the state (a fresh page). */
  function reset() { el = null; Object.assign(state, { name: "idle", flip: { x: false, y: false }, reduce: false, doingSince: 0, hint: "", flight: null }); }

  return Object.freeze({ apply, lookOf, STATES: Object.freeze([...STATES]), QUESTION, _reset: reset });
})();
if (typeof window === "object" && window) window.Companion = Companion;
if (typeof module === "object" && module && module.exports) module.exports = Companion;
