/**
 * The landing hero's carousel, as numbers (owner request, 10 October 2026: Brenda in every colour, floating with no
 * circle, swipeable, the backdrop taking the colour of the one in front). Pure: the ring, the pose of a slot from its
 * offset to the front, the release projection, the hit-test and the step timings. Shared by the server hero (the tint
 * it paints with), the client stage and the lazy carousel; unit-tested in tests/unit/landing-hero.test.ts.
 *
 * `active` is one number: an integer at rest (that ring item in front), fractional while dragging or gliding. A ring
 * item's offset is `wrap(i − active)`, in [−5, 5): 0 in front, positive to the right. "Next" adds one (the right-hand
 * Brenda comes to the front, the ring moves left); a leftward swipe is next.
 */
import { PALETTE, type AssistantColour } from "@/lib/assistant-look";
import type { BrendaEmote, BrendaFace, BrendaState } from "@/lib/brenda-character/engine";

/**
 * Ten Brendas, one per palette colour, ordered so neighbours always contrast; coral (the owner's mock) in front at load.
 * No invented names: each is Brenda, told apart by colour (decision 2 of the contract). All wear her own visor and eyes.
 */
export const RING = ["coral", "purple", "yellow", "teal", "grey", "pink", "blue", "orange", "green", "white"] as const satisfies readonly AssistantColour[];
export const RING_SIZE = RING.length;

/**
 * Each Brenda's own expression (owner feedback, 10 October 2026: "every coloured Brenda has her own facial expression"),
 * from the engine's real states, held in every slot: `state` (and `face`, a wink held on top) set her face; `emote` is
 * the matching reaction she plays when she comes to the front, or when she is clicked there (null: a wink). `word` is
 * how the live region names it. Under reduced motion each is her still face.
 *
 * `says` is the short line in the speech bubble that rises from her head when she is clicked, activated from the
 * keyboard, or brought to the front by the person (owner request, 10 October 2026: "very short words that communicate
 * their expression"; the owner may edit them here). hero-bubble.tsx draws it; the live region reads it out.
 */
export const MOODS: Record<AssistantColour, { state: BrendaState; face?: BrendaFace; emote: BrendaEmote | null; word: string; says: string }> = {
  coral: { state: "happy", emote: "happy", word: "happy", says: "Yay, you're done!" },
  purple: { state: "dizzy", emote: null, word: "dizzy", says: "Too many pings…" },
  yellow: { state: "alert", emote: "surprised", word: "surprised", says: "Due today?!" },
  teal: { state: "thinking", emote: null, word: "thinking", says: "Hmm, who's stuck?" },
  grey: { state: "error", emote: "annoyed", word: "annoyed", says: "Not another status call." },
  pink: { state: "idle", face: "wink", emote: "wink", word: "winking", says: "Got your back." },
  blue: { state: "sleeping", emote: "yawn", word: "asleep", says: "Zzz… standup yet?" },
  orange: { state: "proud", emote: "proud", word: "proud", says: "Shipped it!" },
  green: { state: "love", emote: "love", word: "in love", says: "Love this team!" },
  white: { state: "question", emote: null, word: "curious", says: "Any update?" },
};

/**
 * The speech bubble's timings (ms; owner request, 10 October 2026): it rises from her head, holds, and fades as it
 * floats on up. hero-bubble.module.css runs the same three phases as one 2.2 s keyframe run (16% and 80% are the
 * phase boundaries); change both together.
 */
export const BUBBLE_RISE_MS = 350;
export const BUBBLE_HOLD_MS = 1410;
export const BUBBLE_FADE_MS = 440;
export const BUBBLE_MS = BUBBLE_RISE_MS + BUBBLE_HOLD_MS + BUBBLE_FADE_MS;

/**
 * One bubble at a time per Brenda: while hers is rising or holding, another click only plays her reaction; once it
 * has started to fade, a new one may rise in its place.
 */
export const canSayAgain = (shownAt: number | undefined, now: number) => shownAt === undefined || now - shownAt >= BUBBLE_RISE_MS + BUBBLE_HOLD_MS;

