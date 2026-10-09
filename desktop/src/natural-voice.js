// Her natural voice on the notch (owner decision, 9 October 2026: natural voice (ElevenLabs), contract G.2). Plain
// JavaScript, no build step: a classic script loaded after notify.js and before main.js, sharing their one global scope,
// and loadable by Node for the unit tests (tests/unit/notch-natural-voice.test.ts).
//
// The webview cannot fetch Boredroom or play a URL from it (Rust holds the bearer token, and the CSP allows no media
// source), so main.js asks the speech route for the whole utterance as base64 through Rust's `api` command (`as:
// "base64"`) and hands it here. This decodes it with Web Audio (`decodeAudioData`, no URL, so the CSP does not apply),
// plays it through an AnalyserNode and sends the level of what is playing on every animation frame, so her faces follow
// the real audio as they follow `say`'s render. Nothing is kept: the bytes live only as long as the utterance.
//
// It never decides whether she speaks (Voice off and quiet hours stay with main.js) and never falls back by itself: any
// failure is `onFail(why)`, and main.js then speaks with the computer voice at once, so the notch never goes silent.
// `supported` goes false for the rest of the run once the context truly will not run (contract G.3: if WKWebView will
// not start Web Audio without a press, the notch keeps the computer voice; desktop/README.md has the Rust change for
// later). Truly (review, 9 October 2026): resume() refused, or still not running REFUSE_MS after it was asked. A slow
// wake-up (a Bluetooth output such as AirPods, an output device gone idle) only makes that one utterance the computer
// voice's: warm() answers false after RESUME_MS, but goes on watching, and a context that runs a moment later keeps the
// natural voice for the next one.
//
// The level maths are the web's, exactly (src/lib/assistant-speech/level.ts, contract F.1; change one, change the other):
// the RMS of each analyser frame times 6 (ordinary speech, an RMS of about 0.15, is 0.9), followed with a fast attack
// (30 ms time constant) and a slower decay (120 ms), and never below 0.08 while she plays, as the web's envelope (FLOOR),
// so her eyes never shut mid-word.

