// The timer card on the desktop (owner request, 14 November 2026: "a floating card that lives on your desktop when you're
// working on a task"). Plain JavaScript, loadable by Node for the unit tests (tests/unit/notch-timer-card.test.ts).
//
// Rust (timer_card.rs) shows this page in its own small window while a task timer runs or is paused, and calls
// `window.TimerCard.apply(msg)` each time the notch learns something new (a poll every 20 seconds, and at once after a
// press). Between messages the page counts the seconds itself, from the moment the message arrived.
//
// Messages: {t:"timer", id, title, state:"running"|"paused"|"interrupted", elapsed, estimateMinutes?} where `elapsed` is
// whole seconds on the clock when Rust sent it; {t:"clear"} (no timer: the card empties; Rust hides the window).
// Anything else is ignored. The task's name is text (textContent, 120 characters at most): it may be someone else's
// words, or Brenda's.
//
// The page can call exactly one command, `timer_card_press`, with one of the words in PRESSES. "ready" (sent once the
// page has loaded) asks Rust for the current timer; "hide" hides the card until the next timer; "open", "pause",
// "resume" and "stop" are passed to the notch, which does what its own buttons do. Nothing here reaches Boredroom, the
// Mac, or Brenda's Yes. After a press the buttons wait for the next message (4 seconds at most), so a press is not sent
// twice.

const TimerCard = (() => {
  const STATES = ["running", "paused", "interrupted"];
  const PRESSES = ["ready", "open", "pause", "resume", "stop", "hide"];
  const TITLE_MAX = 120, DAY = 86_400, BUSY_MS = 4000;
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
  // The words beside the clock: the notch's own, with "Connection interrupted" cut to fit the card.
  const WORDS = { running: "On the clock", paused: "Paused", interrupted: "Interrupted" };
  const PAUSE_MARK = "M5.5 3.5v9M10.5 3.5v9", PLAY_MARK = "M5 3.5v9l7.5-4.5z";

  const pad = (n) => String(n).padStart(2, "0");
  /** Seconds as the notch and My Day write a timer: "01:05:09". */
  const hms = (s) => { const n = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0)); return `${pad(Math.floor(n / 3600))}:${pad(Math.floor(n / 60) % 60)}:${pad(n % 60)}`; };
  const clip = (v, n) => { const c = [...(typeof v === "string" ? v : "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()]; return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };

  /** A timer message as the page uses it, or null for anything that is not one. */
  function viewOf(msg) {
    if (!msg || typeof msg !== "object" || msg.t !== "timer") return null;
    if (typeof msg.id !== "string" || !/^[0-9a-f-]{8,64}$/i.test(msg.id) || !STATES.includes(msg.state)) return null;
    const elapsed = typeof msg.elapsed === "number" && Number.isFinite(msg.elapsed) ? Math.min(99 * 3600, Math.max(0, Math.floor(msg.elapsed))) : null;
    if (elapsed === null) return null;
    const est = typeof msg.estimateMinutes === "number" && Number.isFinite(msg.estimateMinutes) && msg.estimateMinutes > 0 ? Math.min(DAY / 60, msg.estimateMinutes) : null;
    return { id: msg.id, title: clip(msg.title, TITLE_MAX) || "Untitled task", state: msg.state, elapsed, estimateMinutes: est };
  }
  /** The seconds on the clock `now`, for a view that arrived at `at` (both in ms): only a running timer moves. */
  const secondsAt = (view, at, now) => (view.state === "running" ? view.elapsed + Math.max(0, Math.floor((now - at) / 1000)) : view.elapsed);
  /** How far through the estimate, 0 to 1, or null without one. */
  const shareOf = (view, seconds) => (view.estimateMinutes ? Math.min(1, seconds / (view.estimateMinutes * 60)) : null);

  let view = null, at = 0, tick = null, busy = null, el = null;
  const $ = (id) => document.getElementById(id);
  const els = () => el ?? (el = { card: $("card"), title: $("title"), clock: $("clock"), state: $("state"), toggle: $("toggle"), mark: $("toggle-mark"), est: $("est"), bar: $("est-bar") });
  const buttons = () => (typeof document.querySelectorAll === "function" ? [...document.querySelectorAll("button[data-press]")] : []);

  function paintClock() {
    if (!view) return;
    const e = els(), s = secondsAt(view, at, Date.now());
    e.clock.textContent = hms(s);
    const share = shareOf(view, s);
    e.est.hidden = share === null;
    if (share !== null) e.bar.style.transform = `scaleX(${share.toFixed(3)})`;
  }
  function setBusy(on) {
    clearTimeout(busy); busy = null;
    for (const b of buttons()) if (b.dataset.press !== "hide") b.disabled = on;
    if (on) busy = setTimeout(() => setBusy(false), BUSY_MS);
  }

  function apply(msg) {
    const e = els();
    if (msg && typeof msg === "object" && msg.t === "clear") {
      view = null; clearInterval(tick); tick = null; setBusy(false);
      e.card.hidden = true; e.card.dataset.state = "idle"; e.title.textContent = "";
      return true;
    }
    const v = viewOf(msg);
    if (!v) return false;
    view = v; at = Date.now(); setBusy(false);
    const live = v.state === "running";
    e.card.hidden = false;
    e.card.dataset.state = v.state;
    e.title.textContent = v.title;
    e.state.textContent = WORDS[v.state];
    e.clock.setAttribute("aria-label", `${WORDS[v.state]}: ${v.title}`);
    e.toggle.dataset.press = live ? "pause" : "resume";
    e.toggle.setAttribute("aria-label", live ? "Pause the timer" : "Resume the timer");
    e.toggle.title = live ? "Pause" : "Resume";
    e.mark.setAttribute("d", live ? PAUSE_MARK : PLAY_MARK);
    paintClock();
    clearInterval(tick); tick = live ? setInterval(paintClock, 1000) : null;
    return true;
  }

  /** One of the six words to Rust; anything else goes nowhere. */
  function press(action) {
    if (!PRESSES.includes(action)) return false;
    const invoke = typeof window === "object" && window ? window.__TAURI__?.core?.invoke : null;
    if (typeof invoke !== "function") return false;
    if (action !== "ready" && action !== "hide" && action !== "open") setBusy(true);
    Promise.resolve(invoke("timer_card_press", { action })).catch(() => setBusy(false));
    return true;
  }

  function start() {
    document.addEventListener("click", (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest("button[data-press]") : null;
      if (b && !b.disabled) press(b.dataset.press);
    });
    // The card is not a page to browse: no menu, no selecting, no dropping files on it.
    document.addEventListener("contextmenu", (ev) => ev.preventDefault());
    for (const type of ["dragover", "drop"]) document.addEventListener(type, (ev) => ev.preventDefault());
    press("ready");
  }
  function reset() { view = null; at = 0; clearInterval(tick); tick = null; clearTimeout(busy); busy = null; el = null; }

  return Object.freeze({ STATES, PRESSES, WORDS, apply, press, hms, viewOf, secondsAt, shareOf, start, _reset: reset });
})();
if (typeof window === "object" && window) { window.TimerCard = TimerCard; if (typeof document === "object" && document?.addEventListener) TimerCard.start(); }
if (typeof module === "object" && module && module.exports) module.exports = TimerCard;
