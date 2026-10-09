/**
 * Brenda, drawn (owner decision, 5 October 2026). A small canvas engine for Boredroom's AI teammate. Her shape (owner
 * design, 7 October 2026, from the owner's artwork): a white ball with a black bean-shaped visor and two white pill
 * eyes glowing behind it. The visor turns with her head, sliding across the ball and foreshortening as she looks
 * around (and going round the back when she spins); the eyes sit a little deeper and move a little further. She blinks,
 * breathes, has a soft glow and rim light in the colour of her mood (which also tints her eyes), particles, and a set
 * of expressions.
 *
 * Her coat (owner decision, 8 October 2026: "go with the fluffy shaggy one", chosen from glossy, short plush, shaggy
 * and fine fuzz previews): fluffy, shaggy white fur instead of the gloss. Her coat is soft, loosely scattered locks
 * that flow out from her face, a touch greyer at the root and white at the tip, under the same upper-left light, as
 * bright as the glossy sphere; a ring of longer tufts round her middle and bottom makes a cloud-like silhouette (kept
 * short on top so she has room to hop), with a small cowlick. The visor stays black glass, set into a soft shaded
 * hollow in the fur with fur all round it, and nothing ever covers it. The tufts have springy secondary motion: they
 * lag, swing and overshoot when she hops, squashes, tilts or turns, and drift slightly at rest. The coat is laid out
 * once from a seeded generator and baked into offscreen canvases for a short ladder of sizes, a few steps per frame (at
 * once for a still frame), so a frame only stamps sprites. At chat and list sizes she is a soft round ball with a fine
 * fuzzy edge.
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
 *
 * Personal assistants (owner decision, 7 October 2026): each person draws their own assistant, so the engine takes a
 * look (`new BrendaEngine(look)`, `setLook()`): the coat's colour from the curated palette, the visor's shape and the
 * eyes' style, all from lib/assistant-look. Brenda's look (white, the bean visor, pill eyes) is the default and draws
 * exactly as the owner's fur design. Every assistant wears the same fluffy shaggy coat (merge of the coat with personal
 * assistants, 8 October 2026): the coat is baked once per size in neutral white and tinted per colour by multiplying it
 * with the colour's middle tone (cheap, once per size and colour, cached), so the roots stay a touch darker than the tips
 * in every colour; the shading towards her rim takes the colour's rim tone. Every visor sits in its own shaded hollow
 * with a fringe of short fur round it, baked per size and visor on first use. The visor stays near-black and the eyes
 * white whatever the colour; her mood light, rim light and eye tint stay the colour of her mood, and every expression is
 * drawn the same for every eye style.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): she speaks her replies, and she has no mouth, so `talk` (the
 * speech level, 0 to 1, fed each frame by the caller like `voice`; null when she is not speaking) plays a talking
 * overlay on top of whatever mood she is in, never changing `state`: her eyes squash between syllables and open on each
 * one (every eye shape, blinks included), a small bob and sway (which her tufts follow, lagging and settling as they do
 * for a hop), and her glow brightens with the level and turns towards her own colour (her mood's colour returns as she
 * stops). Starting and stopping ease over about 150 ms. Under reduced motion `settle()` makes it a still pose: eyes a
 * little wider, a steady soft glow in her colour.
 */
import {
  DEFAULT_LOOK, isAssistantColour, isAssistantEyes, isAssistantVisor, PALETTE, VISOR_INK,
  type AssistantColour, type AssistantEyes, type AssistantLook, type AssistantVisor,
} from "@/lib/assistant-look";

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
/** The states whose light is her own colour in "own" glow mode (her home): at rest, listening, thinking, working, asleep. */
const RESTING_STATES: ReadonlySet<BrendaState> = new Set<BrendaState>(["idle", "listening", "thinking", "working", "sleeping"]);

// Her look (owner design, 7 October 2026): a white ball with a black bean-shaped visor, two white pill eyes glowing
// behind the glass. Proportions are fractions of the sphere's radius, measured from the owner's artwork. The coat's
// colour comes from the palette (lib/assistant-look); white is the owner's fur as drawn.
const VISOR_W = 0.8, VISOR_TOP = -0.42, VISOR_DIP = -0.28, VISOR_BOTTOM = 0.44;
const VISOR_REACH = 0.62, VISOR_PITCH = Math.asin(0.19 / VISOR_REACH);   // the visor's centre sits 0.19 R above the middle
const EYE_W = 0.15, EYE_H = 0.31, EYE_SPREAD = 0.42, EYE_Y = -0.04;