// A global for main.js, a later classic script on the page (and module.exports for Node, at the end).
const NaturalVoice = (() => {
  const T = Object.freeze({
    RESUME_MS: 300,   // the context must be running this soon after resume() for this utterance, else "suspended"
    REFUSE_MS: 2_000, // not running this long after resume() (or resume() refused): it never will, the natural voice is off for the run
    IDLE_MS: 1_800,   // the context is suspended this long after the last utterance, so an idle notch costs no CPU (as sound.js)
    FFT: 1024,        // the analyser's frame (about 23 ms at 44.1 kHz)
    ATTACK_MS: 30,    // the web's ATTACK_TAU_MS
    DECAY_MS: 120,    // the web's DECAY_TAU_MS
    FLOOR: 0.08,      // the web's LEVEL_FLOOR
    GAIN: 6,          // loudness to level (the web's LEVEL_GAIN)
    MAX_BYTES: 4 * 1024 * 1024, // what one utterance may be, decoded from base64 (the route caps its audio at 2 MB)
  });

  let ctx = null, analyser = null, frame = null, idleTimer = null, current = null;
  let supported = true;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const root = () => (typeof window === "object" && window ? window : globalThis);
  const later = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => Promise.resolve().then(fn);
  /** A caller's callback, never allowed to break the player. */
  const safe = (fn, ...a) => { try { if (typeof fn === "function") fn(...a); } catch { /* the caller's own trouble */ } };

  /** Standard base64 (what the speech route sends) to an ArrayBuffer; throws on anything else. */
  function base64ToArrayBuffer(b64) {
    const s = typeof b64 === "string" ? b64.replace(/\s+/g, "") : "";
    if (!s || s.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new Error("not base64");
    if ((s.length / 4) * 3 > T.MAX_BYTES) throw new Error("too long");
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  /** The root mean square of one frame of samples (-1 to 1), from 0 to 1; 0 for none or for nonsense. */
  function rmsLevel(samples) {
    const n = samples && Number.isInteger(samples.length) ? samples.length : 0;
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) { const x = samples[i]; if (Number.isFinite(x)) sum += x * x; }
    const rms = Math.sqrt(sum / n);
    return Number.isFinite(rms) ? clamp(rms, 0, 1) : 0;
  }

  /**
   * Her next speaking level (0 to 1) from the last one, this frame's RMS and the time since the last frame: up towards the
   * loudness (times GAIN, at most 1) with the attack time constant, down with the decay one, never under FLOOR.
   */
  function speakingLevel(prev, rms, dtMs) {
    const from = Number.isFinite(prev) ? clamp(prev, 0, 1) : T.FLOOR;
    const target = Number.isFinite(rms) ? clamp(rms * T.GAIN, 0, 1) : 0;
    const dt = Number.isFinite(dtMs) ? Math.max(0, Math.min(dtMs, 1_000)) : 0;
    const tau = target > from ? T.ATTACK_MS : T.DECAY_MS;
    const next = from + (target - from) * (1 - Math.exp(-dt / tau));
    return clamp(Math.max(T.FLOOR, next), 0, 1);
  }

  /** The one context (created on first use, again if it was closed), with its analyser to the speakers; null without Web Audio. */
  function context() {
    if (ctx && ctx.state !== "closed") return ctx;
    ctx = null; analyser = null;
    const g = root();
    const Ctor = g.AudioContext || g.webkitAudioContext;
    if (typeof Ctor !== "function") return null;
    try {
      ctx = new Ctor();
      analyser = ctx.createAnalyser();
      analyser.fftSize = T.FFT;
      analyser.connect(ctx.destination);
      frame = new Float32Array(analyser.fftSize);
    } catch { ctx = null; analyser = null; }
    return ctx;
  }

  /**
   * The context, running: true at once when it runs, after resume() when that works within RESUME_MS, else false (no
   * Web Audio, or a webview that will not start audio without a press). main.js asks before fetching the audio, so a
   * context that will not run never costs the workspace's characters.
   */
  function warm() {
    if (!supported) return Promise.resolve(false);
    const c = context();
    if (!c) return Promise.resolve(false);
    clearTimeout(idleTimer);
    if (c.state === "running") return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false, settled = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      // After the answer: running at last (a slow wake-up) goes back to sleep if nothing plays; never running, or
      // refused, turns the natural voice off for the run.
      const verdict = (running) => {
        if (settled) return;
        settled = true; clearTimeout(refuse);
        // Too late for this utterance (the answer was already false): nothing will play on it, so it sleeps again.
        if (running) { if (done && !current) idle(); } else supported = false;
        finish(running);
      };
      const timer = setTimeout(() => finish(c.state === "running"), T.RESUME_MS);
      const refuse = setTimeout(() => verdict(c.state === "running"), T.REFUSE_MS);
      try { Promise.resolve(c.resume()).then(() => { if (c.state === "running") verdict(true); }, () => verdict(false)); }
      catch { verdict(false); }
    });
  }

  /** decodeAudioData as a promise, for both its forms (old WebKit only calls back). */
  const decode = (c, buf) => new Promise((resolve, reject) => {
    try {
      const p = c.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (e) { reject(e); }
  });

  /** The level of what plays now, from the analyser. */
  function measure() {
    if (!analyser || !frame) return 0;
    if (typeof analyser.getFloatTimeDomainData === "function") { analyser.getFloatTimeDomainData(frame); return rmsLevel(frame); }
    const bytes = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bytes);
    for (let i = 0; i < bytes.length; i++) frame[i] = (bytes[i] - 128) / 128;
    return rmsLevel(frame);
  }

  // Every animation frame; a 33 ms timer where there are none (a hidden page gets no frames, and the face is not seen
  // then anyway, but the level stays current for when it is).
  const hidden = () => typeof document === "object" && document && document.visibilityState === "hidden";
  const nextFrame = (fn) => (typeof root().requestAnimationFrame === "function" && !hidden() ? { raf: root().requestAnimationFrame(fn) } : { timer: setTimeout(() => fn(), 33) });
  const cancelFrame = (h) => { if (!h) return; if (h.raf !== undefined && typeof root().cancelAnimationFrame === "function") root().cancelAnimationFrame(h.raf); if (h.timer !== undefined) clearTimeout(h.timer); };
  const now = () => (typeof performance === "object" && performance && typeof performance.now === "function" ? performance.now() : Date.now());

  /** The context goes to sleep a moment after the last utterance (sound.js does the same with its own). */
  function idle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!current && ctx && ctx.state === "running") { try { Promise.resolve(ctx.suspend()).catch(() => {}); } catch { /* fine */ } } }, T.IDLE_MS);
  }

  /**
   * Plays one utterance (`audioBase64`, an MP3 or anything Web Audio decodes) and returns `stop()`. One at a time: a new
   * play stops the last. `onStart()` once the first sound is scheduled, `onLevel(0..1)` on every animation frame while it
   * plays, `onEnd()` when it finished (or failed once heard), `onFail(why)` instead of all of them when it could not start: "decode"
   * (not audio, or nothing Web Audio can read), "suspended" (the context would not run within 300 ms), "unsupported" (no
   * Web Audio) or "error". Callbacks always come later, never from inside play(). `stop()` is silent: the caller knows.
   */
  function play({ audioBase64, onStart, onLevel, onEnd, onFail } = {}) {
    if (current) current.stop();
    let over = false, started = false, src = null, tick = null;
    const handle = { stop };
    current = handle;

    function cleanup() {
      cancelFrame(tick); tick = null;
      if (src) {
        src.onended = null;
        try { src.stop(); } catch { /* never started, or already ended */ }
        try { src.disconnect(); } catch { /* already */ }
        src = null;
      }
      if (current === handle) current = null;
      idle();
    }
    function stop() { if (over) return; over = true; cleanup(); }
    // A failure once it was heard ends it (never a restart from the top, contract F.1); before, it is onFail.
    function fail(why) { if (over) return; over = true; cleanup(); if (started) safe(onEnd); else safe(onFail, why); }

    let buf;
    try { buf = base64ToArrayBuffer(audioBase64); }
    catch { later(() => fail("decode")); return stop; }
    if (!root().AudioContext && !root().webkitAudioContext) { later(() => fail("unsupported")); return stop; }

    warm().then((running) => {
      if (over) return;
      if (!running) return fail("suspended");
      const c = ctx;
      return decode(c, buf).then((audio) => {
        if (over) return;
        if (!audio || !(audio.duration > 0)) return fail("decode");
        src = c.createBufferSource();
        src.buffer = audio;
        src.connect(analyser);
        src.onended = () => { if (over) return; over = true; cleanup(); safe(onEnd); };
        src.start();
        started = true;
        safe(onStart);
        let level = 0, at = now();
        // The frame's own time when it has one (same clock as performance.now()), else now.
        const step = (ts) => {
          if (over) return;
          const t = Number.isFinite(ts) ? ts : now();
          level = speakingLevel(level, measure(), t - at);
          at = Math.max(at, t);
          safe(onLevel, level);
          tick = nextFrame(step);
        };
        tick = nextFrame(step);
      }, () => fail("decode"));
    }).catch(() => fail("error"));
    return stop;
  }

  return Object.freeze({
    T,
    /** False for the rest of the run once the context would not run (resume() refused, or not running after REFUSE_MS), or `disable()`. */
    get supported() { return supported; },
    disable() { supported = false; },
    /**
     * Nothing is going to play after all (a refusal, a timeout, a hush, the microphone opening before the audio came):
     * the context goes back to sleep IDLE_MS from now, as after an utterance (review, 9 October 2026).
     */
    release: () => { if (!current) idle(); },
    base64ToArrayBuffer,
    rmsLevel,
    speakingLevel,
    warm,
    play,
    /** Whether an utterance is playing (or about to). */
    playing: () => !!current,
    /** Stops whatever plays, silently. */
    stop: () => { if (current) current.stop(); },
  });
})();
if (typeof module === "object" && module && module.exports) module.exports = NaturalVoice;
