import { describe, it, expect } from "vitest";
import { ASSISTANT_COLOURS, PALETTE } from "@/lib/assistant-look";
import { STATES } from "@/lib/brenda-character/engine";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUBBLE_FADE_MS, BUBBLE_HOLD_MS, BUBBLE_MS, BUBBLE_RISE_MS, DEPTH, HERO_WORDS, MOODS, RING, RING_SIZE, STEP_MAX_MS, STEP_MS,
  canSayAgain, hitTest, liveLabel, poolAt, nearestFor, poseFor, releaseTarget, ringIndex, sayLabel, stepDuration, tintStyle, wrap,
} from "@/components/landing/hero-assistants";

// The landing hero's carousel maths (owner request, 10 October 2026: Brenda in every colour, swipeable, the backdrop in
// the colour of the one in front). Contract: landing-spec A.4.

describe("the ring", () => {
  it("holds every palette colour once, coral in front", () => {
    expect(RING_SIZE).toBe(10);
    expect(new Set(RING).size).toBe(10);
    expect([...RING].sort()).toEqual([...ASSISTANT_COLOURS].sort());
    expect(RING[0]).toBe("coral");
  });
  it("flips only between built words, starting with doing", () => {
    expect(HERO_WORDS[0]).toBe("doing");
    expect(HERO_WORDS).toEqual(["doing", "stuck on", "waiting on", "delivering"]);
  });
});

describe("wrap and ringIndex", () => {
  it("wraps offsets into [-5, 5)", () => {
    expect(wrap(0)).toBe(0);
    expect(wrap(1)).toBe(1);
    expect(wrap(9)).toBe(-1);
    expect(wrap(-9)).toBe(1);
    expect(wrap(5)).toBe(-5);
    expect(wrap(-5)).toBe(-5);
    expect(wrap(23.5)).toBeCloseTo(3.5);
    expect(wrap(-0.25)).toBeCloseTo(-0.25);
  });
  it("names the ring item nearest the front", () => {
    expect(ringIndex(0)).toBe(0);
    expect(ringIndex(0.49)).toBe(0);
    expect(ringIndex(0.51)).toBe(1);
    expect(ringIndex(-1)).toBe(9);
    expect(ringIndex(23)).toBe(3);
  });
  it("puts green, white, coral, purple and yellow left to right at load", () => {
    const at = (o: number) => RING.findIndex((_, i) => wrap(i - 0) === o);
    expect([-2, -1, 0, 1, 2].map((o) => RING[at(o)])).toEqual(["green", "white", "coral", "purple", "yellow"]);
  });
});

describe("poseFor", () => {
  it("matches the depth table at whole offsets", () => {
    for (let a = 0; a < DEPTH.length; a++) {
      const p = poseFor(a), d = DEPTH[a];
      expect(p.x).toBeCloseTo(d.x); expect(p.y).toBeCloseTo(d.y); expect(p.scale).toBeCloseTo(d.scale);
      expect(p.opacity).toBeCloseTo(d.opacity); expect(p.brightness).toBeCloseTo(d.brightness);
      expect(p.blur * p.scale).toBeCloseTo(d.blur);   // the blur on screen, after the scale
    }
  });
  it("mirrors left and right, and keeps the front on top", () => {
    const l = poseFor(-1.3), r = poseFor(1.3);
    expect(l.x).toBeCloseTo(-r.x); expect(l.y).toBeCloseTo(r.y); expect(l.scale).toBeCloseTo(r.scale);
    expect(poseFor(0).z).toBeGreaterThan(poseFor(1).z);
    expect(poseFor(1).z).toBeGreaterThan(poseFor(2).z);
  });
  it("interpolates between rows and clamps past the last", () => {
    const h = poseFor(0.5);
    expect(h.x).toBeCloseTo(0.493); expect(h.scale).toBeCloseTo(0.857);
    expect(poseFor(4.5).opacity).toBe(0);
    expect(poseFor(4.5).scale).toBeCloseTo(0.3);
  });
  it("hides the far ones on phones", () => {
    expect(poseFor(2, true).opacity).toBe(0);
    expect(poseFor(1, true).opacity).toBe(1);
    expect(poseFor(2).opacity).toBeCloseTo(0.55);
  });
});