/** The bean visor, centred on the origin: rounded lobes over each eye, a soft dip between them, a broad curve beneath. */
function beanPath(R: number): Path2D {
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

/**
 * The other visors (personal assistants, 7 October 2026), centred on the same origin and placed the same way, so they
 * turn and foreshorten as hers does and every eye style fits inside each: the band, a wide slim capsule across the face;
 * the screen, a rounded rectangle, taller and narrower. Fractions of R: half-width, top, bottom, corner radius. Both stay
 * inside her fur's fringe box and VISOR_KEEP at rest, as the bean does.
 */
const VISOR_BOXES: Record<Exclude<AssistantVisor, "bean">, [w: number, top: number, bottom: number, r: number]> = {
  band: [0.86, -0.3, 0.3, 0.3],
  screen: [0.66, -0.44, 0.4, 0.24],
};
function visorPath(kind: AssistantVisor, R: number): Path2D {
  if (kind === "bean") return beanPath(R);
  const [w, t, b, r] = VISOR_BOXES[kind];
  const v = new Path2D();
  arcRect(v, -w * R, t * R, w * 2 * R, (b - t) * R, r * R);
  return v;
}

/**
 * The eye styles' neutral shapes (personal assistants, 7 October 2026), as fractions of R: width, height and corner
 * radius (null: fully rounded). Only her resting eyes (and her wide ones, scaled up) take the style; every expression
 * is drawn the same for every style.
 */
const EYE_STYLES: Record<AssistantEyes, [w: number, h: number, r: number | null]> = {
  pill: [EYE_W, EYE_H, null],
  round: [0.22, 0.22, null],
  square: [0.2, 0.2, 0.05],
};
const SPARK = ["#ff6c02", "#ff3d81", "#7c5cff", "#ffc857"];
/** Talking (her voice, 7 October 2026): how long she takes to start and stop, and her eyes in the still pose of reduced
 *  motion (a little wider, as the small faces' `scale: 1.04 1.1`). */
const TALK_EASE_S = 0.15;
const TALK_STILL: [sx: number, sy: number] = [1.04, 1.1];

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
/** A rectangle with true circular corners (the visors and the round and square eyes). */
function arcRect(p: CanvasRenderingContext2D | Path2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r);
  p.closePath();
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

// ---- Her coat -------------------------------------------------------------------------------------------------------
// Everything here is drawn in units of her radius R. It is baked per size (a rung of a short ladder of radii in device
// pixels) into offscreen canvases: the coat (locks of fur flowing out from her face), an atlas of tuft sprites (the
// shaggy ring round her silhouette, and the cowlick), the fringe (short fur round the visor) and the hollow (the shade
// the visor sits in); at the smallest sizes a single ring sprite (a fine fuzzy edge) stands in for the tufts. A frame
// fills a circle with the coat, feathers its edge, stamps the tufts with their sway, and lights the lot.

const COAT_EXT = 1.2;                                   // the coat covers ±1.2 R, so it can slide a little as she turns
const COAT_SLIDE = 0.19;                                // and slides at most this far (in R) each way
const CELL_X0 = -0.72, CELL_Y0 = -1.28, CELL_W = 1.44, CELL_H = 1.5;   // a tuft sprite's box, in tuft lengths
const TUFT_BAKE = 0.42;                                 // tuft sprites are baked for a tuft this long (in R)
const TUFT_REACH = 1.1;                                 // how far a tuft's tip reaches, in tuft lengths
const FRINGE_X0 = -1, FRINGE_Y0 = -0.66, FRINGE_W = 2, FRINGE_H = 1.32;
const RING_EXT = 1.2;                                   // the small sizes' ring sprite covers ±1.2 R
const TUFT_KINDS = 6;
const CREST = TUFT_KINDS;                               // the cowlick's column in the atlas
const CROWN_Y = -0.19;                                  // her fur flows out from her face (the visor's centre)
const UNDERPAINT = "#f1f2f5";
/** The bean's outline on its far side (x > 0, in R, about its centre): its widest point, shoulder, lobe and lower curve. */
const BEAN_EDGE: [x: number, y: number][] = [[0.8, -0.02], [0.69, -0.354], [0.4, -0.42], [0.586, 0.352], [0.334, 0.42]];
/** How far from her middle (in R) the glass may reach, so there is always fur between it and her silhouette. */
const VISOR_KEEP = 0.93;
/** Her glow round the fur: alpha (times the glow's strength) at each radius (in R), fading out by 1.32 R. */
const HALO: [r: number, a: number][] = [[0.85, 1], [1, 0.72], [1.1, 0.4], [1.2, 0.14], [1.32, 0]];

/** A seeded generator (mulberry32): her coat is laid out the same way on every frame and every page. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  // Read back after each bake step (so a frame's bake budget counts the real drawing), hence willReadFrequently.
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("Brenda: no 2D canvas");
  return [c, g];
}

type Tone = [r: number, g: number, b: number];
type LockInk = { root: Tone; tip: Tone };
// Neutral, bright greys (her body is white): the root only a touch darker than the tip.
const INK_FRONT: LockInk = { root: [238, 240, 244], tip: [255, 255, 255] };
const INK_FRINGE: LockInk = { root: [208, 210, 217], tip: [246, 247, 250] };
// The band's longer locks over her crown: the coat's, with a root a shade greyer, so they read as strands on the coat.
const INK_CROWN: LockInk = { root: [222, 224, 230], tip: [255, 255, 255] };
const tone = (c: Tone, k: number, a: number) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;
const smooth = (e0: number, e1: number, v: number) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** One lock of fur's outline: its root at the origin, pointing up (to -y), its tip `bend` to one side, `round` (0 to 1) blunt. */
function lockPath(len: number, wid: number, bend: number, round = 0.5): Path2D {
  const hw = wid / 2, p = new Path2D();
  p.moveTo(bend, -len);
  p.bezierCurveTo(bend + hw * round, -len * (0.8 + round * 0.2), hw, -len * 0.72, hw, -len * 0.4);
  p.bezierCurveTo(hw, len * 0.08, -hw, len * 0.08, -hw, -len * 0.4);
  p.bezierCurveTo(-hw, -len * 0.72, bend - hw * round, -len * (0.8 + round * 0.2), bend, -len);
  p.closePath();
  return p;
}

/**
 * Paints a lock as a bundle of fibres `fw` wide over a soft body (so the bundle never shows through): rooted across its
 * base, gathering into a rounded clump at its tip, fading in at the root and out at the tip, a touch greyer at the root.
 * The fibres go down as two strokes (a few are darker, for texture), each with one gradient along the lock, so a bake
 * stays quick. `stray` is the share that wander off; with no fibres (`fw` 0) the soft body alone is the lock. The coat's
 * locks go without the body (`soft` false): its underpaint already fills between their fibres.
 */
function paintLock(g: CanvasRenderingContext2D, len: number, wid: number, bend: number, ink: LockInk, fw: number, rnd: () => number,
  spread = 0.4, stray = 0.1, alpha = 1, soft = true) {
  if (soft) {
    g.save(); g.translate(bend * 0.3, -len * 0.42); g.scale(wid * 0.48, len * 0.52);
    const mid: Tone = [(ink.root[0] + ink.tip[0]) / 2, (ink.root[1] + ink.tip[1]) / 2, (ink.root[2] + ink.tip[2]) / 2];
    const body = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    body.addColorStop(0, tone(mid, 1, 0.95 * alpha)); body.addColorStop(0.65, tone(mid, 1, 0.7 * alpha)); body.addColorStop(1, tone(mid, 1, 0));
    g.fillStyle = body; g.fillRect(-1, -1, 2, 2);
    g.restore();
  }
  if (!fw) return;
  const n = Math.max(4, Math.min(18, Math.round(wid / fw)));
  const main = new Path2D(), dark = new Path2D();
  for (let i = 0; i < n; i++) {
    const f = (i + rnd()) / n - 0.5;                                  // across the lock, -0.5 to 0.5
    const x0 = f * wid * 0.78, y0 = len * (0.04 - rnd() * 0.3);       // rooted across its base, some further up
    const wild = rnd() < stray;                                       // a few wander off: the fluff
    const reach = (0.9 + rnd() * 0.14 - Math.abs(f) * 0.28) * (wild ? 1.04 : 1);   // the middle fibres make the tip
    const x1 = bend * reach + f * wid * spread + (rnd() - 0.5) * wid * (wild ? 0.7 : 0.1), y1 = -len * reach;
    const mx = (x0 + x1) / 2 + f * wid * 0.22 + bend * 0.15 + (wild ? (rnd() - 0.5) * wid * 0.4 : 0);
    const p = rnd() < 0.14 ? dark : main;
    p.moveTo(x0, y0); p.quadraticCurveTo(mx, (y0 + y1) / 2, x1, y1);
  }
  g.lineCap = "round";
  for (const [p, k, w] of [[main, 1, 1], [dark, 0.95, 0.85]] as const) {
    const sg = g.createLinearGradient(0, len * 0.04, bend, -len);
    sg.addColorStop(0, tone(ink.root, k, 0)); sg.addColorStop(0.2, tone(ink.root, k, 0.9 * alpha));
    sg.addColorStop(0.7, tone(ink.tip, k, 0.9 * alpha)); sg.addColorStop(1, tone(ink.tip, k, 0));
    g.strokeStyle = sg; g.lineWidth = fw * w; g.stroke(p);
  }
}

/**
 * How wide a fibre is (in R) at a size: fine enough to read as fur, never under a device pixel. At the smallest sizes
 * the coat has none, only a soft underpaint and the fine wisps of its ring.
 */
const fibreWidth = (rpx: number, lod: number) => lod === 2 ? Math.max(0.0075, 0.9 / rpx) : lod === 1 ? Math.max(0.012, 1 / rpx) : 1 / rpx;

/** Points at least `r` apart, scattered at random over a square of ±`ext` (Bridson's Poisson-disc sampling). */
function scatter(rnd: () => number, ext: number, r: number): [number, number][] {
  const cell = r / Math.SQRT2, n = Math.ceil((2 * ext) / cell);
  const grid = new Int32Array(n * n).fill(-1);
  const pts: [number, number][] = [], active: number[] = [];
  const put = (x: number, y: number) => {
    grid[Math.min(n - 1, Math.floor((y + ext) / cell)) * n + Math.min(n - 1, Math.floor((x + ext) / cell))] = pts.length;
    active.push(pts.length); pts.push([x, y]);
  };
  put((rnd() - 0.5) * r, (rnd() - 0.5) * r);
  while (active.length) {
    const ai = Math.floor(rnd() * active.length), [px, py] = pts[active[ai]];
    let found = false;
    for (let k = 0; k < 24 && !found; k++) {
      const a = rnd() * Math.PI * 2, d = r * (1 + rnd());
      const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      if (x < -ext || x >= ext || y < -ext || y >= ext) continue;
      const gx = Math.floor((x + ext) / cell), gy = Math.floor((y + ext) / cell);
      let ok = true;
      for (let yy = Math.max(0, gy - 2); ok && yy <= Math.min(n - 1, gy + 2); yy++) {
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(n - 1, gx + 2); xx++) {
          const j = grid[yy * n + xx];
          if (j >= 0 && (pts[j][0] - x) ** 2 + (pts[j][1] - y) ** 2 < r * r) { ok = false; break; }
        }
      }
      if (ok) { put(x, y); found = true; }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}

/** A lock of her coat: where it grows (in R), which way it lies, its size, and whether it is a loose bit of fluff. */
type CoatLock = { x: number; y: number; a: number; len: number; wid: number; bend: number; fluff: boolean };

/**
 * Her coat's locks, scattered (no rows), each lying away from her face and drooping a little, varied in length and
 * angle; near her face (the middle, seen when she spins) they fall downwards rather than radiating from a point. Painted
 * roughly outermost first so tips overlap roots, then a pass of loose fluff over the lot.
 */
function layCoat(lod: number): CoatLock[] {
  const rnd = seeded(0x5eed + lod * 7919);
  const gs = lod === 2 ? 0.125 : 0.17;
  const flow = (x: number, y: number) => {
    const dx = x, dy = y - CROWN_Y, d = Math.hypot(dx, dy) || 1e-3, w = smooth(0.05, 0.5, d);
    return Math.atan2(dx / d * w, -(dy / d * w + (1 - w) + 0.35));
  };
  const locks: (CoatLock & { o: number })[] = scatter(rnd, COAT_EXT + 0.05, gs).map(([x, y]) => {
    const r = Math.hypot(x, y), len = gs * (1.9 + 0.6 * Math.min(1, r)) * (0.6 + rnd() * 0.8);
    return {
      x, y, a: flow(x, y) + (rnd() - 0.5) * 1.2, len, wid: gs * (1.5 + rnd() * 0.5), bend: (rnd() - 0.5) * 0.5 * len, fluff: false,
      o: Math.hypot(x, y - CROWN_Y) + (rnd() - 0.5) * 0.35,
    };
  });
  locks.sort((p, q) => q.o - p.o);
  // Loose fluff on top, lying every which way, so no row of locks survives.
  for (let i = 0, n = lod === 2 ? 56 : 34; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 1.15, x = Math.cos(a) * r, y = Math.sin(a) * r, len = gs * (1 + rnd() * 0.7);
    locks.push({ x, y, a: flow(x, y) + (rnd() - 0.5) * 2.4, len, wid: gs * (1 + rnd() * 0.4), bend: (rnd() - 0.5) * 0.6 * len, fluff: true, o: 0 });
  }
  return locks;
}

function paintCoatLock(g: CanvasRenderingContext2D, k: CoatLock, fw: number, rnd: () => number) {
  g.save(); g.translate(k.x, k.y); g.rotate(k.a);
  paintLock(g, k.len, k.wid, k.bend, INK_FRONT, fw, rnd, 0.42, 0.1, k.fluff ? 0.8 : 1, false);
  g.restore();
}

/**
 * One shaggy tuft in its atlas cell: a long lock with smaller ones splaying from it, gathered into soft clumps. Or the
 * cowlick: a lock that rises and leans over to one side in a gentle curve.
 */
function bakeTuft(g: CanvasRenderingContext2D, crest: boolean, ink: LockInk, fw: number, shade: number, unit: number, rnd: () => number) {
  type Lock = [x: number, y: number, a: number, len: number, wid: number, bend: number];
  const locks: Lock[] = crest
    ? [[-0.05, -0.12, -0.34, 0.5, 0.36, -0.04], [0, 0, 0.08, 0.86, 0.5, 0.24], [0.06, -0.4, 0.42, 0.5, 0.34, 0.14]]
    : [
      ...[-1, 1].map((s): Lock => [s * 0.1, -0.18 - rnd() * 0.2, s * (0.35 + rnd() * 0.25), 0.55 + rnd() * 0.15, 0.42 + rnd() * 0.08, s * 0.06]),
      [0, 0, 0, 1, 0.68 + rnd() * 0.14, (rnd() - 0.5) * 0.3],
    ];
  // The soft shadow the tuft throws on the coat, towards her middle (the sprite's root is at the bottom). Only the
  // shadow is wanted, so the shape is drawn far to the left and its shadow brought back.
  g.save();
  g.shadowColor = `rgba(56,58,68,${shade})`; g.shadowBlur = 0.2 * unit; g.shadowOffsetX = 50 * unit; g.shadowOffsetY = 0.12 * unit;
  g.translate(-50, 0); g.fillStyle = "#000"; g.fill(lockPath(0.8, crest ? 0.55 : 0.9, 0));
  g.restore();
  for (const [x, y, a, len, wid, bend] of locks) {
    g.save(); g.translate(x, y); g.rotate(a); paintLock(g, len, wid, bend, ink, fw, rnd, 0.28, 0.06); g.restore();
  }
  // Fade the root into the coat.
  g.globalCompositeOperation = "destination-out";
  const fade = g.createLinearGradient(0, CELL_Y0 + CELL_H, 0, -0.45);
  fade.addColorStop(0, "rgba(0,0,0,1)"); fade.addColorStop(0.35, "rgba(0,0,0,0.75)"); fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade; g.fillRect(CELL_X0, -0.45, CELL_W, CELL_Y0 + CELL_H + 0.45);
  g.globalCompositeOperation = "source-over";
}

/** Points round a visor's outline (in R), with their outward normals: where the fur meets the glass. */
function visorOutline(kind: AssistantVisor, perSeg: number): [x: number, y: number, nx: number, ny: number][] {
  if (kind !== "bean") return boxOutline(VISOR_BOXES[kind], perSeg * 6);
  const a = VISOR_W, t = VISOR_TOP, d = VISOR_DIP, b = VISOR_BOTTOM, m = -0.02;
  const segs: number[][] = [
    [-a, m, -a, t * 0.9, -a * 0.8, t, -a * 0.5, t],
    [-a * 0.5, t, -a * 0.28, t, -a * 0.16, d, 0, d],
    [0, d, a * 0.16, d, a * 0.28, t, a * 0.5, t],
    [a * 0.5, t, a * 0.8, t, a, t * 0.9, a, m],
    [a, m, a, b * 0.8, a * 0.62, b, 0, b],
    [0, b, -a * 0.62, b, -a, b * 0.8, -a, m],
  ];
  const out: [number, number, number, number][] = [];
  for (const [x0, y0, x1, y1, x2, y2, x3, y3] of segs) {
    for (let i = 0; i < perSeg; i++) {
      const u = (i + 0.5) / perSeg, v = 1 - u;
      const px = v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3;
      const py = v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3;
      const tx = 3 * v * v * (x1 - x0) + 6 * v * u * (x2 - x1) + 3 * u * u * (x3 - x2);
      const ty = 3 * v * v * (y1 - y0) + 6 * v * u * (y2 - y1) + 3 * u * u * (y3 - y2);
      const l = Math.hypot(tx, ty) || 1;
      out.push([px, py, ty / l, -tx / l]);
    }
  }
  return out;
}

/**
 * `n` points evenly spaced round a band or screen visor's rounded rectangle (clockwise from the top left, as the bean's
 * outline runs), with their outward normals. A capsule's straight sides have no length and get no points.
 */
function boxOutline([w, t, b, r]: [number, number, number, number], n: number): [x: number, y: number, nx: number, ny: number][] {
  r = Math.min(r, w, (b - t) / 2);
  const sx = 2 * (w - r), sy = (b - t) - 2 * r, arc = (Math.PI / 2) * r;
  // The perimeter as runs: straight [length, x0, y0, dx, dy, nx, ny] or a quarter arc [length, cx, cy, a0].
  type Run = { len: number; at: (u: number) => [number, number, number, number] };
  const line = (len: number, x0: number, y0: number, dx: number, dy: number, nx: number, ny: number): Run =>
    ({ len, at: (u) => [x0 + dx * u * len, y0 + dy * u * len, nx, ny] });
  const quarter = (cx: number, cy: number, a0: number): Run =>
    ({ len: arc, at: (u) => { const a = a0 + u * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); return [cx + c * r, cy + s * r, c, s]; } });
  const runs: Run[] = [
    line(sx, -w + r, t, 1, 0, 0, -1), quarter(w - r, t + r, -Math.PI / 2),
    line(sy, w, t + r, 0, 1, 1, 0), quarter(w - r, b - r, 0),
    line(sx, w - r, b, -1, 0, 0, 1), quarter(-w + r, b - r, Math.PI / 2),
    line(sy, -w, b - r, 0, -1, -1, 0), quarter(-w + r, t + r, Math.PI),
  ].filter((q) => q.len > 1e-6);
  const total = runs.reduce((m, q) => m + q.len, 0), out: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let d = ((i + 0.5) / n) * total, k = 0;
    while (k < runs.length - 1 && d > runs[k].len) d -= runs[k++].len;
    out.push(runs[k].at(Math.min(1, d / runs[k].len)));
  }
  return out;
}

