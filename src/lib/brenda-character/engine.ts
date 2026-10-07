/**
 * Brenda, drawn (owner decision, 5 October 2026). A small canvas engine for Boredroom's AI teammate. Her look (owner
 * design, 7 October 2026, from the owner's artwork): a glossy white sphere with a black bean-shaped visor and two white
 * pill eyes glowing behind it. The visor turns with her head, sliding across the sphere and foreshortening as she looks
 * around (and going round the back when she spins); the eyes sit a little deeper and move a little further. She blinks,
 * breathes, has a soft glow and rim light in the colour of her mood (which also tints her eyes), particles, and a set
 * of expressions.
 *
 * The techniques (eyes on a sphere with yaw and pitch, tweened squash and stretch, frame-rate independent smoothing,
 * particle bursts) follow the MIT-licensed engine of Coucou by Louis Raillé (github.com/Louis-CFM/coucou). Coucou's
 * character, Mochi, its look, expressions as a character, sounds and artwork are not used: its asset licence reserves
 * them. Brenda's shape, palette and expression set are Boredroom's.
 *
 * Her reactions (owner request, 7 October 2026: "when typing, she'll look like she's looking at what you're typing;
 * when you're sending a voice note she'll look like she's listening"): `lookAt()` gives her somewhere to look instead of
 * the pointer (the caret in her box), followed more keenly; `readAlong()` plays the small things a reader does (a flick
 * of the eyes as each character arrives, a nod or a blink every few words, a surprised blink at a paste); `voice`, while
 * she listens, is the level she hears, which widens her eyes, tilts her head a little further and lifts her light (a
 * gentle pulse when there is no level). `attention`, at the end of this file, is where the page tells every face and
 * character of hers what is being typed to her. `settle()` takes a pose at once, for the still frames of reduced motion.
 */

export type BrendaState =
  | "idle" | "listening" | "thinking" | "working" | "happy" | "alert" | "question"
  | "error" | "sleeping" | "dizzy" | "love" | "proud";
export type BrendaEmote = "love" | "wink" | "proud" | "surprised" | "yawn" | "happy" | "pleased" | "annoyed" | "celebrate";
/** What happened in the box she is reading: a character arrived, a few words went by, a lot arrived at once. */
export type ReadCue = "key" | "beat" | "paste";
type EyeShape = "pill" | "wide" | "happy" | "closed" | "flat" | "line" | "spiral" | "heart" | "star" | "wink" | "tired" | "dot";
type RGB = [number, number, number];

type StateCfg = {
  eye: EyeShape;
  glow: string;          // the mood light under and around her
  tint: number;          // how much of the glow colours her face (0 to 1)
  look?: [number, number];
  scans?: boolean;       // eyes sweep side to side (working, thinking)
  bounces?: boolean;     // small hops (alert)
  breathes?: boolean;
  tilt?: number;
  zz?: boolean;
  sparkles?: boolean;
};

export const STATES: Record<BrendaState, StateCfg> = {
  idle:      { eye: "pill",   glow: "#8f8cff", tint: 0,    breathes: true },
  listening: { eye: "wide",   glow: "#ff6c02", tint: 0.18, breathes: true, tilt: 0.1 },
  thinking:  { eye: "pill",   glow: "#7c5cff", tint: 0.22, look: [0.55, -0.45] },
  working:   { eye: "pill",   glow: "#6fa8ff", tint: 0.18, scans: true },
  happy:     { eye: "happy",  glow: "#34e0a1", tint: 0.2,  breathes: true, sparkles: true },
  alert:     { eye: "wide",   glow: "#ffc857", tint: 0.24, bounces: true },
  question:  { eye: "pill",   glow: "#22d3ee", tint: 0.2,  tilt: 0.17 },
  error:     { eye: "flat",   glow: "#ff5c7a", tint: 0.26 },
  sleeping:  { eye: "closed", glow: "#94a3b8", tint: 0.1,  breathes: true, zz: true },
  dizzy:     { eye: "spiral", glow: "#ff3d81", tint: 0.22 },
  love:      { eye: "heart",  glow: "#ff4d6d", tint: 0.22, breathes: true },
  proud:     { eye: "star",   glow: "#ffc857", tint: 0.18, tilt: -0.08, sparkles: true },
};

