// Brenda's sounds (owner decision, 4 October 2026). Every sound is synthesised here with the Web Audio API, so there are
// no audio files and nothing borrowed: short, soft sine and triangle notes with quick envelopes, played quietly. The
// way the engine is run comes from Coucou's SoundEngine (Louis Raillé, MIT): one shared context and master gain, a low
// default volume, and the context suspended a moment after the last sound so an idle notch costs no CPU.
//
// Quiet hours (owner decision, 8 October 2026: phase 7a, "quiet means quiet"): while the person's quiet hours are on,
// main.js sets `setQuiet(true)` and nothing plays at all, whatever made the sound (an arrival, the island opening, a
// button's tick); the tray's sound switch is kept as it is and applies again once quiet hours end.

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a global for main.js, the next classic script on the page
const Sound = (() => {
  let ctx = null, master = null, idleTimer = null;
  let enabled = true;
  let quiet = false;
  const VOLUME = 0.16;

  function audio() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctx && ctx.state === "running" && ctx.suspend(), 1800);
    return ctx;
  }

  /** One note: frequency glide, attack, decay; `at` is seconds from now. */
  function note({ f, to = f, at = 0, dur = 0.12, type = "sine", gain = 1, attack = 0.006 }) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to !== f) o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.85);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** A breath of filtered noise, for the send swoosh. */
  function breath({ at = 0, dur = 0.16, from = 900, to = 3200, gain = 0.35 }) {
    const c = audio(); if (!c) return;
    const t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const sounds = {
    // The island opens: a soft upward pair.
    open: () => { note({ f: 520, to: 660, dur: 0.11, gain: 0.5 }); note({ f: 780, at: 0.06, dur: 0.14, gain: 0.35 }); },
    // And closes: the same pair, falling.
    close: () => { note({ f: 640, to: 470, dur: 0.12, gain: 0.4 }); },
    // Something arrived (a reminder, an assignment): a bright two-note chime.
    notify: () => { note({ f: 988, dur: 0.16, type: "triangle", gain: 0.55 }); note({ f: 1319, at: 0.09, dur: 0.26, type: "triangle", gain: 0.45 }); },
    // Done (clocked in, a task finished, an action confirmed): a quick major arpeggio.
    success: () => { [523, 659, 784, 1047].forEach((f, i) => note({ f, at: i * 0.055, dur: 0.18, type: "triangle", gain: 0.42 })); },
    // Something went wrong: two low notes stepping down, not alarming.
    error: () => { note({ f: 330, dur: 0.13, type: "triangle", gain: 0.5 }); note({ f: 247, at: 0.1, dur: 0.2, type: "triangle", gain: 0.45 }); },
    // The mic opens and closes.
    listen: () => { note({ f: 440, to: 880, dur: 0.16, gain: 0.45 }); },
    heard: () => { note({ f: 880, to: 520, dur: 0.14, gain: 0.35 }); },
    // A question goes to Brenda.
    send: () => { breath({}); note({ f: 700, to: 1100, at: 0.04, dur: 0.1, gain: 0.25 }); },
    // Brenda answers.
    reply: () => { note({ f: 784, dur: 0.1, gain: 0.35 }); note({ f: 1047, at: 0.07, dur: 0.16, gain: 0.3 }); },
    // Something needs a yes.
    attention: () => { note({ f: 880, dur: 0.1, type: "triangle", gain: 0.45 }); note({ f: 880, at: 0.14, dur: 0.12, type: "triangle", gain: 0.4 }); },
    // A tiny click for small changes (pause, progress).
    tick: () => { note({ f: 1800, to: 1200, dur: 0.035, type: "square", gain: 0.12 }); },
    // A file lands in Brenda: a quick downward gulp.
    gulp: () => { note({ f: 620, to: 180, dur: 0.16, gain: 0.55 }); note({ f: 300, at: 0.12, dur: 0.08, type: "triangle", gain: 0.3 }); },
    // Poked: a soft low boop.
    poke: () => { note({ f: 260, to: 200, dur: 0.09, type: "triangle", gain: 0.5 }); },
    // Poked too often: a wobbling slide down.
    dizzy: () => { [0, 0.09, 0.18, 0.27].forEach((at, i) => note({ f: 700 - i * 90, to: 640 - i * 90, at, dur: 0.12, gain: 0.3 })); },
    // Loved: two warm notes up.
    love: () => { note({ f: 659, dur: 0.16, gain: 0.35 }); note({ f: 988, at: 0.1, dur: 0.24, gain: 0.3 }); },
    // Someone is calling (owner decisions, 8 October 2026: phase 8, calls): the web's soft two-tone phone pattern
    // (src/lib/brenda-sound.ts `ring`), about 1.2 s; main.js plays it every 2.5 s while the incoming card shows. Quiet hours
    // and the tray's sound switch silence it as they silence every sound.
    ring: () => { [0, 0.4].forEach((at) => { note({ f: 660, at, dur: 0.18, type: "triangle", gain: 0.45 }); note({ f: 880, at: at + 0.2, dur: 0.18, type: "triangle", gain: 0.4 }); }); },
    // A call declined from here: the web's `hangup`, one short falling note.
    hangup: () => { note({ f: 520, to: 360, dur: 0.22, type: "triangle", gain: 0.4 }); },
  };

  return {
    play(name) { if (enabled && !quiet && sounds[name]) try { sounds[name](); } catch { /* sound never breaks the notch */ } },
    setEnabled(on) { enabled = !!on; },
    /** The person's quiet hours (phase 7a): no sound of any kind while on. */
    setQuiet(on) { quiet = !!on; },
    /** Web views start audio suspended until the person interacts; any click wakes it. */
    unlock() { if (enabled && !quiet) audio(); },
  };
})();