/**
 * Each visor's outline on its far side (x > 0, in R, about its origin), for keeping the glass inside her fur as she
 * turns: the bean's few measured points, the boxes' sampled outline.
 */
const VISOR_EDGES: Record<AssistantVisor, [x: number, y: number][]> = {
  bean: BEAN_EDGE,
  band: boxOutline(VISOR_BOXES.band, 24).filter(([x]) => x > 0.05).map(([x, y]) => [x, y]),
  screen: boxOutline(VISOR_BOXES.screen, 24).filter(([x]) => x > 0.05).map(([x, y]) => [x, y]),
};

/** Short fur round the visor's rim, leaning back from the glass, darker at the root where it dips into the hollow. */
function bakeFringe(g: CanvasRenderingContext2D, lod: number, fw: number, half: number, kind: AssistantVisor) {
  const rnd = seeded(0xf1a9e + lod * 7 + half), pts = visorOutline(kind, lod === 2 ? 16 : 9);
  for (const [x0, y0, nx, ny] of pts.slice(half * (pts.length >> 1), (half + 1) * (pts.length >> 1))) {
    const len = (lod === 2 ? 0.055 : 0.065) * (0.75 + rnd() * 0.5);
    g.save(); g.translate(x0 - nx * 0.012, y0 - ny * 0.012); g.rotate(Math.atan2(nx, -ny) + (rnd() - 0.5) * 0.9);
    paintLock(g, len, len * 1.1, (rnd() - 0.5) * len * 0.5, INK_FRINGE, fw, rnd, 0.4, 0.08, 0.9);
    g.restore();
  }
}

/**
 * The band is slimmer than her crown: the coat's locks part about 0.33 R above the visor's centre (below it they fall
 * towards her face, above it they lie outwards), and the bean and the screen cover that parting where the band leaves it
 * bare, a smooth patch the light falls on. So along the band's top a row of longer locks, in the coat's ink and lying up
 * and out as the coat does there, carries the fur over it. Baked into the band's fringe canvas before its short fur, in
 * two steps (`part` 0 and 1, the left and right halves of the row) so each stays within a frame's bake budget.
 */
function bakeCrown(g: CanvasRenderingContext2D, lod: number, fw: number, part: number) {
  const rnd = seeded(0xc0a7 + lod * 13 + part), [w, t] = VISOR_BOXES.band, n = lod === 2 ? 16 : 11, reach = w - 0.3;
  for (let i = 0; i < n; i++) {
    const x0 = (part ? 1 : -1) * ((i + rnd() * 0.8) / n) * reach;
    const len = (0.2 + rnd() * 0.18) * (1 - Math.abs(x0) * 0.5);
    g.save(); g.translate(x0, t + 0.015); g.rotate(x0 * 0.6 + (rnd() - 0.5) * 1.2);
    paintLock(g, len, len * 0.6, (rnd() - 0.5) * len * 0.4, INK_CROWN, fw, rnd, 0.42, 0.1, 1, false);
    g.restore();
  }
}

/** The hollow the visor sits in: a tight shade all round the glass (the glass itself is cut out; the visor covers it). */
function bakeHollow(g: CanvasRenderingContext2D, rpx: number, kind: AssistantVisor) {
  const v = visorPath(kind, 1);
  g.save(); g.shadowColor = "rgba(40,42,50,0.55)"; g.shadowBlur = 0.06 * rpx; g.shadowOffsetY = 0.02 * rpx;
  g.fillStyle = "#000"; g.fill(v); g.restore();
  g.globalCompositeOperation = "destination-out"; g.fill(v); g.globalCompositeOperation = "source-over";
}

/**
 * The smallest sizes' edge (in place of the tufts, which would only be noise there): a near-round ring of fine wisps
 * and a few soft tufts, one of them the cowlick, over a soft fade. Shorter on top, for room to hop.
 */
function bakeRing(g: CanvasRenderingContext2D, rpx: number) {
  const rnd = seeded(0x41a6), fw = 1 / rpx;
  for (const [a, len] of [[Math.PI * 0.64, 0.24], [Math.PI * 0.33, 0.22], [Math.PI * 1.06, 0.2], [-Math.PI * 0.56, 0.18]]) {
    g.save(); g.translate(Math.cos(a) * 0.82, Math.sin(a) * 0.82); g.rotate(a + Math.PI / 2 + (a < 0 ? 0.35 : 0.12));
    paintLock(g, len, 0.3, len * 0.15, INK_FRONT, fw, rnd, 0.3, 0.04);
    g.restore();
  }
  g.lineCap = "round";
  for (let i = 0, n = 60; i < n; i++) {
    const a = ((i + (rnd() - 0.5) * 0.8) / n) * Math.PI * 2, top = Math.max(0, -Math.sin(a));
    const r0 = 0.86 + rnd() * 0.05, r1 = 1.0 + rnd() * 0.08 - top * 0.05, b = a + (rnd() - 0.5) * 0.12;
    const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0, x1 = Math.cos(b) * r1, y1 = Math.sin(b) * r1;
    const sg = g.createLinearGradient(x0, y0, x1, y1);
    sg.addColorStop(0, tone(INK_FRONT.root, 1, 0)); sg.addColorStop(0.35, tone(INK_FRONT.root, 1, 0.9));
    sg.addColorStop(0.75, tone(INK_FRONT.tip, 1, 0.75)); sg.addColorStop(1, tone(INK_FRONT.tip, 1, 0));
    g.strokeStyle = sg; g.lineWidth = fw * (0.9 + rnd() * 0.4);
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 0.03, (y0 + y1) / 2 + (rnd() - 0.5) * 0.03, x1, y1); g.stroke();
  }
}