/** The flipping word in "Know what your team is …": each is built (status, blocked, blocked on whom, sent for check and done). */
export const HERO_WORDS = ["doing", "stuck on", "waiting on", "delivering"] as const;

/** Timings (ms). A step glides on the iOS sheet curve; a longer jump takes a little longer, never more than STEP_MAX. */
export const STEP_MS = 520;
export const STEP_EXTRA_MS = 120;
export const STEP_MAX_MS = 900;
export const STEP_EASE = [0.32, 0.72, 0, 1] as const;
/** The sides glide out from behind the front one when she is drawn (the page's one orchestrated moment). */
export const SPREAD_MS = 700;
/** Autoplay: the first step this long after the Brendas arrive, then one every AUTOPLAY_EVERY_MS, one full turn at most. */
export const AUTOPLAY_FIRST_MS = 4000;
export const AUTOPLAY_EVERY_MS = 7000;
export const AUTOPLAY_STEPS = RING_SIZE;
/** A release settles with this spring: critically damped or a little over, so nothing overshoots (v4: nothing bounces). */
export const RELEASE_SPRING = { type: "spring", stiffness: 260, damping: 34, mass: 1 } as const;
/** A pointer that moves less than this (px) is a click, not a drag. */
export const DRAG_SLOP = 6;
/** How far (in u) the pointer travels to move one slot: the distance between the front and a side. */
export const SLOT_TRAVEL = 0.986;

/** The offset `d` wrapped into [−n/2, n/2). */
export function wrap(d: number, n: number = RING_SIZE): number {
  const h = n / 2;
  return ((((d + h) % n) + n) % n) - h;
}

/** The ring index (0 to n − 1) of an integer or fractional position, rounded. */
export const ringIndex = (active: number, n: number = RING_SIZE) => ((Math.round(active) % n) + n) % n;

/** A slot's pose. x and y are in u (the front Brenda's size, CSS `--u`); blur is in CSS px before the scale. */
export type Pose = { x: number; y: number; scale: number; blur: number; opacity: number; brightness: number; z: number };

/**
 * The depth table, by |offset| (contract A.4, measured on the owner's mock): the front; the sides, a little lower and
 * smaller; the far ones, lower again, small, blurred and dimmed (gone on phones); past that, out of sight. `blur` is what
 * shows on screen (px); poseFor divides it by the scale, as CSS applies the filter before the transform.
 */
export const DEPTH = [
  { x: 0, y: 0, scale: 1, blur: 0, opacity: 1, phoneOpacity: 1, brightness: 1 },
  { x: 0.986, y: 0.136, scale: 0.714, blur: 0, opacity: 1, phoneOpacity: 1, brightness: 1 },
  { x: 1.5, y: 0.52, scale: 0.393, blur: 3.5, opacity: 0.55, phoneOpacity: 0, brightness: 0.85 },
  { x: 1.86, y: 0.68, scale: 0.3, blur: 6, opacity: 0, phoneOpacity: 0, brightness: 0.7 },
] as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The pose for an offset `o` (fractional while moving), on a phone or not: piecewise-linear between the depth rows. */
export function poseFor(o: number, phone = false): Pose {
  const a = Math.min(Math.abs(o), DEPTH.length - 1);
  const i = Math.min(Math.floor(a), DEPTH.length - 2), t = a - i;
  const p = DEPTH[i], q = DEPTH[i + 1];
  const scale = lerp(p.scale, q.scale, t);
  const sign = o < 0 ? -1 : 1;
  return {
    x: sign * lerp(p.x, q.x, t),
    y: lerp(p.y, q.y, t),
    scale,
    blur: lerp(p.blur, q.blur, t) / scale,
    opacity: phone ? lerp(p.phoneOpacity, q.phoneOpacity, t) : lerp(p.opacity, q.opacity, t),
    brightness: lerp(p.brightness, q.brightness, t),
    z: 10 - Math.round(Math.abs(o) * 2),
  };
}

/** A Brenda further out than MOUNT_IN is never hit; |o| < LIVE_UNDER draws live. */
export const MOUNT_IN = 3;
export const LIVE_UNDER = 1.5;

/** One slot of the pool: its whole position (unwrapped, like `active`), the element it lives in, and the ring item it shows. */
export type PoolSlot = { pos: number; key: number; ring: number };