// Her look (owner design, 7 October 2026): a glossy white sphere with a black bean-shaped visor, two white pill eyes
// glowing behind the glass. Proportions are fractions of the sphere's radius, measured from the owner's artwork.
const VISOR_INK = "#0b0b0e";
const VISOR_W = 0.8, VISOR_TOP = -0.42, VISOR_DIP = -0.28, VISOR_BOTTOM = 0.44;
const VISOR_REACH = 0.62, VISOR_PITCH = Math.asin(0.19 / VISOR_REACH);   // the visor's centre sits 0.19 R above the middle
const EYE_W = 0.15, EYE_H = 0.31, EYE_SPREAD = 0.42, EYE_Y = -0.04;
const BODY_LIGHT: RGB = [1, 1, 1];
const BODY_MID: RGB = [0.965, 0.965, 0.973];
const BODY_SHADE: RGB = [0.87, 0.875, 0.895];
const BODY_RIM: RGB = [0.72, 0.725, 0.76];

/** The visor, centred on the origin: rounded lobes over each eye, a soft dip between them, a broad curve beneath. */
function visorPath(R: number): Path2D {
  const a = VISOR_W * R, t = VISOR_TOP * R, d = VISOR_DIP * R, b = VISOR_BOTTOM * R, m = -0.02 * R;
  const v = new Path2D();
  v.moveTo(-a, m);
  v.bezierCurveTo(-a, t * 0.9, -a * 0.8, t, -a * 0.5, t);
  v.bezierCurveTo(-a * 0.28, t, -a * 0.16, d, 0, d);
  v.bezierCurveTo(a * 0.16, d, a * 0.28, t, a * 0.5, t);
  v.bezierCurveTo(a * 0.8, t, a, t * 0.9, a, m);
  v.bezierCurveTo(a, b * 0.8, a * 0.62, b, 0, b);
  v.bezierCurveTo(-a * 0.62, b, -a, b * 0.8, -a, m);
  v.closePath();
  return v;
}
const SPARK = ["#ff6c02", "#ff3d81", "#7c5cff", "#ffc857"];

type Ease = (t: number) => number;
const E = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  lin: (t: number) => t,
};
type Key = [value: number, ms: number, ease: Ease];
type Prop = "sx" | "sy" | "oy" | "ox" | "roll" | "tilt" | "open";
type Particle = { kind: "heart" | "star" | "spark" | "z" | "sweat" | "q"; x: number; y: number; vx: number; vy: number; age: number; life: number; size: number; color: string; spin: number };

const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const nowS = () => performance.now() / 1000;

function roundRect(p: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
}
function heart(x: CanvasRenderingContext2D, s: number) {
  x.beginPath(); x.moveTo(0, s * 0.35);
  x.bezierCurveTo(-s * 0.9, -s * 0.2, -s * 0.45, -s * 0.85, 0, -s * 0.35);
  x.bezierCurveTo(s * 0.45, -s * 0.85, s * 0.9, -s * 0.2, 0, s * 0.35); x.closePath();
}
function star(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? ri : ro; const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
  x.closePath();
}

export class BrendaEngine {
  state: BrendaState = "idle";
  private cfg: StateCfg = STATES.idle;
  // Pose
  private yaw = 0; private pitch = 0; private roll = 0; private tilt = 0;
  private sx = 1; private sy = 1; private ox = 0; private oy = 0; private open = 1;
  private eyeScale = 1; private eyeScaleTarget = 1;
  // Where she looks (-1 to 1, positive is right and down), set from the pointer
  lookX = 0; lookY = 0;
  /** Somewhere to look instead of the pointer (the caret she reads along), in the same units; see lookAt(). */
  private focus: { x: number; y: number } | null = null;
  /** While she listens: how loud the voice is, 0 to 1, or null for a gentle pulse. Set by the caller each frame. */
  voice: number | null = null;
  /** The voice as she reacts to it: quick to rise, slow to fall. */
  private heard = 0;
  private beats = 0;
  private glow: RGB = hex(STATES.idle.glow);
  private glowTarget: RGB = hex(STATES.idle.glow);
  private tint = 0;
  private override: EyeShape | null = null;
  private overrideUntil = 0;
  private nextBlink = nowS() + 1.5;
  private lastAmbient = 0;
  private particles: Particle[] = [];
  private tweens = new Map<Prop, { keys: Key[]; i: number; from: number; start: number }>();
  private t0 = nowS();