/** A tuft round her silhouette: where it grows, how long, and how it moves. */
type Tuft = { a: number; r: number; len: number; wid: number; cell: number; row: number; flex: number; ph: number; w: number };

function layTufts(lod: number): { back: Tuft[]; front: Tuft[]; crest: Tuft[] } {
  const rnd = seeded(0x7a11 + lod * 131);
  const nF = lod === 2 ? 34 : 24, nB = lod === 2 ? 24 : 18;
  const ring = (n: number, row: number, r: number, len: number, off: number): Tuft[] => Array.from({ length: n }, (_, i) => {
    const a = ((i + off + (rnd() - 0.5) * 0.5) / n) * Math.PI * 2;
    // Longer underneath, where the fur hangs, and short on top, so she has room to hop in her canvas.
    const hang = Math.max(0, Math.sin(a)) * 0.05, top = 1 - Math.max(0, -Math.sin(a)) * 0.4;
    return {
      a, r: r + (rnd() - 0.5) * 0.1, len: (len + (rnd() - 0.3) * 0.1 + hang) * top, wid: (0.95 + rnd() * 0.3) / Math.sqrt(top),
      cell: Math.floor(rnd() * TUFT_KINDS), row, flex: 0.8 + rnd() * 0.45, ph: rnd() * Math.PI * 2, w: 0.7 + rnd() * 0.8,
    };
  });
  const back = ring(nB, 1, 0.82, 0.27, 0.5);
  // The front ring is drawn from the bottom up, so each tuft lies over the one below it, as fur hangs.
  const front = ring(nF, 0, 0.78, 0.25, 0).sort((p, q) => Math.sin(q.a) - Math.sin(p.a));
  const crest: Tuft = { a: -Math.PI / 2 - 0.12, r: 0.68, len: 0.38, wid: 1.0, cell: CREST, row: 0, flex: 1.5, ph: 1.3, w: 1.1 };
  return { back, front, crest: [crest] };
}

/** What a visor needs from the fur round it, per size: the fringe of short fur round its rim and its shaded hollow. */
type VisorParts = { fringe: HTMLCanvasElement | null; hollow: HTMLCanvasElement };
type FurKit = {
  rpx: number; lod: number;
  coat: HTMLCanvasElement;
  atlas: HTMLCanvasElement | null; cw: number; ch: number; unit: number;
  ring: HTMLCanvasElement | null;
  /** Each visor's fringe and hollow at this size, baked on first use (the bean's with the coat). */
  visors: Map<AssistantVisor, VisorParts>;
  back: Tuft[]; front: Tuft[]; crest: Tuft[];
  patterns: WeakMap<CanvasRenderingContext2D, CanvasPattern>;
  /** The animation frame it was last drawn in: the cache never evicts a coat drawn this frame. */
  usedAt: number;
  /** A tinted coat (personal assistants): the neutral white kit it was tinted from, and the colour it multiplies by. */
  base: FurKit | null; ink: string | null;
};
type FurJob = { kit: FurKit; steps: [g: CanvasRenderingContext2D, run: () => void][]; next: number };

/**
 * The radii (device pixels) her coat is baked at, about 1.19x apart: every size draws from the next rung up (scaled
 * down a little), so a handful of bakes cover every size and pixel ratio. The app's sizes land on or just under a rung.
 */
const FUR_RUNGS = [12, 15, 18, 22, 26, 31, 37, 44, 52, 62, 74, 88, 104, 124, 146, 170];
const FUR_MAX_KITS = 8;
/** How long she takes to fade in when her first frame had to wait for her coat. */
const APPEAR_MS = 180;
/**
 * Each animation frame's bake stops once this much (ms) has been spent, and no new size's job is set up once it is
 * spent. A step that starts under the budget runs to its end, so a frame can go a step over; the longest step is a
 * detail level's one-time coat layout (several milliseconds, more on a slow machine), which runs whole. A still frame
 * (after settle()) finishes its bake at once.
 */
const BAKE_SLICE_MS = 4;
const furKits = new Map<number, FurKit>();
const furJobs = new Map<number, FurJob>();
let sliceAt = -1e9, sliceSpent = 0;

const rungFor = (rpx: number) => FUR_RUNGS.find((r) => r >= rpx * 0.97) ?? FUR_RUNGS[FUR_RUNGS.length - 1];
/**
 * Detail by size (a rung, in device pixels): many fibrous locks when large; fewer, coarser ones from the orb's size down
 * (her 72px home has tufts at every pixel ratio from 1x up); below about 26 device pixels of radius (a canvas of about
 * 40px at 1x) a soft coat with a ring of fine wisps round her edge, as more would only be noise.
 */
const lodFor = (rung: number) => (rung >= 80 ? 2 : rung >= 28 ? 1 : 0);
// The coat's locks and the tufts are laid out from a seed per detail level and never changed, so each level's layout is
// worked out once and shared by every rung at that level.
const coatLayouts = new Map<number, CoatLock[]>();
const tuftLayouts = new Map<number, { back: Tuft[]; front: Tuft[]; crest: Tuft[] }>();
const coatFor = (lod: number) => { let c = coatLayouts.get(lod); if (!c) { c = layCoat(lod); coatLayouts.set(lod, c); } return c; };
const tuftsFor = (lod: number) => { let t = tuftLayouts.get(lod); if (!t) { t = layTufts(lod); tuftLayouts.set(lod, t); } return t; };

/** Sets up the bake of a rung's kit as a list of small steps (each a millisecond or two). */
function startJob(rpx: number): FurJob {
  const lod = lodFor(rpx);
  const steps: [CanvasRenderingContext2D, () => void][] = [];
  const [coat, cg] = canvas2d(2 * COAT_EXT * rpx, 2 * COAT_EXT * rpx);
  cg.translate(coat.width / 2, coat.height / 2); cg.scale(rpx, rpx);
  steps.push([cg, () => { cg.fillStyle = UNDERPAINT; cg.fillRect(-COAT_EXT - 0.1, -COAT_EXT - 0.1, COAT_EXT * 2 + 0.2, COAT_EXT * 2 + 0.2); }]);
  const [hollow, hg] = canvas2d(FRINGE_W * rpx, FRINGE_H * rpx);
  hg.translate(-FRINGE_X0 * rpx, -FRINGE_Y0 * rpx); hg.scale(rpx, rpx);
  steps.push([hg, () => bakeHollow(hg, rpx, "bean")]);
  const bean: VisorParts = { fringe: null, hollow };
  const kit: FurKit = {
    rpx, lod, coat, atlas: null, cw: 0, ch: 0, unit: 0, ring: null, visors: new Map([["bean", bean]]),
    back: [], front: [], crest: [], patterns: new WeakMap(), usedAt: -1, base: null, ink: null,
  };
  if (lod === 0) {
    const [ring, rg] = canvas2d(2 * RING_EXT * rpx, 2 * RING_EXT * rpx);
    rg.translate(ring.width / 2, ring.height / 2); rg.scale(rpx, rpx);
    steps.push([rg, () => bakeRing(rg, rpx)]);
    kit.ring = ring;
    return { kit, steps, next: 0 };
  }
  const frnd = seeded(0xf1b2e + lod), fw = fibreWidth(rpx, lod);
  // The coat's layout is a step of its own (the first time at a detail level it is the longest single step, so it gets
  // a frame's budget to itself where it can), and queues the painting of its locks, ten at a time, straight after it.
  const paintAt = steps.length + 1;
  steps.push([cg, () => {
    const locks = coatFor(lod), chunks: [CanvasRenderingContext2D, () => void][] = [];
    for (let i = 0; i < locks.length; i += 10) {
      const chunk = locks.slice(i, i + 10);
      chunks.push([cg, () => { for (const k of chunk) paintCoatLock(cg, k, fw, frnd); }]);
    }
    steps.splice(paintAt, 0, ...chunks);
  }]);
  const unit = TUFT_BAKE * rpx, cw = Math.ceil(CELL_W * unit), ch = Math.ceil(CELL_H * unit);
  const [atlas, ag] = canvas2d(cw * (TUFT_KINDS + 1), ch * 2);
  for (let v = 0; v <= TUFT_KINDS; v++) {
    steps.push([ag, () => {
      const rnd = seeded(0x7f4a7c15 + v * 977 + lod * 31);
      ag.save();
      ag.translate(v * cw, 0); ag.beginPath(); ag.rect(2, 2, cw - 4, ch - 4); ag.clip();   // a clear gutter, so no cell bleeds into the next
      ag.translate(-CELL_X0 * unit, -CELL_Y0 * unit); ag.scale(unit, unit);
      bakeTuft(ag, v === CREST, INK_FRONT, fw / TUFT_BAKE, v === CREST ? 0.06 : 0.1, unit, rnd);
      ag.restore();
    }]);
  }
  // The back row: the same tufts a shade dimmer (they sit behind her coat), copied rather than painted again.
  steps.push([ag, () => {
    ag.drawImage(atlas, 0, 0, atlas.width, ch, 0, ch, atlas.width, ch);
    ag.globalCompositeOperation = "source-atop"; ag.fillStyle = "rgba(30,32,40,0.065)"; ag.fillRect(0, ch, atlas.width, ch);
    ag.globalCompositeOperation = "source-over";
  }]);
  const [fringe, fg] = canvas2d(FRINGE_W * rpx, FRINGE_H * rpx);
  fg.translate(-FRINGE_X0 * rpx, -FRINGE_Y0 * rpx); fg.scale(rpx, rpx);
  for (const half of [0, 1]) steps.push([fg, () => bakeFringe(fg, lod, fw, half, "bean")]);
  bean.fringe = fringe;
  Object.assign(kit, { atlas, cw, ch, unit });
  steps.push([ag, () => { Object.assign(kit, tuftsFor(lod)); }]);
  return { kit, steps, next: 0 };
}

