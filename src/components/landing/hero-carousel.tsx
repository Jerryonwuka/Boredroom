"use client";

/**
 * The landing hero's Brendas (owner request, 10 October 2026), loaded on its own after the page has painted
 * (hero-stage.tsx). Every one is the canvas character from her home, floating with no circle, quiet and not pokeable,
 * wearing her own expression in every slot (MOODS; owner feedback, 10 October 2026) and always in her own light
 * (`glow="own-always"`: a mood's own colour would fight the backdrop matched to her). Each slot holds a character at the front size and is scaled down with CSS, so
 * they all share one bake of her coat and no canvas ever resizes.
 *
 * Cheap where it can be: a fixed pool of slots, the whole positions within three of the front (seven canvases at most,
 * five on phones), each kept in its own element as the ring turns (poolAt; review fix, 10 October 2026: a step re-dresses
 * the one slot passing out of sight at the far edge with a new look on the same canvas, so turning the ring never adds
 * or removes an element, which made the browser recalculate the whole page's style mid-glide); the front and the two
 * sides draw live (breathing, blinking, eyes on the pointer) and the rest are one still frame; on a slow device (frames
 * over 22 ms) only the front stays live; with the page's Pause on, all of them are still. Off screen or in a hidden tab
 * the characters draw nothing (BrendaCharacter's own observers). Poses are written straight to each slot's style from
 * the stage's `active` and `spread` values, never through a render.
 *
 * The arrival (the page's one orchestrated moment): the front one alone fades in as her coat is ready; then the sides
 * mount and glide out from behind her as the stage's `spread` runs; then the far ones mount one per idle moment and
 * fade in. Under reduced motion they are all placed at once, still.
 *
 * Her speech bubble (owner request, 10 October 2026): the stage asks for one through `sayRef`; it is drawn in whichever
 * slot shows her (hero-bubble.tsx), one at a time per Brenda (canSayAgain), and let go when its run ends (or a little
 * after, should the animation never run, as in a hidden tab).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { animate, type MotionValue } from "motion/react";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BUBBLE_MS, LIVE_UNDER, MOODS, RING, canSayAgain, poolAt, poseFor, type PoolSlot } from "@/components/landing/hero-assistants";
import { HeroBubble } from "@/components/landing/hero-bubble";
import { onIdle, type EmoteFn, type SayFn } from "@/components/landing/hero-stage";

/** The far slots in the order they arrive: left then right, nearer first. */
const FAR_ARRIVAL = [-2, 2, -3, 3];

type Slot = PoolSlot & { live: boolean };