  setState(next: BrendaState) {
    if (next === this.state) return;
    this.state = next;
    this.cfg = STATES[next];
    this.glowTarget = hex(this.cfg.glow);
    this.eyeScaleTarget = next === "listening" || next === "alert" ? 1.08 : 1;
    if (next === "happy") { this.hop(); this.emit("spark", 6); }
    if (next === "error") this.shake();
    if (next === "proud") this.emit("star", 4);
    if (next === "love") this.emit("heart", 3);
    if (next === "dizzy") this.spin(1300, 2);
  }

  /** A passing expression on top of the state. */
  emote(e: BrendaEmote) {
    const n = nowS();
    const hold = (shape: EyeShape, s: number) => { this.override = shape; this.overrideUntil = n + s; };
    switch (e) {
      case "love": hold("heart", 2.2); this.emit("heart", 4); this.glowFlash("#ff4d6d"); break;
      case "wink": hold("wink", 0.7); this.tween("tilt", [[0.14, 120, E.out], [0.14, 300, E.lin], [0, 220, E.inOut]]); break;
      case "proud": hold("star", 1.8); this.emit("star", 5); this.tween("tilt", [[-0.12, 200, E.out], [-0.12, 900, E.lin], [0, 300, E.inOut]]); break;
      case "surprised": hold("dot", 0.9); this.eyeScale = 1.35; this.hop(); break;
      case "yawn": hold("tired", 1.4); this.tween("sy", [[1.14, 500, E.inOut], [1, 500, E.inOut]]); this.emit("z", 1); break;
      case "happy": hold("happy", 1.4); this.hop(); this.emit("spark", 5); break;
      // A reply: smiling eyes and a small lift, quieter than happy (no hop, no sparks).
      case "pleased": hold("happy", 1.3); this.tween("oy", [[-0.06, 160, E.out], [0, 320, E.inOut]]); break;
      case "annoyed": hold("line", 0.9); this.squash(); this.glowFlash("#a855f7"); break;
      case "celebrate": hold("happy", 1.6); this.spin(950, 1); this.emit("spark", 12); this.emit("star", 3); break;
    }
  }

  blink() { this.tween("open", [[0.08, 70, E.out], [1, 120, E.out]]); }
  squash() {
    this.tween("sy", [[0.74, 70, E.out], [1.12, 130, E.out], [0.95, 150, E.inOut], [1, 170, E.back]]);
    this.tween("sx", [[1.22, 70, E.out], [0.9, 130, E.out], [1.04, 150, E.inOut], [1, 170, E.back]]);
  }
  hop() {
    this.tween("oy", [[-0.28, 140, E.out], [0.04, 180, E.inOut], [0, 160, E.back]]);
    this.tween("sy", [[0.86, 80, E.out], [1.14, 130, E.out], [0.94, 150, E.inOut], [1, 180, E.back]]);
    this.tween("sx", [[1.1, 80, E.out], [0.92, 130, E.out], [1.04, 150, E.inOut], [1, 180, E.back]]);
  }
  shake() { this.tween("ox", [[-0.12, 50, E.out], [0.12, 80, E.inOut], [-0.09, 70, E.inOut], [0.06, 70, E.inOut], [0, 110, E.out]]); }
  spin(ms: number, turns: number) { this.roll = 0; this.tween("roll", [[Math.PI * 2 * turns, ms, E.inOut]], () => { this.roll = 0; }); }
  /** A small reader's nod: a dip of the head and the eyes. */
  nod() { this.tween("oy", [[0.045, 120, E.out], [0, 260, E.inOut]]); this.pitch -= 0.05; }

  /**
   * Somewhere to look instead of the pointer, in the pointer's units (-1 to 1, positive is right and down): the caret
   * while someone types to her. She follows it more keenly than the pointer. null gives her eyes back to the pointer.
   */
  lookAt(x: number | null, y = 0) {
    const c = (v: number) => Math.max(-1, Math.min(1, v));
    this.focus = x === null ? null : { x: c(x), y: c(y) };
  }