/**
 * Her coat for a radius in device pixels (never baked at module load: this file is server-rendered too), shared by
 * every Brenda that size. A bake is spread over frames, a few milliseconds a frame, and the kit is returned once it is
 * done (null until then); `now` finishes it at once, for a still frame. The cache keeps the most recently used kits.
 */
function furKit(rpxIn: number, now: boolean): FurKit | null {
  const rpx = rungFor(rpxIn);
  const t0 = performance.now();
  // One budget per animation frame: every requestAnimationFrame callback in a frame sees the same timeline time (where
  // there is no document timeline, 16 ms buckets of the clock stand in for frames). Kept current on every call, as the
  // frame a coat was last drawn in is what protects it from eviction.
  const tl = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  const frame = tl != null ? Number(tl) : Math.floor(t0 / 16);
  if (frame !== sliceAt) { sliceAt = frame; sliceSpent = 0; }
  const hit = furKits.get(rpx);
  if (hit) { furKits.delete(rpx); furKits.set(rpx, hit); return hit; }
  let job = furJobs.get(rpx);
  if (!job) {
    if (!now && sliceSpent >= BAKE_SLICE_MS) return null;
    job = startJob(rpx); furJobs.set(rpx, job);
  }
  while (job.next < job.steps.length && (now || sliceSpent + performance.now() - t0 < BAKE_SLICE_MS)) {
    const [g, run] = job.steps[job.next++];
    run();
    if (!now) g.getImageData(0, 0, 1, 1);         // draw it now, so the time it takes counts against this frame
  }
  sliceSpent += performance.now() - t0;
  if (job.next < job.steps.length) return null;
  furJobs.delete(rpx);
  furKits.set(rpx, job.kit);
  // Over the limit, drop the least recently used coat that was not drawn this frame (with more sizes on screen than
  // the limit, the cache grows instead of evicting a coat in use and baking it again every frame).
  if (furKits.size > FUR_MAX_KITS) {
    for (const [r, k] of furKits) if (k.usedAt !== sliceAt && k !== job.kit) { furKits.delete(r); dropTints(k); break; }
  }
  return job.kit;
}

/**
 * A visor's bake for a neutral kit, in steps as a coat's is: the hollow, the band's crown row, then each half of the fringe.
 * `hollowDone` says the hollow can be drawn while the fringe is still to come.
 */
type VisorJob = { parts: VisorParts; steps: [g: CanvasRenderingContext2D, run: () => void][]; next: number; hollowDone: boolean };
const visorJobs = new WeakMap<FurKit, Map<AssistantVisor, VisorJob>>();
/** How long a visor bake step has been taking lately (ms), to judge whether another fits in a frame. */
let visorStepMs = 2;

function startVisorJob(kit: FurKit, kind: AssistantVisor): VisorJob {
  const rpx = kit.rpx;
  const [hollow, hg] = canvas2d(FRINGE_W * rpx, FRINGE_H * rpx);
  hg.translate(-FRINGE_X0 * rpx, -FRINGE_Y0 * rpx); hg.scale(rpx, rpx);
  const job: VisorJob = { parts: { fringe: null, hollow }, steps: [], next: 0, hollowDone: false };
  job.steps.push([hg, () => { bakeHollow(hg, rpx, kind); job.hollowDone = true; }]);
  if (kit.lod > 0) {
    const [fc, fg] = canvas2d(FRINGE_W * rpx, FRINGE_H * rpx);
    fg.translate(-FRINGE_X0 * rpx, -FRINGE_Y0 * rpx); fg.scale(rpx, rpx);
    const fw = fibreWidth(rpx, kit.lod);
    if (kind === "band") for (const part of [0, 1]) job.steps.push([fg, () => bakeCrown(fg, kit.lod, fw, part)]);
    for (const half of [0, 1]) job.steps.push([fg, () => bakeFringe(fg, kit.lod, fw, half, kind)]);
    job.parts.fringe = fc;                       // only handed out once every step has run
  }
  return job;
}

/**
 * A visor's fringe and hollow for a neutral kit, baked on its first use at that size (the bean's come with the coat).
 * The bake is spread over frames within the frame's budget, a step at a time (null until it is done; at once for a
 * still frame), so trying a new visor never costs a frame several milliseconds.
 */
function visorParts(kit: FurKit, kind: AssistantVisor, now: boolean): VisorParts | null {
  const have = kit.visors.get(kind);
  if (have) return have;
  let jobs = visorJobs.get(kit);
  if (!jobs) { jobs = new Map(); visorJobs.set(kit, jobs); }
  let job = jobs.get(kind);
  if (!job) {
    if (!now && sliceSpent >= BAKE_SLICE_MS) return null;
    job = startVisorJob(kit, kind); jobs.set(kind, job);
  }
  // A step runs if the frame has budget left; after the first, only if a step as long as the recent ones would still
  // fit, so a frame does not go a whole step over (the visor's steps are of a size: a millisecond or two, more when slow).
  const t0 = performance.now();
  let ran = false;
  while (job.next < job.steps.length) {
    const spent = sliceSpent + performance.now() - t0;
    if (!now && (spent >= BAKE_SLICE_MS || (ran && spent + visorStepMs > BAKE_SLICE_MS))) break;
    const [g, run] = job.steps[job.next++], a = performance.now();
    run();
    if (!now) g.getImageData(0, 0, 1, 1);         // draw it now, so the time it takes counts against this frame
    const took = performance.now() - a;
    visorStepMs = Math.max(took, visorStepMs * 0.8); ran = true;
  }
  sliceSpent += performance.now() - t0;
  if (job.next < job.steps.length) return null;
  jobs.delete(kind);
  kit.visors.set(kind, job.parts);
  return job.parts;
}

/** A visor's hollow while its fringe is still baking (the hollow is a plain shade, the same for every colour). */
function pendingHollow(kit: FurKit, kind: AssistantVisor): HTMLCanvasElement | null {
  const job = visorJobs.get(kit.base ?? kit)?.get(kind);
  return job?.hollowDone ? job.parts.hollow : null;
}

// ---- Her coat in a person's colour (personal assistants) -----------------------------------------------------------
// The coat, its tufts, its ring and each visor's fringe are baked once per size in neutral white (above) and tinted per
// colour: the white sprite multiplied by the colour's middle tone and cut back to the sprite's own alpha. Tips (white)
// become the colour, the slightly grey roots a touch darker, so the fur keeps its depth in every colour. A tint is a
// few full-canvas draws (well under a millisecond), done once per size and colour and cached; a frame costs the same as
// white's. White itself is never tinted: it is the owner's coat as baked.

const FUR_MAX_TINTS = 16;
const furTints = new Map<string, FurKit>();

/** A sprite multiplied by `ink`, keeping the sprite's alpha. A plain canvas: it is only ever drawn from. */
function tintCanvas(src: HTMLCanvasElement, ink: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const g = c.getContext("2d");
  if (!g) throw new Error("Brenda: no 2D canvas");
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "multiply"; g.fillStyle = ink; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-in"; g.drawImage(src, 0, 0);
  return c;
}

/** The kit in a colour: `base` itself for white (no ink), else its tint, made at once and cached. */
function tintKit(base: FurKit, ink: string | null): FurKit {
  if (!ink) return base;
  const key = `${base.rpx}|${base.lod}|${ink}`;
  const hit = furTints.get(key);
  if (hit && hit.base === base) { furTints.delete(key); furTints.set(key, hit); return hit; }
  const t0 = performance.now();
  const kit: FurKit = {
    ...base, coat: tintCanvas(base.coat, ink), atlas: base.atlas && tintCanvas(base.atlas, ink), ring: base.ring && tintCanvas(base.ring, ink),
    visors: new Map(), patterns: new WeakMap(), usedAt: -1, base, ink,
  };
  sliceSpent += performance.now() - t0;
  furTints.set(key, kit);
  if (furTints.size > FUR_MAX_TINTS) {
    for (const [k, v] of furTints) if (v.usedAt !== sliceAt && v !== kit) { furTints.delete(k); break; }
  }
  return kit;
}

/** A visor's parts for a kit in any colour: the neutral parts, the fringe tinted as the coat is (the hollow is a shade). */
function partsFor(kit: FurKit, kind: AssistantVisor, now: boolean): VisorParts | null {
  if (!kit.base || !kit.ink) return visorParts(kit, kind, now);
  const have = kit.visors.get(kind);
  if (have) return have;
  const raw = visorParts(kit.base, kind, now);
  if (!raw) return null;
  const parts: VisorParts = { fringe: raw.fringe && tintCanvas(raw.fringe, kit.ink), hollow: raw.hollow };
  kit.visors.set(kind, parts);
  return parts;
}

/** Forgets the tints of a neutral kit the cache let go (none of them was drawn this frame: drawing one marks its base). */
function dropTints(base: FurKit) {
  for (const [k, v] of furTints) if (v.base === base) furTints.delete(k);
}