export function HeroCarousel({ active, spread, size, phone, still, reduced, onReady, emoteRef, sayRef }: {
  active: MotionValue<number>; spread: MotionValue<number>; size: number; phone: boolean;
  /** The page's Pause: every character still. */
  still: boolean;
  reduced: boolean;
  /** Called once, when the front Brenda has been drawn. */
  onReady: () => void;
  /** Filled in here so the stage can make one react. */
  emoteRef: RefObject<EmoteFn | null>;
  /** Filled in here so the stage can make one speak. */
  sayRef: RefObject<SayFn | null>;
}) {
  /** The sides are out (the front one has been drawn); reduced motion starts with everyone placed. */
  const [sides, setSides] = useState(reduced);
  /** How many far slots have arrived. */
  const [far, setFar] = useState(reduced ? FAR_ARRIVAL.length : 0);
  /** The arrival: 0, the front one only; 1, and the sides, the far ones arriving; 2, everyone (phones show no far ones). */
  const phase: 0 | 1 | 2 = !sides ? 0 : far >= FAR_ARRIVAL.length || phone ? 2 : 1;
  /** A slow device: only the front draws live. */
  const [lite, setLite] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  /** The pool's elements by key, and the whole position and ring item each holds now (set by recount). */
  const els = useRef(new Map<number, HTMLDivElement>());
  const chars = useRef(new Map<number, BrendaCharacterHandle>());
  const posOf = useRef(new Map<number, number>());
  const ringOf = useRef(new Map<number, number>());
  /** Per-element fade (0 to 1) for the far ones arriving; 1 when absent. */
  const fades = useRef(new Map<number, number>());
  /** The speech bubbles showing, by ring item: a fresh id for each one (its key) and when it rose. */
  const [bubbles, setBubbles] = useState<ReadonlyMap<number, { id: number; at: number }>>(new Map());
  const bubblesRef = useRef(bubbles);
  const bubbleSeq = useRef(0);
  const bubbleTimers = useRef(new Set<number>());

  // Which slots exist, what each shows and which draw live, at the current position and arrival phase. A render only
  // when that changes: once per step, for the one element re-dressed at the far edge.
  const recount = useCallback(() => {
    const a = active.get(), c = Math.round(a);
    const pool = poolAt(a, phone);
    const arrived = FAR_ARRIVAL.slice(0, far);
    const kept = phase === 2 ? pool : pool.filter((s) => Math.abs(s.pos - a) < (phase === 0 ? 0.5 : LIVE_UNDER) || arrived.includes(s.pos - c));
    posOf.current = new Map(kept.map((s) => [s.key, s.pos]));
    ringOf.current = new Map(kept.map((s) => [s.key, s.ring]));
    const list: Slot[] = kept.sort((x, y) => x.key - y.key).map((s) => {
      const o = Math.abs(s.pos - a);
      return { ...s, live: !still && !reduced && (lite ? o < 0.5 : o < LIVE_UNDER) };
    });
    setSlots((prev) => (prev.length === list.length && prev.every((s, k) => s.key === list[k].key && s.ring === list[k].ring && s.live === list[k].live) ? prev : list));
  }, [active, phase, far, still, reduced, lite, phone]);

  // Each slot's pose from `active` and `spread`, written to its style.
  const place = useCallback(() => {
    const a = active.get(), s = spread.get();
    for (const [k, el] of els.current) {
      const pos = posOf.current.get(k);
      if (pos === undefined) continue;
      const o = pos - a, p = poseFor(o * s, phone);
      // While they spread out, never more opaque than at rest (the ones out of sight stay out of sight on the way).
      const opacity = Math.min(p.opacity, poseFor(o, phone).opacity) * (Math.abs(o) < 0.5 ? 1 : s) * (fades.current.get(k) ?? 1);
      el.style.transform = `translate3d(${(p.x * size).toFixed(2)}px, ${(p.y * size).toFixed(2)}px, 0) scale(${p.scale.toFixed(4)})`;
      el.style.opacity = opacity.toFixed(3);
      el.style.filter = p.blur > 0.05 || p.brightness < 0.995 ? `blur(${p.blur.toFixed(2)}px) brightness(${p.brightness.toFixed(3)})` : "none";
      el.style.zIndex = String(10 - Math.round(Math.abs(o) * 2));
      el.style.visibility = opacity < 0.01 ? "hidden" : "visible";
    }
  }, [active, spread, phone, size]);

  useEffect(() => {
    const offA = active.on("change", () => { recount(); place(); });
    const offS = spread.on("change", place);
    return () => { offA(); offS(); };
  }, [active, spread, recount, place]);
  // A new phase, Pause or lite: recount now. It reads the motion value, which lives outside React, and setSlots bails
  // out when nothing changed.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { recount(); }, [recount]);
  // Freshly mounted slots get their pose before they paint.
  useLayoutEffect(() => { place(); }, [slots, place]);

  // The far ones arrive one per idle moment once the sides are out, fading in over 400 ms.
  useEffect(() => {
    if (phase !== 1) return;
    return onIdle(() => {
      const pos = Math.round(active.get()) + FAR_ARRIVAL[far];
      const key = poolAt(pos).find((p) => p.pos === pos)?.key ?? 0;
      fades.current.set(key, 0);
      animate(0, 1, { duration: 0.4, onUpdate: (v) => { fades.current.set(key, v); place(); }, onComplete: () => { fades.current.delete(key); place(); } });
      setFar((n) => n + 1);
    }, 600);
  }, [phase, far, active, place]);

  // A slow device: after arriving, watch two seconds of frames; if the median is over 22 ms, only the front stays live.
  useEffect(() => {
    if (phase !== 2 || reduced || still) return;
    const gaps: number[] = [];
    let raf = 0, last = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      if (last) gaps.push(t - last);
      last = t;
      if (t - t0 < 2000) { raf = requestAnimationFrame(tick); return; }
      gaps.sort((x, y) => x - y);
      if (gaps.length > 10 && gaps[gaps.length >> 1] > 22) setLite(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, reduced, still]);

  // The stage makes one react through this.
  useEffect(() => {
    const map = chars.current, rings = ringOf;
    emoteRef.current = (ring, e, burst) => { for (const [k, r] of rings.current) if (r === ring) map.get(k)?.emote(e, burst); };
    return () => { emoteRef.current = null; };
  }, [emoteRef]);

  // The stage makes one speak through this: her bubble rises unless hers is still rising or holding (one at a time).
  const unsay = useCallback((ring: number, id: number) => {
    if (bubblesRef.current.get(ring)?.id !== id) return;
    const next = new Map(bubblesRef.current); next.delete(ring);
    bubblesRef.current = next; setBubbles(next);
  }, []);
  useEffect(() => {
    const timers = bubbleTimers.current;
    sayRef.current = (ring) => {
      const now = performance.now();
      if (!canSayAgain(bubblesRef.current.get(ring)?.at, now)) return false;
      const id = ++bubbleSeq.current;
      const next = new Map(bubblesRef.current); next.set(ring, { id, at: now });
      bubblesRef.current = next; setBubbles(next);
      const t = window.setTimeout(() => { timers.delete(t); unsay(ring, id); }, BUBBLE_MS + 200);
      timers.add(t);
      return true;
    };
    return () => { sayRef.current = null; for (const t of timers) window.clearTimeout(t); timers.clear(); };
  }, [sayRef, unsay]);

  const readied = useRef(false);
  const frontReady = useCallback(() => {
    if (readied.current) return;
    readied.current = true;
    setSides(true);
    onReady();
  }, [onReady]);

  return (
    <>
      {slots.map(({ key, ring, live }) => { const said = bubbles.get(ring); return (
        <div key={`${key}-${size}`} className="lp-hero-slot" style={{ visibility: "hidden" }}
          ref={(el) => { if (el) els.current.set(key, el); else els.current.delete(key); }}>
          <BrendaCharacter size={size} look={{ colour: RING[ring], visor: "bean", eyes: "pill" }} state={MOODS[RING[ring]].state}
            face={MOODS[RING[ring]].face ?? null} glow="own-always" quiet interactive={false}
            label={`Brenda in ${RING[ring]}`} still={!live}
            ref={(h) => { if (h) chars.current.set(key, h); else chars.current.delete(key); }}
            onReady={frontReady} />
          {said ? <HeroBubble key={said.id} colour={RING[ring]} onDone={() => unsay(ring, said.id)} /> : null}
        </div>
      ); })}
    </>
  );
}