  /**
   * Reading along as someone types to her: a small flick of the eyes as a character arrives (`key`), a nod or a blink
   * every few words, in turn (`beat`), and a quick surprised blink, eyes popping wide, when a lot arrives at once (`paste`).
   */
  readAlong(cue: ReadCue) {
    if (cue === "key") { this.yaw += (Math.random() < 0.5 ? -1 : 1) * 0.045; this.pitch += (Math.random() - 0.5) * 0.04; }
    else if (cue === "beat") { if (this.beats++ % 2) this.blink(); else this.nod(); }
    else { this.eyeScale = 1.28; this.blink(); setTimeout(() => this.blink(), 240); }
  }

  /** Takes the pose her state and gaze ask for at once, with nothing in motion: the still frames of reduced motion. */
  settle() {
    this.tweens.clear(); this.onDone.clear(); this.particles = []; this.override = null;
    this.open = 1; this.roll = 0; this.ox = 0; this.oy = 0; this.sx = 1; this.sy = 1; this.heard = 0;
    [this.yaw, this.pitch] = this.aim(0);
    this.tilt = this.cfg.tilt ?? 0;
    this.eyeScale = this.eyeScaleTarget;
    this.glow = this.glowTarget; this.tint = this.cfg.tint;
  }

  /** Where her eyes are headed: the caret or the pointer, unless her state has its own look. */
  private aim(t: number): [yaw: number, pitch: number] {
    const f = this.focus;
    // Down on the page is a positive look; on her face, looking down is a negative pitch.
    let ty = (f ? f.x : this.lookX) * 0.6, tp = -(f ? f.y : this.lookY) * 0.45;
    if (this.cfg.look) { ty = ty * 0.3 + this.cfg.look[0] * 0.6; tp = tp * 0.3 + this.cfg.look[1] * 0.5; }
    if (this.cfg.scans) { ty = Math.sin(t * 2.4) * 0.6; tp = -0.05; }
    if (this.state === "sleeping") { ty = 0; tp = -0.12; }
    if (this.state === "dizzy") ty = Math.sin(t * 9) * 0.25;
    return [ty, tp];
  }
  private glowFlash(h: string) { const back = this.glowTarget; this.glow = hex(h); this.glowTarget = hex(h); setTimeout(() => { this.glowTarget = back; }, 900); }

  private onDone = new Map<Prop, () => void>();
  private tween(p: Prop, keys: Key[], done?: () => void) {
    this.tweens.set(p, { keys, i: 0, from: this[p], start: performance.now() });
    if (done) this.onDone.set(p, done); else this.onDone.delete(p);
  }