/**
 * While a size's coat bakes, for a Brenda already on screen (she must never vanish): the nearest size already baked at
 * the same detail level, scaled (the same layout, only a little softer), so nothing changes shape when the real coat
 * arrives; else the nearest coat of any level; else rung 22's plain coat (FUR_RUNGS[3]), baked at once outside the
 * budget (a few milliseconds).
 */
function stopgapKit(rpx: number): FurKit {
  const lod = lodFor(rungFor(rpx));
  const nearest = (ok: (k: FurKit) => boolean) => {
    let best: FurKit | null = null;
    for (const k of furKits.values()) if (ok(k) && (!best || Math.abs(Math.log(k.rpx / rpx)) < Math.abs(Math.log(best.rpx / rpx)))) best = k;
    return best;
  };
  return nearest((k) => k.lod === lod) ?? nearest(() => true) ?? (furKit(FUR_RUNGS[3], true) as FurKit);
}

/**
 * The gradients a frame needs that depend only on her size: the coat's feathered edge (with tufts it stops a little
 * inside her silhouette; small, it fills her circle), the plain disc under it, and the light on her fur (from the upper
 * left, greying gently towards the lower right rim; no grey before 0.6 of the way, at most 0.22 at the rim). There is no
 * outline round her: in her home's orb her white edge against the orb is what sets her apart, and a grey rim there (and
 * on dark pages) only dulls it.
 */
function furGradients(x: CanvasRenderingContext2D, R: number, small: boolean, coat: FurColour) {
  const feather = x.createRadialGradient(0, 0, (small ? 0.9 : 0.82) * R, 0, 0, (small ? 1 : 0.95) * R);
  feather.addColorStop(0, "#000"); feather.addColorStop(1, "rgba(0,0,0,0)");
  const under = x.createRadialGradient(0, 0, R * 0.84, 0, 0, R * 0.94);
  under.addColorStop(0, rgba(coat.under)); under.addColorStop(1, rgba(coat.under, 0));
  const light = x.createRadialGradient(-R * 0.4, -R * 0.5, 0, -R * 0.08, -R * 0.1, R * 1.4);
  const [e, k] = [coat.edge, coat.edgeK];
  light.addColorStop(0, "rgba(255,255,255,0.3)"); light.addColorStop(0.32, "rgba(255,255,255,0)");
  light.addColorStop(0.6, rgba(e, 0)); light.addColorStop(0.82, rgba(e, 0.1 * k)); light.addColorStop(1, rgba(e, 0.22 * k));
  return { feather, under, light };
}

/**
 * The coat's colour (personal assistants): `ink`, what the white coat is multiplied by (null for white, the owner's coat
 * as baked); `under`, the plain disc under the coat's feathered edge (her underpaint, multiplied as the coat is); and
 * `edge`, the shade the light greys her towards at the rim (white's neutral grey; a colour's own rim tone, a little
 * stronger, so a coloured coat deepens towards the rim as the glossy sphere did rather than going grey).
 */