describe("poolAt", () => {
  it("keeps seven slots (five on phones), one element per position, and a step re-dresses only one", () => {
    const at0 = poolAt(0), at1 = poolAt(1);
    expect(at0.map((s) => s.pos)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
    expect(new Set(at0.map((s) => s.key)).size).toBe(7);
    expect(at0.find((s) => s.pos === -1)?.ring).toBe(RING_SIZE - 1);
    // Every position kept across the step stays in the same element.
    for (const s of at1) { const was = at0.find((p) => p.pos === s.pos); if (was) expect(was.key).toBe(s.key); }
    expect(at1.filter((s) => !at0.some((p) => p.key === s.key && p.pos === s.pos))).toHaveLength(1);
    expect(poolAt(0.49).map((s) => s.pos)).toEqual(at0.map((s) => s.pos));
    expect(poolAt(0, true).map((s) => s.pos)).toEqual([-2, -1, 0, 1, 2]);
    expect(new Set(poolAt(7.6, true).map((s) => s.key)).size).toBe(5);
  });
});

describe("releaseTarget and nearestFor", () => {
  it("settles on the nearest slot, carried by momentum, at most two away", () => {
    expect(releaseTarget(0.3, 0)).toBe(0);
    expect(releaseTarget(0.3, 2)).toBe(1);
    expect(releaseTarget(0.3, -2)).toBe(0);
    expect(releaseTarget(0.3, 40)).toBe(2);
    expect(releaseTarget(0.3, -40)).toBe(-1);
  });
  it("goes the shortest way round", () => {
    expect(nearestFor(1, 0)).toBe(1);
    expect(nearestFor(9, 0)).toBe(-1);
    expect(nearestFor(0, 9)).toBe(10);
    expect(nearestFor(4, 20)).toBe(24);
    expect(ringIndex(nearestFor(7, 33))).toBe(7);
  });
  it("times a jump by its length, capped", () => {
    expect(stepDuration(1)).toBe(STEP_MS);
    expect(stepDuration(-1)).toBe(STEP_MS);
    expect(stepDuration(3)).toBe(STEP_MS + 240);
    expect(stepDuration(5)).toBe(STEP_MAX_MS);
  });
});

describe("hitTest", () => {
  const u = 280;
  it("finds the front, a side and a far one by geometry", () => {
    expect(hitTest(0, 0.625 * u, 0, u)).toBe(0);
    expect(hitTest(0.986 * u, (0.625 + 0.136) * u, 0, u)).toBe(1);
    expect(hitTest(-0.986 * u, (0.625 + 0.136) * u, 0, u)).toBe(9);
    expect(hitTest(1.5 * u, (0.625 + 0.52) * u, 0, u)).toBe(2);
    expect(hitTest(-1.5 * u, (0.625 + 0.52) * u, 0, u)).toBe(8);
  });
  it("misses empty space, and the far ones on phones", () => {
    expect(hitTest(0, 1.24 * u, 0, u)).toBeNull();
    expect(hitTest(0.5 * u, 0.05 * u, 0, u)).toBeNull();
    expect(hitTest(1.5 * 176, (0.625 + 0.52) * 176, 0, 176, true)).toBeNull();
  });
  it("follows the ring while it moves", () => {
    const p = poseFor(wrap(1 - 0.4));
    expect(hitTest(p.x * u, (0.625 + p.y) * u, 0.4, u)).toBe(1);
  });
});

describe("tint and words", () => {
  it("reads the backdrop colour from the palette", () => {
    expect(tintStyle("coral")).toEqual({ "--lp-tint-dark": PALETTE.coral.sphere.shade, "--lp-tint-light": PALETTE.coral.sphere.rim });
  });
  it("announces a Brenda by colour, expression and place", () => {
    expect(liveLabel(0)).toBe("Brenda in coral, happy, 1 of 10.");
    expect(liveLabel(1)).toBe("Brenda in purple, dizzy, 2 of 10.");
  });
});

describe("expressions", () => {
  it("gives each Brenda her own expression, from the engine's real states", () => {
    const faces = RING.map((c) => `${MOODS[c].state}/${MOODS[c].face ?? ""}`);
    expect(new Set(faces).size).toBe(RING_SIZE);
    for (const c of RING) expect(Object.keys(STATES)).toContain(MOODS[c].state);
    expect(new Set(RING.map((c) => MOODS[c].word)).size).toBe(RING_SIZE);
  });
});

// Speech bubbles (owner request, 10 October 2026: "a word in a word bubble floats up from them and then disappears").
describe("speech bubbles", () => {
  it("gives each Brenda the owner's short line for her expression", () => {
    expect(RING.map((c) => MOODS[c].says)).toEqual([
      "Yay, you're done!", "Too many pings…", "Due today?!", "Hmm, who's stuck?", "Not another status call.",
      "Got your back.", "Zzz… standup yet?", "Shipped it!", "Love this team!", "Any update?",
    ]);
    for (const c of RING) expect(MOODS[c].says.length).toBeLessThanOrEqual(24);   // a small bubble on a 320px phone
  });
  it("rises, holds about 1.4 s and fades, in step with the stylesheet's keyframes", () => {
    expect(BUBBLE_MS).toBe(BUBBLE_RISE_MS + BUBBLE_HOLD_MS + BUBBLE_FADE_MS);
    expect(BUBBLE_HOLD_MS).toBeGreaterThanOrEqual(1300);
    expect(BUBBLE_HOLD_MS).toBeLessThanOrEqual(1500);
    const css = readFileSync(join(__dirname, "../../src/components/landing/hero-bubble.module.css"), "utf8");
    expect(css).toContain(`animation: rise ${BUBBLE_MS}ms both`);
    expect(css).toContain(`${Math.round((BUBBLE_RISE_MS / BUBBLE_MS) * 100)}% { opacity: 1; transform: translateY(0)`);
    expect(css).toContain(`${Math.round(((BUBBLE_RISE_MS + BUBBLE_HOLD_MS) / BUBBLE_MS) * 100)}% { opacity: 1; transform: translateY(-4px)`);
    // Reduced motion and the page's Pause: no travel.
    expect(css).toContain(`.bubble { animation-name: fade; animation-duration: ${BUBBLE_MS}ms !important; }`);
    expect(css).toContain(`:global(html[data-motion="paused"]) .bubble { animation-name: fade; }`);
    expect(css).toContain("pointer-events: none");
  });
  it("lets one Brenda have one bubble at a time, a new one only once hers is fading", () => {
    expect(canSayAgain(undefined, 0)).toBe(true);
    expect(canSayAgain(1000, 1000)).toBe(false);
    expect(canSayAgain(1000, 1000 + BUBBLE_RISE_MS + BUBBLE_HOLD_MS - 1)).toBe(false);
    expect(canSayAgain(1000, 1000 + BUBBLE_RISE_MS + BUBBLE_HOLD_MS)).toBe(true);
  });
  it("reads her words out in the live region", () => {
    expect(liveLabel(1, true)).toBe("Brenda in purple, dizzy, 2 of 10. “Too many pings…”");
    expect(sayLabel(0)).toBe("Brenda in coral says “Yay, you're done!”");
    expect(sayLabel(4)).toBe("Brenda in grey says “Not another status call.”");
  });
});