  emit(kind: Particle["kind"], count: number) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const sp = kind === "z" ? 0.22 : kind === "sweat" ? 0.1 : 0.5 + Math.random() * 0.45;
      this.particles.push({
        kind, x: (Math.random() - 0.5) * 0.9, y: kind === "z" ? -0.55 : -0.25,
        vx: Math.cos(a) * sp * (kind === "z" ? 0.4 : 1), vy: Math.sin(a) * sp,
        age: 0, life: kind === "z" ? 2.4 : 1.1 + Math.random() * 0.6,
        size: kind === "spark" ? 0.07 + Math.random() * 0.05 : 0.15 + Math.random() * 0.06,
        color: kind === "spark" ? SPARK[i % SPARK.length] : kind === "heart" ? "#ff4d6d" : kind === "star" ? "#ffc857" : "#9fd2ff",
        spin: (Math.random() - 0.5) * 6,
      });
    }
  }

  update(dt: number) {
    const ms = performance.now();
    for (const [p, tw] of [...this.tweens]) {
      const k = tw.keys[tw.i];
      const t = Math.min(1, Math.max(0, (ms - tw.start) / k[1]));
      this[p] = tw.from + (k[0] - tw.from) * k[2](t);
      if (t >= 1) { tw.from = k[0]; tw.i++; tw.start = ms; if (tw.i >= tw.keys.length) { this.tweens.delete(p); this.onDone.get(p)?.(); this.onDone.delete(p); } }
    }
    const n = nowS(), t = n - this.t0;
    const [ty, tp] = this.aim(t);
    const k = (base: number) => 1 - Math.pow(base, dt);
    // Reading along, her eyes keep up with the caret: more keenly than they follow the pointer.
    const follow = k(this.focus ? 0.0002 : 0.0025);
    this.yaw += (ty - this.yaw) * follow;
    this.pitch += (tp - this.pitch) * follow;
    // Listening: the voice (a gentle pulse without a level) widens her eyes, tilts her head a little further, stretches
    // her breath and lifts her light. Quick to rise with the voice, slower to fall back.
    const live = this.state === "listening";
    const lv = live ? Math.max(0, Math.min(1, this.voice ?? 0.2 + Math.sin(t * 2.4) * 0.15)) : 0;
    this.heard += (lv - this.heard) * k(lv > this.heard ? 1e-7 : 0.02);
    if (!this.tweens.has("tilt")) this.tilt += ((this.cfg.tilt ?? 0) + this.heard * 0.05 + (this.state === "dizzy" ? Math.sin(t * 7) * 0.12 : 0) - this.tilt) * k(0.001);
    if (!this.tweens.has("oy")) this.oy += ((this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0) - this.oy) * k(0.0008);
    if (!this.tweens.has("sy") && !this.tweens.has("sx")) {
      const amp = this.cfg.breathes ? 0.03 : 0;
      this.sy += (1 + Math.sin(t * 1.8) * amp + this.heard * 0.045 - this.sy) * k(0.001);
      this.sx += (1 - Math.sin(t * 1.8) * amp * 0.55 - this.heard * 0.02 - this.sx) * k(0.001);
    }
    this.eyeScale += (this.eyeScaleTarget + this.heard * 0.16 - this.eyeScale) * k(live ? 0.00002 : 0.002);
    this.glow = mix(this.glow, this.glowTarget, k(0.003));
    this.tint += (this.cfg.tint - this.tint) * k(0.003);
    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy" && !this.override) { this.blink(); if (Math.random() < 0.22) setTimeout(() => this.blink(), 230); }
      this.nextBlink = n + 2.2 + Math.random() * 3.2;
    }
    if (this.override && n > this.overrideUntil) this.override = null;
    if (n - this.lastAmbient > 1.2) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
      if (this.cfg.sparkles && Math.random() < 0.6) this.emit("spark", 1);
    }
    for (const p of this.particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.kind === "z" ? -0.02 : 0.25) * dt; }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  /** Draws into a canvas of W×H CSS pixels (the caller applies the device pixel ratio). */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    x.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.34;   // the sphere's radius: room around her for the glow, hops and particles
    const cx = W / 2 + this.ox * R, cy = H / 2 + this.oy * R + R * 0.04;
    const eyeInk = mix([1, 1, 1], this.glow, Math.min(1, this.tint * 1.6));

    // The mood light beneath her.
    const g = x.createRadialGradient(cx, cy + R * 0.2, R * 0.6, cx, cy + R * 0.2, R * 1.3);
    g.addColorStop(0, rgba(this.glow, 0.42 + this.heard * 0.28)); g.addColorStop(1, rgba(this.glow, 0));
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    x.save();
    x.translate(cx, cy);
    x.rotate(this.tilt);
    x.scale(this.sx, this.sy);

    // The sphere: glossy white, lit from the upper left, shading to a cool grey at the lower right rim.
    const body = new Path2D(); body.arc(0, 0, R, 0, Math.PI * 2);
    x.save(); x.shadowColor = rgba(this.glow, 0.5 + this.heard * 0.25); x.shadowBlur = R * (0.3 + this.heard * 0.2); x.fillStyle = "#fff"; x.fill(body); x.restore();
    const bg = x.createRadialGradient(-R * 0.34, -R * 0.42, 0, -R * 0.1, -R * 0.12, R * 1.18);
    bg.addColorStop(0, rgba(BODY_LIGHT)); bg.addColorStop(0.5, rgba(BODY_MID)); bg.addColorStop(0.85, rgba(BODY_SHADE)); bg.addColorStop(1, rgba(BODY_RIM));
    x.fillStyle = bg; x.fill(body);
    // Her mood as a rim light along the bottom of the sphere.
    if (this.tint > 0.01) {
      const tg = x.createRadialGradient(0, R * 0.2, R * 0.55, 0, R * 0.2, R * 1.05);
      tg.addColorStop(0, rgba(this.glow, 0)); tg.addColorStop(1, rgba(this.glow, 0.55 * this.tint));
      x.fillStyle = tg; x.fill(body);
    }
    // The gloss: a soft sheen up and to the left, and a crisp highlight inside it.
    const sheen = x.createRadialGradient(-R * 0.42, -R * 0.55, 0, -R * 0.42, -R * 0.55, R * 0.6);
    sheen.addColorStop(0, "rgba(255,255,255,0.95)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sheen; x.fill(body);
    x.lineWidth = Math.max(1, R * 0.015); x.strokeStyle = "rgba(20,24,40,0.1)"; x.stroke(body);

    // The visor turns with her head: it slides across the sphere and foreshortens as it nears the edge, and goes round
    // the back when she spins.
    let p = VISOR_PITCH + this.pitch + this.roll;
    p = ((((p + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const cy0 = Math.cos(this.yaw), cp = Math.cos(p);
    if (cy0 * cp > 0.05) {
      x.save(); x.clip(body);
      x.translate(Math.sin(this.yaw) * cp * R * VISOR_REACH, -Math.sin(p) * R * VISOR_REACH);
      x.scale(Math.max(0.2, cy0), Math.max(0.2, cp / Math.cos(VISOR_PITCH)));
      const visor = visorPath(R);
      // The lip where the visor sits into the shell, then the black glass.
      x.save(); x.shadowColor = "rgba(30,32,44,0.45)"; x.shadowBlur = R * 0.06; x.shadowOffsetY = R * 0.015; x.fillStyle = VISOR_INK; x.fill(visor); x.restore();
      const vg = x.createRadialGradient(0, R * 0.05, R * 0.1, 0, 0, R * 0.85);
      vg.addColorStop(0, "#0a0a0d"); vg.addColorStop(1, "#24252c");
      x.fillStyle = vg; x.fill(visor);
      x.save(); x.clip(visor);
      // The glass catches the light: a wide sheen across the top and a bevel just inside the rim.
      const gl = x.createLinearGradient(0, -R * 0.4, 0, R * 0.05);
      gl.addColorStop(0, "rgba(255,255,255,0.2)"); gl.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gl; x.fillRect(-R, -R * 0.45, R * 2, R * 0.5);
      x.lineWidth = R * 0.035; x.strokeStyle = "rgba(255,255,255,0.12)"; x.stroke(visor);
      // Eyes behind the glass: they move a little further than the visor (they sit deeper), glow softly and keep
      // every expression.
      const shape = this.override ?? this.cfg.eye;
      x.fillStyle = rgba(eyeInk); x.strokeStyle = rgba(eyeInk);
      x.shadowColor = rgba(eyeInk, 0.85); x.shadowBlur = R * 0.08;
      const px = Math.sin(this.yaw) * R * 0.07, py = -Math.sin(this.pitch) * R * 0.05;
      for (const sd of [-1, 1]) {
        x.save();
        x.translate(sd * R * EYE_SPREAD + px, R * EYE_Y + py);
        this.eye(x, shape, R * EYE_W * this.eyeScale, R * EYE_H * this.eyeScale, sd, rgba(eyeInk));
        x.restore();
      }
      x.restore();
      x.restore();
    }
    x.restore();

    this.drawParticles(x, R, cx, cy);
  }

  private eye(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number, ink: string): void {
    const t = nowS();
    switch (shape) {
      case "wide": return this.eye(x, "pill", w * 1.14, h * 1.12, sd, ink);
      case "pill": { const hh = Math.max(h * this.open, w * 0.28); x.beginPath(); roundRect(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); x.fill(); return; }
      case "dot": x.beginPath(); x.arc(0, 0, w * 0.6, 0, Math.PI * 2); x.fill(); return;
      case "line": x.rotate(-sd * 0.25); x.beginPath(); roundRect(x, -w * 0.9, -w * 0.25, w * 1.8, w * 0.5, w * 0.25); x.fill(); return;
      case "flat": x.beginPath(); roundRect(x, -w * 0.9, -w * 0.25, w * 1.8, w * 0.5, w * 0.25); x.fill(); return;
      case "happy": x.lineWidth = w * 0.6; x.lineCap = "round"; x.beginPath(); x.arc(0, h * 0.2, w * 1.05, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); return;
      case "closed": x.lineWidth = w * 0.45; x.lineCap = "round"; x.beginPath(); x.arc(0, -h * 0.12, w, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); return;
      case "tired": x.beginPath(); roundRect(x, -w / 2, -h * 0.02, w, h * 0.36, w / 2); x.fill(); x.beginPath(); roundRect(x, -w * 0.8, -h * 0.12, w * 1.6, w * 0.26, w * 0.13); x.fill(); return;
      case "wink": if (sd < 0) return this.eye(x, "pill", w, h, sd, ink); return this.eye(x, "happy", w, h, sd, ink);
      case "spiral": {
        x.lineWidth = w * 0.26; x.lineCap = "round"; x.beginPath();
        for (let a = 0; a < 4.4 * Math.PI; a += 0.2) { const r = w * 0.08 + a * w * 0.075; const aa = a + t * 9 * sd; const px = Math.cos(aa) * r, py = Math.sin(aa) * r; if (a === 0) x.moveTo(px, py); else x.lineTo(px, py); }
        x.stroke(); return;
      }
      case "heart": x.fillStyle = "#ff4d6d"; x.shadowColor = "rgba(255,77,109,0.8)"; x.scale(1 + Math.sin(t * 9) * 0.08, 1 + Math.sin(t * 9) * 0.08); heart(x, w * 1.6); x.fill(); x.fillStyle = ink; return;
      case "star": x.fillStyle = "#f7b32b"; x.shadowColor = "rgba(247,179,43,0.8)"; x.rotate(t * 1.5 * sd); star(x, w * 1.35, w * 0.6); x.fill(); x.fillStyle = ink; return;
    }
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      const life = p.age / p.life;
      const a = life < 0.15 ? life / 0.15 : 1 - Math.max(0, (life - 0.55) / 0.45);
      x.save();
      x.globalAlpha = Math.max(0, a);
      x.translate(cx + p.x * R * 1.6, cy + p.y * R * 1.6);
      x.rotate(p.spin * p.age * 0.3);
      const s = p.size * R;
      x.fillStyle = p.color;
      if (p.kind === "heart") { heart(x, s); x.fill(); }
      else if (p.kind === "star") { star(x, s * 0.8, s * 0.36); x.fill(); }
      else if (p.kind === "spark") { x.shadowColor = p.color; x.shadowBlur = s * 2; star(x, s, s * 0.3); x.fill(); }
      else if (p.kind === "sweat") { x.beginPath(); x.ellipse(0, 0, s * 0.35, s * 0.5, 0, 0, Math.PI * 2); x.fill(); }
      else { x.rotate(-p.spin * p.age * 0.3); x.fillStyle = "rgba(160,170,200,0.9)"; x.font = `600 ${s * 1.6}px "Geist Variable", system-ui, sans-serif`; x.fillText(p.kind === "z" ? "z" : "?", 0, 0); }
      x.restore();
    }
  }
}

// ---- What is being typed to her, page-wide ------------------------------------------------------------------------

type Point = { x: number; y: number };
type AttentionListener = (cue: ReadCue | null) => void;

/** How long she keeps looking at the box after the last key, and after it loses the focus. */
export const READ_HOLD_MS = 1500;
export const READ_BLUR_HOLD_MS = 600;

let gazeAt: Point | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const attentionListeners = new Set<AttentionListener>();
const tell = (cue: ReadCue | null) => { for (const l of [...attentionListeners]) l(cue); };

/**
 * Where her attention is, for every face and character of hers on the page at once (she is one person): her box
 * (BrendaComposer) tells it where the caret is as someone types, and they look there, more keenly than they follow the
 * pointer, with the cue's small reaction. She keeps looking a moment after the last key (READ_HOLD_MS), then her eyes go
 * back to the pointer. Listeners hear the cue, or null when only the caret moved or she stopped reading (`gaze` null).
 */
export const attention = {
  /** The caret she is reading at, in viewport coordinates, or null when nobody is typing to her. */
  get gaze(): Point | null { return gazeAt; },
  /** Someone typed (or moved the caret): she looks at `at` and keeps looking for a moment after. */
  read(at: Point, cue: ReadCue | null = null) {
    gazeAt = at;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => attention.release(), READ_HOLD_MS);
    tell(cue);
  },
  /** She stops reading: now (a message sent), or after `afterMs` (the box lost the focus). */
  release(afterMs = 0) {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (!gazeAt) return;
    if (afterMs > 0) { holdTimer = setTimeout(() => attention.release(), afterMs); return; }
    gazeAt = null;
    tell(null);
  },
  subscribe(fn: AttentionListener): () => void {
    attentionListeners.add(fn);
    return () => { attentionListeners.delete(fn); };
  },
};
