/**
 * Brenda, drawn (owner decision, 5 October 2026). A small canvas engine for Boredroom's AI teammate: her white rounded
 * "screen" face with pill eyes (her own design), eyes projected onto a curved surface so they slide and foreshorten as
 * she looks around, blinking, breathing, a soft glow in the colour of her mood, particles, and a set of expressions.
 *
 * The techniques (eyes on a sphere with yaw and pitch, tweened squash and stretch, frame-rate independent smoothing,
 * particle bursts) follow the MIT-licensed engine of Coucou by Louis Raillé (github.com/Louis-CFM/coucou). Coucou's
 * character, Mochi, its look, expressions as a character, sounds and artwork are not used: its asset licence reserves
 * them. Brenda's shape, palette and expression set are Boredroom's.
 */

export type BrendaState =
  | "idle" | "listening" | "thinking" | "working" | "happy" | "alert" | "question"
  | "error" | "sleeping" | "dizzy" | "love" | "proud";
export type BrendaEmote = "love" | "wink" | "proud" | "surprised" | "yawn" | "happy" | "annoyed" | "celebrate";
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
  listening: { eye: "wide",   glow: "#ff6c02", tint: 0.18, breathes: true },
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

const INK = "#14151c";
const EYE_W = 0.24, EYE_H = 0.3, EYE_SPREAD = 0.4, EYE_PITCH = -0.06;
const FACE_TOP: RGB = [1, 1, 1];
const FACE_BOTTOM: RGB = [0.9, 0.886, 0.87];
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
  // Where she looks (-1 to 1), set from the pointer
  lookX = 0; lookY = 0;
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
    let ty = this.lookX * 0.6, tp = this.lookY * 0.45;
    if (this.cfg.look) { ty = ty * 0.3 + this.cfg.look[0] * 0.6; tp = tp * 0.3 + this.cfg.look[1] * 0.5; }
    if (this.cfg.scans) { ty = Math.sin(t * 2.4) * 0.6; tp = -0.05; }
    if (this.state === "sleeping") { ty = 0; tp = -0.12; }
    if (this.state === "dizzy") ty = Math.sin(t * 9) * 0.25;
    const k = (base: number) => 1 - Math.pow(base, dt);
    this.yaw += (ty - this.yaw) * k(0.0025);
    this.pitch += (tp - this.pitch) * k(0.0025);
    if (!this.tweens.has("tilt")) this.tilt += ((this.cfg.tilt ?? 0) + (this.state === "dizzy" ? Math.sin(t * 7) * 0.12 : 0) - this.tilt) * k(0.001);
    if (!this.tweens.has("oy")) this.oy += ((this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0) - this.oy) * k(0.0008);
    if (!this.tweens.has("sy") && !this.tweens.has("sx")) {
      const amp = this.cfg.breathes ? 0.03 : 0;
      this.sy += (1 + Math.sin(t * 1.8) * amp - this.sy) * k(0.001);
      this.sx += (1 - Math.sin(t * 1.8) * amp * 0.55 - this.sx) * k(0.001);
    }
    this.eyeScale += (this.eyeScaleTarget - this.eyeScale) * k(0.002);
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
    const R = Math.min(W / 1.9, H / 1.6) * 0.62;   // face width is about 1.4 R
    const fw = R * 1.4, fh = R * 1.04, fr = R * 0.36;
    const cx = W / 2 + this.ox * R, cy = H / 2 + this.oy * R + R * 0.04;

    // The mood light beneath her.
    const g = x.createRadialGradient(cx, cy + fh * 0.42, R * 0.1, cx, cy + fh * 0.42, R * 1.35);
    g.addColorStop(0, rgba(this.glow, 0.42)); g.addColorStop(1, rgba(this.glow, 0));
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    x.save();
    x.translate(cx, cy);
    x.rotate(this.tilt);
    x.scale(this.sx, this.sy);

    const face = new Path2D(); roundRect(face, -fw / 2, -fh / 2, fw, fh, fr);
    // Soft glow around the rim.
    x.save(); x.shadowColor = rgba(this.glow, 0.55); x.shadowBlur = R * 0.35; x.fillStyle = "#fff"; x.fill(face); x.restore();
    // Face: warm white, a mood tint rising from the bottom, shade at the edges, a highlight up and to the right.
    const fg = x.createLinearGradient(fw * 0.4, -fh * 0.6, -fw * 0.4, fh * 0.6);
    fg.addColorStop(0, rgba(FACE_TOP)); fg.addColorStop(1, rgba(FACE_BOTTOM));
    x.fillStyle = fg; x.fill(face);
    if (this.tint > 0.01) {
      const tg = x.createLinearGradient(0, fh / 2, 0, -fh / 2);
      tg.addColorStop(0, rgba(this.glow, 0.7 * this.tint)); tg.addColorStop(0.75, rgba(this.glow, 0));
      x.fillStyle = tg; x.fill(face);
    }
    const sh = x.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.05);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.7, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(20,20,40,0.16)");
    x.fillStyle = sh; x.fill(face);
    const hl = x.createRadialGradient(fw * 0.26, -fh * 0.3, 0, fw * 0.26, -fh * 0.3, R * 0.55);
    hl.addColorStop(0, "rgba(255,255,255,0.75)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hl; x.fill(face);
    x.lineWidth = Math.max(1, R * 0.02); x.strokeStyle = "rgba(20,24,40,0.08)"; x.stroke(face);

    // Eyes on a curved surface: yaw and pitch move them across the face, foreshortened near the edges.
    const shape = this.override ?? this.cfg.eye;
    x.save(); x.clip(face);
    x.fillStyle = INK; x.strokeStyle = INK;
    const rx = fw * 0.5, ry = fh * 0.5;
    for (const sd of [-1, 1]) {
      const eyeYaw = sd * EYE_SPREAD + this.yaw;
      let eyePitch = EYE_PITCH + this.pitch + this.roll;
      eyePitch = ((((eyePitch + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      const cp = Math.cos(eyePitch);
      if (Math.cos(eyeYaw) * cp <= 0.05) continue;
      const ex = Math.sin(eyeYaw) * cp * rx * 1.05;
      const ey = -Math.sin(eyePitch) * ry * 1.1;
      x.save();
      x.translate(ex, ey);
      x.scale(Math.max(0.2, Math.cos(eyeYaw)), Math.max(0.2, cp));
      this.eye(x, shape, R * EYE_W * this.eyeScale, R * EYE_H * this.eyeScale, sd);
      x.restore();
    }
    x.restore();
    x.restore();

    this.drawParticles(x, R, cx, cy);
  }

  private eye(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number): void {
    const t = nowS();
    switch (shape) {
      case "wide": return this.eye(x, "pill", w * 1.14, h * 1.12, sd);
      case "pill": { const hh = Math.max(h * this.open, w * 0.28); x.beginPath(); roundRect(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); x.fill(); return; }
      case "dot": x.beginPath(); x.arc(0, 0, w * 0.42, 0, Math.PI * 2); x.fill(); return;
      case "line": x.rotate(-sd * 0.25); x.beginPath(); roundRect(x, -w * 0.8, -w * 0.2, w * 1.6, w * 0.4, w * 0.2); x.fill(); return;
      case "flat": x.beginPath(); roundRect(x, -w * 0.72, -w * 0.18, w * 1.44, w * 0.36, w * 0.18); x.fill(); return;
      case "happy": x.lineWidth = w * 0.48; x.lineCap = "round"; x.beginPath(); x.arc(0, h * 0.2, w * 0.8, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); return;
      case "closed": x.lineWidth = w * 0.34; x.lineCap = "round"; x.beginPath(); x.arc(0, -h * 0.08, w * 0.76, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); return;
      case "tired": x.beginPath(); roundRect(x, -w / 2, -h * 0.02, w, h * 0.36, w / 2); x.fill(); x.beginPath(); roundRect(x, -w * 0.62, -h * 0.1, w * 1.24, w * 0.2, w * 0.1); x.fill(); return;
      case "wink": if (sd < 0) return this.eye(x, "pill", w, h, sd); return this.eye(x, "happy", w, h, sd);
      case "spiral": {
        x.lineWidth = w * 0.2; x.lineCap = "round"; x.beginPath();
        for (let a = 0; a < 4.4 * Math.PI; a += 0.2) { const r = w * 0.06 + a * w * 0.056; const aa = a + t * 9 * sd; const px = Math.cos(aa) * r, py = Math.sin(aa) * r; if (a === 0) x.moveTo(px, py); else x.lineTo(px, py); }
        x.stroke(); return;
      }
      case "heart": x.fillStyle = "#ff4d6d"; x.scale(1 + Math.sin(t * 9) * 0.08, 1 + Math.sin(t * 9) * 0.08); heart(x, w * 1.25); x.fill(); x.fillStyle = INK; return;
      case "star": x.fillStyle = "#f7b32b"; x.rotate(t * 1.5 * sd); star(x, w * 1.05, w * 0.46); x.fill(); x.fillStyle = INK; return;
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