/**
 * The fixed pool of slots at `active` (review fix, 10 October 2026: mounting and unmounting a slot on every step made
 * the browser recalculate the whole page's style, a long frame mid-glide): the whole positions within three of the front
 * (two on phones, where the far ones are invisible), each kept in element `pos mod pool size`. Neighbouring positions
 * never share an element, so a step re-dresses one element only: the one leaving at the far edge becomes the one
 * arriving at the other, out of sight (opacity 0 there), with a new look on the same canvas.
 */
export function poolAt(active: number, phone = false, n: number = RING_SIZE): PoolSlot[] {
  const half = phone ? 2 : MOUNT_IN, size = half * 2 + 1, c = Math.round(active);
  const out: PoolSlot[] = [];
  for (let pos = c - half; pos <= c + half; pos++) out.push({ pos, key: ((pos % size) + size) % size, ring: ((pos % n) + n) % n });
  return out;
}

/**
 * Where a released drag comes to rest: the nearest slot to where its momentum would carry it in 0.2 s (`velocity` in
 * slots a second, positive towards next), never more than two slots from where it was let go.
 */
export function releaseTarget(active: number, velocity: number): number {
  const t = Math.round(active + velocity * 0.2);
  return Math.max(Math.ceil(active - 2), Math.min(Math.floor(active + 2), t)) || 0;   // never -0
}

/** The nearest whole position to `from` that puts ring item `index` in front (the shortest way round). */
export function nearestFor(index: number, from: number, n: number = RING_SIZE): number {
  return Math.round(from) + Math.round(wrap(index - Math.round(from), n));
}

/** How long a jump of `slots` takes (ms). */
export const stepDuration = (slots: number) => Math.min(STEP_MAX_MS, STEP_MS + STEP_EXTRA_MS * Math.max(0, Math.abs(Math.round(slots)) - 1));

/**
 * Which Brenda is under a point, by geometry (the stage hit-tests; the slots ignore the pointer). `x` is from the stage's
 * centre line and `y` from its top, in CSS px; `u` the front size. Each ball is a circle of 0.45u × its scale round the
 * slot's centre (the stage is 1.25u tall, her ball sits at its middle). The nearest the front wins where they overlap.
 * Returns the ring index, or null.
 */
export function hitTest(x: number, y: number, active: number, u: number, phone = false, n: number = RING_SIZE): number | null {
  let best: { i: number; a: number } | null = null;
  for (let i = 0; i < n; i++) {
    const o = wrap(i - active, n), a = Math.abs(o);
    if (a > MOUNT_IN) continue;
    const p = poseFor(o, phone);
    if (p.opacity < 0.2) continue;
    const cx = p.x * u, cy = 0.625 * u + p.y * u, r = 0.45 * u * p.scale;
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
    if (!best || a < best.a) best = { i, a };
  }
  return best ? best.i : null;
}

/** The backdrop's colour for a Brenda: her sphere's shade on dark, its rim on light (read by `.lp-hero`, globals.css §6). */
export function tintStyle(colour: AssistantColour): Record<"--lp-tint-dark" | "--lp-tint-light", string> {
  const s = PALETTE[colour].sphere;
  return { "--lp-tint-dark": s.shade, "--lp-tint-light": s.rim };
}

/** The colour as a word, lower case ("coral"). */
export const colourWord = (colour: AssistantColour) => PALETTE[colour].label.toLowerCase();

/**
 * What the live region says when a Brenda settles in front: "Brenda in purple, dizzy, 2 of 10." When the person brought
 * her there her bubble rises too, and the region reads it after the place: "… 2 of 10. “Too many pings…”"
 */
export const liveLabel = (index: number, said = false) =>
  `Brenda in ${colourWord(RING[index])}, ${MOODS[RING[index]].word}, ${index + 1} of ${RING_SIZE}.${said ? ` “${MOODS[RING[index]].says}”` : ""}`;

/** What the live region says when the Brenda already in front is clicked or activated: "Brenda in coral says “Yay, you're done!”" */
export const sayLabel = (index: number) => `Brenda in ${colourWord(RING[index])} says “${MOODS[RING[index]].says}”`;