type FurColour = { colour: AssistantColour; ink: string | null; under: RGB; edge: RGB; edgeK: number };
const UNDER_RGB = hex(UNDERPAINT);
function furColour(colour: AssistantColour): FurColour {
  if (colour === "white") return { colour, ink: null, under: UNDER_RGB, edge: [82 / 255, 86 / 255, 98 / 255], edgeK: 1 };
  const s = PALETTE[colour].sphere, mid = hex(s.mid);
  return { colour, ink: s.mid, under: [UNDER_RGB[0] * mid[0], UNDER_RGB[1] * mid[1], UNDER_RGB[2] * mid[2]], edge: hex(s.rim), edgeK: 1.3 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class BrendaEngine {
  state: BrendaState = "idle";
  private cfg: StateCfg = STATES.idle;
  /** Who she is drawn as: the coat's colour, the visor and the eyes (personal assistants, 7 October 2026). */
  private drawn: AssistantLook = DEFAULT_LOOK;
  private coatColour: FurColour = furColour(DEFAULT_LOOK.colour);
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
  /** While she speaks: the speech level, 0 to 1, or null when she is not speaking. */
  talk: number | null = null;
  /** The speech level as she shows it: quick to rise, slower to fall. */
  private said = 0;
  /** How far into talking she is, 0 to 1, eased in and out (`talkRamp` is its linear clock). */
  private talking = 0;
  private talkRamp = 0;
  /** Reduced motion: talking is a still pose (set by `settle()`, cleared by the next `update()`). */
  private talkStill = false;
  /** Her own colour, which her glow turns towards while she talks (the sphere's shade, from her look). */
  private ownGlow: RGB = hex(PALETTE[DEFAULT_LOOK.colour].sphere.shade);
  /**
   * "own" (her home, owner request 9 October 2026: the glow is "whatever colour the selected Brenda is"): her resting
   * light is her own colour, not her moods' violet; expressive moods (happy, alert, error…) still show their colour.
   * "mood" everywhere else.
   */
  private glowMode: "mood" | "own" = "mood";
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
  // Her fur's secondary motion: how far the tuft tips lag behind her body (in R, on the page), behind her squash and
  // stretch, and behind her tilt, each on a soft spring. `furWas` is last frame's pose (ox, oy, sx, sy, tilt, yaw,
  // pitch, roll), to see how far she moved; `furPrimed` says whether there is one. `furClock` (advanced only by
  // update()) drives the drift at rest, and `furAwake` eases it in after settle(), so a still frame is always the same.
  private furLx = 0; private furLy = 0; private furVx = 0; private furVy = 0;
  private furSx = 0; private furSy = 0; private furVsx = 0; private furVsy = 0;
  private furT = 0; private furVt = 0;
  private furWas = new Float64Array(8);
  private furPrimed = false;
  private furClock = 0; private furAwake = 1;
  /** Set by settle(): the next frame is a still one, so it finishes any bake it needs at once. */
  private still = false;
  // Kept between frames (nothing is allocated per frame): her body's transform, the coat pattern's, and the visor's outline.
  private bm = new Float64Array(6);
  private patM: DOMMatrix | null = null;
  private pathR = -1;
  private visorP: Path2D | null = null;
  /** The gradients that depend only on her size (the coat's feather, the plain disc under it, the light), and for which size. */
  private grads: { R: number; small: boolean; colour: AssistantColour; feather: CanvasGradient; under: CanvasGradient; light: CanvasGradient } | null = null;
  /**
   * How far she has faded in (0 to 1), and when that began. -1 until her first frame: if her coat is ready then she is
   * simply there; if not, she waits for her own coat (no stand-in before she has been seen) and fades in over APPEAR_MS.
   * Once any of her is on screen she never vanishes: while a new size bakes she is drawn from stopgapKit.
   */
  private appear = -1;
  private appearAt = 0;
  /**
   * The visor parts she was last drawn with (which visor, in which colour, baked for which size): while a new size's
   * parts bake, she keeps these, scaled, so her visor never loses its fringe and hollow for a frame.
   */
  private held: { kind: AssistantVisor; ink: string | null; rpx: number; parts: VisorParts } | null = null;

  constructor(look: AssistantLook = DEFAULT_LOOK) {
    this.setLook(look);
  }

  /** The look she is drawn with, from the next frame on (no transition). Anything unknown falls back to Brenda's. */
  setLook(look: AssistantLook) {
    const colour = isAssistantColour(look.colour) ? look.colour : DEFAULT_LOOK.colour;
    this.drawn = {
      colour,
      visor: isAssistantVisor(look.visor) ? look.visor : DEFAULT_LOOK.visor,
      eyes: isAssistantEyes(look.eyes) ? look.eyes : DEFAULT_LOOK.eyes,
    };
    this.coatColour = furColour(colour);
    this.ownGlow = hex(PALETTE[colour].sphere.shade);
    this.pathR = -1; this.grads = null;
  }
  get look(): AssistantLook { return { ...this.drawn }; }

  /** Whether her light is her mood's colour ("mood") or, at rest, her own ("own"; her home). */
  setGlowMode(mode: "mood" | "own") { this.glowMode = mode; }

  /** The colour of her light this frame: her own at rest in "own" mode, else her mood's. */
  private lightColour(): RGB {
    return this.glowMode === "own" && RESTING_STATES.has(this.state) ? this.ownGlow : this.glow;
  }

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
    this.furLx = this.furLy = this.furVx = this.furVy = this.furSx = this.furSy = this.furVsx = this.furVsy = this.furT = this.furVt = 0;
    this.furPrimed = false; this.furClock = 0; this.furAwake = 0; this.still = true; this.appear = 1;
    // Her voice: talking is a still pose here (no bob, no sway, no pulse): eyes a little wider and a steady soft glow
    // in her own colour while she speaks; nothing at all when she does not.
    const speaking = this.talk !== null;
    this.said = speaking ? 0.5 : 0; this.talkRamp = speaking ? 1 : 0; this.talking = this.talkRamp; this.talkStill = speaking;
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
    // Talking (her voice, phase 2), on top of any state: she eases into it and out of it over ~150 ms, and shows the
    // level quick to rise, slower to fall. It adds a small bob with the level and a gentle sway of the head, which her
    // tufts follow (furStep sees her move like any other).
    const sl = this.talk === null ? 0 : Math.max(0, Math.min(1, this.talk));
    const step = dt / TALK_EASE_S;
    this.talkRamp += Math.max(-step, Math.min(step, (this.talk === null ? 0 : 1) - this.talkRamp));
    this.talking = E.inOut(this.talkRamp);
    this.said += (sl - this.said) * k(sl > this.said ? 1e-6 : 0.001);
    this.talkStill = false;
    const talks = this.talking > 0.01 ? this.talking : 0;
    if (!this.tweens.has("tilt")) this.tilt += ((this.cfg.tilt ?? 0) + this.heard * 0.05 + (this.state === "dizzy" ? Math.sin(t * 7) * 0.12 : 0) + Math.sin(t * 2.6) * 0.025 * talks - this.tilt) * k(0.001);
    if (!this.tweens.has("oy")) this.oy += ((this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : 0) - this.said * 0.05 * talks - this.oy) * k(0.0008);
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
    this.furStep(dt);
  }

  /**
   * Her fur's secondary motion. The tips stay where they were as she moves (a hop, a shake, a squash, a tilt, a turn of
   * the head, which carries the surface of her face along with it), then a soft, lightly damped spring pulls them back
   * after her, so they lag, overshoot and settle.
   */
  private furStep(dt: number) {
    const was = this.furWas;
    if (this.furPrimed) {
      let dRoll = this.roll - was[7];
      if (Math.abs(dRoll) > 1) dRoll = 0;               // a spin ending snaps roll back to 0
      this.furLx -= this.ox - was[0] + (this.yaw - was[5]) * 0.3;
      this.furLy -= this.oy - was[1] - (this.pitch - was[6] + dRoll * 0.4) * 0.3;
      this.furSx -= this.sx - was[2]; this.furSy -= this.sy - was[3];
      this.furT -= this.tilt - was[4];
    }
    was[0] = this.ox; was[1] = this.oy; was[2] = this.sx; was[3] = this.sy;
    was[4] = this.tilt; was[5] = this.yaw; was[6] = this.pitch; was[7] = this.roll;
    this.furPrimed = true;
    const h = Math.min(dt, 0.1), n = Math.max(1, Math.ceil(h * 120)), d = h / n;
    for (let i = 0; i < n; i++) {
      this.furVx += (-110 * this.furLx - 6 * this.furVx) * d; this.furLx += this.furVx * d;
      this.furVy += (-110 * this.furLy - 6 * this.furVy) * d; this.furLy += this.furVy * d;
      this.furVsx += (-150 * this.furSx - 7 * this.furVsx) * d; this.furSx += this.furVsx * d;
      this.furVsy += (-150 * this.furSy - 7 * this.furVsy) * d; this.furSy += this.furVsy * d;
      this.furVt += (-120 * this.furT - 6 * this.furVt) * d; this.furT += this.furVt * d;
    }
    this.furLx = clamp(this.furLx, -0.25, 0.25); this.furLy = clamp(this.furLy, -0.25, 0.25);
    this.furSx = clamp(this.furSx, -0.3, 0.3); this.furSy = clamp(this.furSy, -0.3, 0.3);
    this.furT = clamp(this.furT, -0.4, 0.4);
    this.furClock += dt;
    this.furAwake += (1 - this.furAwake) * (1 - Math.pow(0.2, dt));
  }

  /**
   * Draws into a canvas of W×H CSS pixels (the caller applies the device pixel ratio). The canvas holds only her: it is
   * cleared first, and while she fades in the whole canvas is faded.
   */
  draw(x: CanvasRenderingContext2D, W: number, H: number) {
    x.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.34;   // the sphere's radius: room around her for the glow, hops and particles
    const cx = W / 2 + this.ox * R, cy = H / 2 + this.oy * R + R * 0.04;
    const eyeInk = mix([1, 1, 1], this.glow, Math.min(1, this.tint * 1.6));
    // While she talks her glow brightens with the level and turns towards her own colour (her eyes keep her mood's tint).
    const talks = this.talking > 0.01 ? this.talking : 0;
    const light = this.lightColour();
    const halo = talks ? mix(light, this.ownGlow, 0.6 * talks) : light;
    const lift = this.said * 0.3 * talks;
    const m0 = x.getTransform(), rpx = R * (Math.hypot(m0.a, m0.b) || 1);
    const still = this.still;
    const ready = furKit(rpx, still);
    this.still = false;
    if (ready && this.appear < 1) {
      const n = performance.now();
      if (this.appear < 0) this.appear = 1;
      else { if (!this.appearAt) this.appearAt = n; this.appear = Math.min(1, (n - this.appearAt) / APPEAR_MS); }
    }
    if (!ready && this.appear <= 0) { this.appear = 0; this.appearAt = 0; return; }   // not seen yet, coat baking: wait
    // Her coat in her colour (white is the neutral coat itself), and her visor's fringe and hollow at this size. While a
    // size's parts bake she keeps the ones she was last drawn with, scaled; a visor she has not worn yet shows its hollow
    // as soon as that is baked and its fringe a frame or two later.
    const neutral = ready ?? stopgapKit(rpx), coat = this.coatColour, kind = this.drawn.visor;
    const kit = tintKit(neutral, coat.ink);
    kit.usedAt = sliceAt; neutral.usedAt = sliceAt;
    let parts = partsFor(kit, kind, still), prpx = kit.rpx;
    const held = this.held;
    if (parts) { if (!held || held.parts !== parts) this.held = { kind, ink: coat.ink, rpx: kit.rpx, parts }; }
    else if (held && held.kind === kind && held.ink === coat.ink) { parts = held.parts; prpx = held.rpx; }
    else { const h = pendingHollow(kit, kind); if (h) parts = { fringe: null, hollow: h }; }
    if (R !== this.pathR) { this.pathR = R; this.visorP = visorPath(kind, R); }

    // Where the visor is: it slides across her and foreshortens as she turns, and goes round the back when she spins.
    let p = VISOR_PITCH + this.pitch + this.roll;
    p = ((((p + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const cy0 = Math.cos(this.yaw), cp = Math.cos(p), facing = cy0 * cp;
    let vx = Math.sin(this.yaw) * cp * R * VISOR_REACH;
    const vy = -Math.sin(p) * R * VISOR_REACH, vsy = Math.max(0.2, cp / Math.cos(VISOR_PITCH));
    // The glass stays inside her fur: its far side never comes nearer her silhouette than VISOR_KEEP, so there is always
    // fur all round it. Near her rim it foreshortens a little harder, and past that slides a little less.
    const vsx0 = Math.max(0.2, cy0);
    let vsx = vsx0, ax = Math.abs(vx) / R;
    const edge = VISOR_EDGES[kind];
    for (const [ex, ey] of edge) {
      const Y = vy / R + ey * vsy, room = VISOR_KEEP * VISOR_KEEP - Y * Y;
      vsx = Math.min(vsx, room > 0 ? (Math.sqrt(room) - ax) / ex : 0);
    }
    vsx = Math.max(vsx, vsx0 * 0.85);
    for (const [ex, ey] of edge) {
      const Y = vy / R + ey * vsy, room = VISOR_KEEP * VISOR_KEEP - Y * Y;
      ax = Math.min(ax, Math.max(0, (room > 0 ? Math.sqrt(room) : 0) - ex * vsx));
    }
    vx = Math.sign(vx) * ax * R;
    const shown = facing > 0.05, fa = Math.min(1, (facing - 0.05) * 6);

    // Her body's transform (centre, tilt, squash), composed by hand so the tufts can be stamped onto it.
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt), bm = this.bm;
    bm[0] = (m0.a * ct + m0.c * st) * this.sx; bm[1] = (m0.b * ct + m0.d * st) * this.sx;
    bm[2] = (m0.c * ct - m0.a * st) * this.sy; bm[3] = (m0.d * ct - m0.b * st) * this.sy;
    bm[4] = m0.a * cx + m0.c * cy + m0.e; bm[5] = m0.b * cx + m0.d * cy + m0.f;
    x.save();
    x.setTransform(bm[0], bm[1], bm[2], bm[3], bm[4], bm[5]);
    // The fur's lag, turned into her own frame; how far up her tufts may reach before the top of the canvas.
    const lx = this.furLx * ct + this.furLy * st, ly = -this.furLx * st + this.furLy * ct;
    const roomUp = cy / R - 0.03;

    // The coat, filling her circle. It slides a little with her head as she turns (its locks grow from her face), bobs
    // with her when she spins (more as her face goes round the back; it does not roll) and sways with her tufts.
    let pat = kit.patterns.get(x);
    if (!pat) { pat = x.createPattern(kit.coat, "no-repeat") ?? undefined; if (pat) kit.patterns.set(x, pat); }
    if (pat) {
      const m = (this.patM ??= new DOMMatrix()), s = R / kit.rpx;
      const away = clamp((0.3 - facing) / 0.3, 0, 1);
      const sx = clamp(Math.sin(this.yaw) * 0.1 + lx * 0.12, -COAT_SLIDE, COAT_SLIDE);
      const sy = clamp(-Math.sin(p) * (0.08 + away * 0.09) + 0.025 + ly * 0.12, -COAT_SLIDE, COAT_SLIDE);
      m.a = s; m.d = s; m.e = -kit.coat.width * s / 2 + sx * R; m.f = -kit.coat.height * s / 2 + sy * R;
      pat.setTransform(m);
      x.fillStyle = pat;
    } else x.fillStyle = rgba(coat.under);
    // With tufts, the coat stops a little inside her silhouette, so her edge is all fibrous tufts (a smooth fade would
    // show as a pale cap where the tufts are short, on top); small, it fills her circle and the ring of wisps is her edge.
    const small = !kit.atlas, cr = (small ? 1 : 0.95) * R;
    let gr = this.grads;
    if (!gr || gr.R !== R || gr.small !== small || gr.colour !== coat.colour) gr = this.grads = { R, small, colour: coat.colour, ...furGradients(x, R, small, coat) };
    x.beginPath(); x.arc(0, 0, cr, 0, Math.PI * 2); x.fill();
    // Feather its edge into the tufts (only the coat is on the canvas yet, so this touches nothing else).
    x.save(); x.beginPath(); x.rect(-cr, -cr, 2 * cr, 2 * cr); x.clip();      // (destination-in would sweep the whole canvas)
    x.globalCompositeOperation = "destination-in";
    x.fillStyle = gr.feather; x.beginPath(); x.arc(0, 0, cr, 0, Math.PI * 2); x.fill();
    x.restore();
    // The far tufts behind the coat; the near tufts and the cowlick over its edge (or, small, the ring of wisps).
    if (kit.atlas) {
      // Under the coat's fade, a plain disc of its colour, so nothing shows through between the coat and the tufts.
      x.globalCompositeOperation = "destination-over";
      x.fillStyle = gr.under; x.beginPath(); x.arc(0, 0, R * 0.94, 0, Math.PI * 2); x.fill();
      this.drawTufts(x, kit, kit.atlas, kit.back, R, lx, ly, ct, st, roomUp);
      x.globalCompositeOperation = "source-over";
      this.drawTufts(x, kit, kit.atlas, kit.front, R, lx, ly, ct, st, roomUp);
      this.drawTufts(x, kit, kit.atlas, kit.crest, R, lx, ly, ct, st, roomUp);
    } else {
      x.globalCompositeOperation = "source-over";
      if (kit.ring) { const e = kit.ring.width / kit.rpx / 2; x.drawImage(kit.ring, -e * R, -e * R, 2 * e * R, 2 * e * R); }
    }
    // Short fur round the visor.
    const fringe = parts?.fringe;
    if (shown && fringe) {
      x.save(); x.translate(vx, vy); x.scale(vsx, vsy); x.globalAlpha = fa;
      x.drawImage(fringe, FRINGE_X0 * R, FRINGE_Y0 * R, fringe.width / prpx * R, fringe.height / prpx * R);
      x.restore();
    }

    // Light on the fur only (source-atop keeps it to what is drawn so far): lit from the upper left, greying gently
    // towards the lower right rim.
    x.globalCompositeOperation = "source-atop";
    x.beginPath(); x.arc(0, 0, R * 1.3, 0, Math.PI * 2);
    x.fillStyle = gr.light; x.fill();
    // Her mood as a rim light in the fur along her lower half (her top stays white).
    if (this.tint > 0.01) {
      const tg = x.createLinearGradient(0, R * 0.2, 0, R * 1.15);
      const rim = this.lightColour();
      tg.addColorStop(0, rgba(rim, 0)); tg.addColorStop(1, rgba(rim, 0.6 * this.tint));
      x.fillStyle = tg; x.fill();
    }
    // The hollow the visor sits in, after the light so the sheen cannot wash it out.
    if (shown && parts) {
      const hollow = parts.hollow;
      x.save(); x.translate(vx, vy); x.scale(vsx, vsy); x.globalAlpha = fa;
      x.drawImage(hollow, FRINGE_X0 * R, FRINGE_Y0 * R, hollow.width / prpx * R, hollow.height / prpx * R);
      x.restore();
    }
    // Her glow, behind the fur (destination-over paints under what is there): as soft and as far as the glossy
    // sphere's, and never past the canvas edge, even mid-hop or mid-squash.
    x.globalCompositeOperation = "destination-over";
    const cap = Math.min(HALO[HALO.length - 1][0], Math.min(cy, H - cy) / (R * this.sy), Math.min(cx, W - cx) / (R * this.sx)) - 0.02;
    if (cap > HALO[0][0] + 0.05) {
      const r0 = HALO[0][0], a = Math.min(1, 0.24 + this.heard * 0.25 + lift * 0.6);
      const hg = x.createRadialGradient(0, R * 0.05, R * r0, 0, R * 0.05, R * cap);
      for (const [r, k] of HALO) if (r < cap) hg.addColorStop((r - r0) / (cap - r0), rgba(halo, a * k));
      hg.addColorStop(1, rgba(halo, 0));
      x.fillStyle = hg; x.beginPath(); x.arc(0, R * 0.05, R * cap, 0, Math.PI * 2); x.fill();
    }
    x.restore();

    // The mood light beneath her, under everything.
    x.save();
    x.globalCompositeOperation = "destination-over";
    const g = x.createRadialGradient(cx, cy + R * 0.2, R * 0.6, cx, cy + R * 0.2, R * 1.3);
    g.addColorStop(0, rgba(halo, Math.min(1, 0.42 + this.heard * 0.28 + lift))); g.addColorStop(1, rgba(halo, 0));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.restore();

    // The visor, over everything: black glass with the eyes behind it.
    if (shown) {
      x.save();
      x.translate(cx, cy);
      x.rotate(this.tilt);
      x.scale(this.sx, this.sy);
      x.translate(vx, vy);
      x.scale(vsx, vsy);
      const visor = this.visorP as Path2D;
      // The lip where the visor sits into the fur, then the black glass.
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
      // Talking: she has no mouth, so her eyes stand in for one, squashed to about 0.72 between syllables and opening
      // to about 1.17 on a peak (whatever their shape; a blink still closes them). Still and a little wider under
      // reduced motion.
      const [esx, esy] = this.talkStill ? TALK_STILL : [1 + (0.04 - this.said * 0.05) * talks, 1 + (this.said * 0.45 - 0.28) * talks];
      for (const sd of [-1, 1]) {
        x.save();
        x.translate(sd * R * EYE_SPREAD + px, R * EYE_Y + py);
        if (talks) x.scale(esx, esy);
        this.eye(x, shape, R * EYE_W * this.eyeScale, R * EYE_H * this.eyeScale, sd, rgba(eyeInk));
        x.restore();
      }
      x.restore();
      x.restore();
    }

    this.drawParticles(x, R, cx, cy);
    // Fading in on her first appearance: her canvas holds only her, so this fades glow, coat, visor and particles alike.
    if (this.appear < 1) {
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "destination-in";
      x.fillStyle = `rgba(0,0,0,${Math.max(0, this.appear)})`; x.fillRect(0, 0, x.canvas.width, x.canvas.height);
      x.restore();
    }
  }

  /**
   * Stamps tufts round her edge from the atlas, each bent by the fur's lag (the part of it across the tuft swings it,
   * the part along it stretches or squashes it), by the lag of her squash and her tilt, by a little droop where the
   * fur hangs, and by a slow drift at rest; tufts that point up are kept below the top of the canvas (`roomUp`, in R
   * from her centre). Her body's transform is `bm`; each tuft's is composed onto it by hand.
   */
  private drawTufts(x: CanvasRenderingContext2D, kit: FurKit, atlas: HTMLCanvasElement, tufts: Tuft[], R: number, lx: number, ly: number,
    ct: number, st: number, roomUp: number) {
    const bm = this.bm, sw = kit.cw / kit.unit, shh = kit.ch / kit.unit, t = this.furClock, awake = this.furAwake;
    const squash = this.furSy - this.furSx;
    for (const f of tufts) {
      const ca = Math.cos(f.a), sa = Math.sin(f.a);
      const across = -lx * sa + ly * ca, along = lx * ca + ly * sa;
      const drift = (Math.sin(t * f.w + f.ph) * 0.035 + Math.sin(t * 0.9 + f.a * 2) * 0.02) * awake;
      const bend = clamp((across / f.len) * f.flex * 1.6 + this.furT * 1.4 * f.flex + ca * 0.2 + (drift + squash * sa * ca * 1.5) * f.flex, -0.9, 0.9);
      let stretch = clamp(1 + along * 2 * f.flex + (this.furSy * sa * sa + this.furSx * ca * ca) * 1.1, 0.65, 1.4);
      // Room above: how far up the page the tip would reach (with her tilt and squash), kept under `roomUp`.
      const ta = f.a + bend, ut = -(st * this.sx * Math.cos(ta) + ct * this.sy * Math.sin(ta));
      if (ut > 0) {
        const ub = -(st * this.sx * ca + ct * this.sy * sa);
        stretch = Math.min(stretch, Math.max(0.3, (roomUp - f.r * ub) / (TUFT_REACH * f.len * ut)));
      }
      const ang = f.a + Math.PI / 2 + bend, c = Math.cos(ang), s = Math.sin(ang);
      const L = f.len * R * stretch, Wd = f.len * R * f.wid;
      const la = c * Wd, lb = s * Wd, lc = -s * L, ld = c * L, le = f.r * R * ca, lf = f.r * R * sa;
      x.setTransform(
        bm[0] * la + bm[2] * lb, bm[1] * la + bm[3] * lb, bm[0] * lc + bm[2] * ld, bm[1] * lc + bm[3] * ld,
        bm[0] * le + bm[2] * lf + bm[4], bm[1] * le + bm[3] * lf + bm[5],
      );
      x.drawImage(atlas, f.cell * kit.cw, f.row * kit.ch, kit.cw, kit.ch, CELL_X0, CELL_Y0, sw, shh);
    }
    x.setTransform(bm[0], bm[1], bm[2], bm[3], bm[4], bm[5]);
  }

  private eye(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number, ink: string): void {
    const t = nowS();
    switch (shape) {
      case "wide": return this.eye(x, "pill", w * 1.14, h * 1.12, sd, ink);
      case "pill": {
        // Her resting eyes in the chosen style, scaled as hers are (wide, listening, surprised); a blink squashes them.
        const style = this.drawn.eyes;
        if (style === "pill") { const hh = Math.max(h * this.open, w * 0.28); x.beginPath(); roundRect(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); x.fill(); return; }
        const [sw, shh, sr] = EYE_STYLES[style];
        const ew = (w * sw) / EYE_W, eh = (h * shh) / EYE_H;
        const hh = Math.max(eh * this.open, ew * 0.28);
        x.beginPath(); arcRect(x, -ew / 2, -hh / 2, ew, hh, sr === null ? Math.min(ew, hh) / 2 : (ew * sr) / sw); x.fill(); return;
      }
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
