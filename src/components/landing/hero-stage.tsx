"use client";

/**
 * The landing hero's stage (owner request, 10 October 2026): Brenda in every colour, floating with no circle as on her
 * home, the one in front large and the others smaller and further back; swipe, drag, click, the arrow keys, the Previous
 * and Next buttons or the dots bring another to the front, and the backdrop's blurred glow turns to her colour. Behind
 * them one slow drift of light over a still grain (globals.css §6, `.lp-hero*`). Contract: scratchpad landing-spec A.
 *
 * This file is the section and everything that answers the person: the backdrop's colour, the pointer and keys, the
 * controls and live region, the bounded autoplay and the arrival. The characters themselves (the canvas engine) are a
 * separate chunk, fetched after hydration and mounted on idle (hero-carousel.tsx), so they never hold up the first
 * paint: the headline, lead and buttons arrive as server HTML (`children`) and the stage keeps its height meanwhile.
 * Without script, or if the chunk or the canvas fails, the hero is the same, quiet, with the controls hidden.
 *
 * Motion: one number, `active` (hero-assistants.ts), places every Brenda; buttons glide it, a release springs it with no
 * overshoot, reduced motion jumps it. Autoplay is gentle and bounded: one step every 7 s from 4 s after they arrive,
 * one full turn and then it rests; never under reduced motion; it waits while the pointer or focus is on the carousel,
 * the hero is off screen, the tab is hidden or the page's Pause is on, and stops for good once the person takes over.
 *
 * Speech bubbles (owner request, 10 October 2026): clicking the Brenda in front, or pressing the keyboard stand-in for
 * her (a focusable circle over her, outside the hidden stage), makes her say her short line from MOODS in a bubble that
 * rises from her head and fades (hero-bubble.tsx); so does a Brenda arriving in front because the person brought her
 * (a click, drag, key, button or dot; never autoplay). The bubble itself is hidden from assistive technology and the
 * live region reads the words instead. Under reduced motion it fades in and out without travelling.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { animate, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { EASE } from "@/components/ui/motion";
import { PauseMotion } from "@/components/landing/pause-motion";
import { WRAP } from "@/components/landing/parts";
import type { BrendaEmote } from "@/lib/brenda-character/engine";
import { PALETTE } from "@/lib/assistant-look";
import {
  AUTOPLAY_EVERY_MS, AUTOPLAY_FIRST_MS, AUTOPLAY_STEPS, DRAG_SLOP, RELEASE_SPRING, RING, SLOT_TRAVEL, SPREAD_MS, STEP_EASE,
  MOODS, colourWord, hitTest, liveLabel, nearestFor, releaseTarget, ringIndex, sayLabel, stepDuration, tintStyle,
} from "@/components/landing/hero-assistants";
import { cn } from "@/lib/utils";

const HeroCarousel = dynamic(() => import("@/components/landing/hero-carousel").then((m) => m.HeroCarousel), { ssr: false });

// ---- Page-wide motion signals (shared with FlipLine) ----------------------------------------------------------------

const onMotionAttr = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => o.disconnect();
};
/** Whether the page's Pause is on (`<html data-motion="paused">`, pause-motion.tsx). */
export function useMotionPaused() {
  return useSyncExternalStore(onMotionAttr, () => document.documentElement.dataset.motion === "paused", () => false);
}
const onVisibility = (cb: () => void) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); };
/** Whether the tab is visible. */
export function usePageVisible() {
  return useSyncExternalStore(onVisibility, () => document.visibilityState === "visible", () => true);
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const onReduce = (cb: () => void) => { const m = window.matchMedia(REDUCE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
/**
 * Reduced motion, false on the server and in the hydrating render, then the real setting (review fix, 10 October 2026:
 * motion's useReducedMotion reads it in the hydrating render, so attributes the server drew with false, such as the live
 * region's, were never corrected).
 */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(onReduce, () => window.matchMedia(REDUCE).matches, () => false);
}

/** The first idle moment (or 200 ms where there is no requestIdleCallback), cancellable. */
export function onIdle(fn: () => void, timeout = 1200): () => void {
  if (typeof window.requestIdleCallback === "function") { const id = window.requestIdleCallback(fn, { timeout }); return () => window.cancelIdleCallback(id); }
  const t = window.setTimeout(fn, 200); return () => window.clearTimeout(t);
}

/**
 * What the carousel hands back so the stage can make a Brenda react (her own reaction when she arrives or is clicked).
 * `burst: false` when her bubble rises with it: the reaction plays without its particles, so hearts, stars and sparks
 * never fly through her words (review fix, 10 October 2026).
 */
export type EmoteFn = (ring: number, e: BrendaEmote, burst?: boolean) => void;
/** What the carousel hands back so the stage can make a Brenda speak: false when hers is still showing (one at a time). */
export type SayFn = (ring: number) => boolean;

export function HeroStage({ pill, children }: { pill: ReactNode; children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const paused = useMotionPaused();
  const visible = usePageVisible();

  /** The front Brenda's size (CSS `--u`, the one source), read on mount and on resize; null until read. */
  const [u, setU] = useState<number | null>(null);
  const phone = u !== null && u < 200;
  /** The carousel chunk is mounted after the first idle moment. */
  const [load, setLoad] = useState(false);
  /** The front Brenda is drawn: the controls show and the sides spread out. */
  const [ready, setReady] = useState(false);
  /** The ring index nearest the front (the backdrop's colour, the chosen dot): changes as a Brenda passes halfway. */
  const [near, setNear] = useState(0);
  /** What the live region says: where the one in front is, and what she said if she spoke. */
  const [live, setLive] = useState(() => liveLabel(0));
  /** The person has dragged, clicked or pressed something in the carousel: autoplay stops for good, the region speaks.
   * Under reduced motion (no autoplay) the region is live from the start (review fix, 10 October 2026: turning it on in the
   * same update as the first change could leave the first press unannounced). */
  const [engaged, setEngaged] = useState(false);
  const [hover, setHover] = useState({ stage: false, controls: false });
  const [focusIn, setFocusIn] = useState(false);
  const [inView, setInView] = useState(true);
  const [autoSteps, setAutoSteps] = useState(0);

  const active = useMotionValue(0);
  const spread = useMotionValue(0);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  /** The whole position last aimed at (so a second press while gliding goes one further); null while dragging. */
  const aim = useRef<number | null>(0);
  const settledRef = useRef(0);
  const emote = useRef<EmoteFn | null>(null);
  const say = useRef<SayFn | null>(null);
  const liveTimer = useRef(0);
  const drag = useRef<{ id: number; x0: number; a0: number; moved: boolean } | null>(null);

  // The chunk starts downloading at once; it mounts on the first idle moment, after the page has hydrated and painted.
  useEffect(() => {
    void import("@/components/landing/hero-carousel");
    return onIdle(() => setLoad(true));
  }, []);

  // u from CSS, again after a resize (debounced); a new u means new canvases (the carousel keys its slots by it).
  useEffect(() => {
    const read = () => {
      const v = stage.current ? parseFloat(getComputedStyle(stage.current).getPropertyValue("--u")) : NaN;
      if (Number.isFinite(v) && v > 0) setU(v);
    };
    read();
    let t = 0;
    const onResize = () => { window.clearTimeout(t); t = window.setTimeout(read, 150); };
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, []);

  // In view (a quarter of the hero, for autoplay) and off screen entirely (pauses the drift, globals.css §6).
  useEffect(() => {
    const el = section.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      setInView(e.intersectionRatio >= 0.25);
      el.toggleAttribute("data-offscreen", !e.isIntersecting);
    }, { threshold: [0, 0.25] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useMotionValueEvent(active, "change", (v) => setNear(ringIndex(v)));

  useEffect(() => () => window.clearTimeout(liveTimer.current), []);

  /** A Brenda settles in front: her reaction, and her bubble too when the person brought her (`speak`). */
  const settle = useCallback((to: number, speak = false) => {
    const i = ringIndex(to);
    if (i === settledRef.current) return;
    settledRef.current = i;
    const own = MOODS[RING[i]].emote;
    const said = speak && (say.current?.(i) ?? false);
    if (!reduced && own) emote.current?.(i, own, !said);
    window.clearTimeout(liveTimer.current);
    setLive(liveLabel(i, said));
  }, [reduced]);

  /**
   * The Brenda in front is clicked or activated: her reaction (a wink if she has none; never a poke, never a sound) and
   * her bubble, read out by the live region. Emptied first, so the same words twice in a row are read twice.
   */
  const speakFront = useCallback(() => {
    const i = ringIndex(active.get());
    const said = say.current?.(i) ?? false;
    if (!reduced) emote.current?.(i, MOODS[RING[i]].emote ?? "wink", !said);
    if (!said) return;
    setLive("");
    window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(() => setLive(sayLabel(i)), 80);
  }, [active, reduced]);

  /**
   * Brings the whole position `to` to the front: a glide (buttons, keys, dots, autoplay, a click) or a spring (a
   * release). `speak`: the person brought her, so her bubble rises as she settles.
   */
  const go = useCallback((to: number, { spring, speak = false }: { spring?: { velocity: number }; speak?: boolean } = {}) => {
    anim.current?.stop();
    aim.current = to;
    if (reduced) { active.set(to); settle(to, speak); return; }
    const done = () => settle(to, speak);
    anim.current = spring
      ? animate(active, to, { ...RELEASE_SPRING, velocity: spring.velocity, onComplete: done })
      : animate(active, to, { duration: stepDuration(to - active.get()) / 1000, ease: STEP_EASE, onComplete: done });
  }, [active, reduced, settle]);

  const takeOver = () => setEngaged(true);
  const from = () => aim.current ?? Math.round(active.get());
  const step = (n: number) => { takeOver(); go(from() + n, { speak: true }); };
  const pick = (i: number) => { takeOver(); go(nearestFor(i, from()), { speak: true }); };

  // The arrival: the front one is drawn, then the sides glide out from behind her; she reacts when they are in place.
  const onReady = useCallback(() => {
    setReady(true);
    if (reduced) { spread.set(1); return; }
    animate(spread, 1, { duration: SPREAD_MS / 1000, ease: EASE, onComplete: () => {
      const own = MOODS[RING[settledRef.current]].emote;
      if (own) emote.current?.(settledRef.current, own);
    } });
  }, [reduced, spread]);

  // Autoplay, gentle and bounded (decision 7 of the contract).
  const autoplay = ready && !reduced && !paused && visible && inView && !hover.stage && !hover.controls && !focusIn && !engaged && autoSteps < AUTOPLAY_STEPS;
  useEffect(() => {
    if (!autoplay) return;
    const t = window.setTimeout(() => { setAutoSteps((n) => n + 1); go(from() + 1); }, autoSteps === 0 ? AUTOPLAY_FIRST_MS : AUTOPLAY_EVERY_MS);
    return () => window.clearTimeout(t);
    // `from` reads refs only; the timer restarts on each step and whenever autoplay may run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, autoSteps, go]);

  // ---- The pointer: drag or swipe to turn the ring, click a Brenda to bring her to the front ----
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - r.top };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!ready || !u || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x0: e.clientX, a0: active.get(), moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current, el = e.currentTarget;
    if (d && d.id === e.pointerId && u) {
      if (!d.moved) {
        if (Math.abs(e.clientX - d.x0) <= DRAG_SLOP) return;
        d.moved = true; d.x0 = e.clientX; d.a0 = active.get();
        anim.current?.stop(); aim.current = null; takeOver();
        el.setPointerCapture(e.pointerId); el.toggleAttribute("data-dragging", true);
      }
      active.set(d.a0 - (e.clientX - d.x0) / (SLOT_TRAVEL * u));
      return;
    }
    if (e.pointerType !== "mouse" || !ready || !u) return;
    const p = point(e), hit = hitTest(p.x, p.y, active.get(), u, phone);
    el.toggleAttribute("data-over-slot", hit !== null && hit !== ringIndex(active.get()));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.toggleAttribute("data-dragging", false);
    if (d.moved) {
      const v = active.getVelocity();
      go(cancelled ? Math.round(active.get()) : releaseTarget(active.get(), v), { spring: { velocity: cancelled ? 0 : v }, speak: !cancelled });
      return;
    }
    if (cancelled || !u) return;
    const p = point(e), hit = hitTest(p.x, p.y, active.get(), u, phone);
    if (hit === null) return;
    takeOver();
    // The one in front plays her own reaction and says her line; any other comes to the front, the shortest way round,
    // and says hers as she arrives.
    if (hit === ringIndex(active.get())) speakFront();
    else go(nearestFor(hit, from()), { speak: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  };

  return (
    <section ref={section} className="lp-hero" aria-labelledby="hero-title" style={tintStyle(RING[near]) as CSSProperties}>
      <div aria-hidden className="lp-hero-backdrop">
        <div className="lp-hero-drift" />
        <div className="lp-hero-grain" />
      </div>
      <div className={cn(WRAP, "relative text-center")}>
        {pill}
        <div className="relative mt-3 sm:mt-4 lg:mt-5">
        <div ref={stage} aria-hidden className="lp-hero-stage"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover((h) => ({ ...h, stage: true })); }}
          onPointerLeave={(e) => { e.currentTarget.toggleAttribute("data-over-slot", false); setHover((h) => ({ ...h, stage: false })); }}>
          {load && u ? (
            <HeroCarousel active={active} spread={spread} size={u} phone={phone} still={paused} reduced={reduced} onReady={onReady} emoteRef={emote} sayRef={say} />
          ) : null}
        </div>
        {/* The keyboard's way to the Brenda in front (the stage is hidden from assistive technology and takes the
            pointer itself): a circle over her ball that shows only its focus ring. */}
        {ready ? (
          <button type="button" className="pointer-events-none absolute left-1/2 top-[calc(var(--u)*0.175)] size-[calc(var(--u)*0.9)] -translate-x-1/2 rounded-full"
            aria-label={`Hear what Brenda in ${colourWord(RING[near])} says`}
            onClick={() => { takeOver(); speakFront(); }} onKeyDown={onKeyDown}
            onFocus={() => setFocusIn(true)} onBlur={() => setFocusIn(false)} />
        ) : null}
        </div>
        {children}
        <div ref={group} role="group" aria-roledescription="carousel" aria-label="Brenda in every colour"
          data-ready={ready ? "" : undefined} className="lp-hero-controls mt-8 sm:mt-10"
          onKeyDown={onKeyDown}
          onFocus={() => setFocusIn(true)}
          onBlur={(e) => { if (!group.current?.contains(e.relatedTarget as Node | null)) setFocusIn(false); }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover((h) => ({ ...h, controls: true })); }}
          onPointerLeave={() => setHover((h) => ({ ...h, controls: false }))}>
          <IconButton variant="round" aria-label="Previous Brenda" aria-controls="hero-assistant-now" onClick={() => step(-1)}
            className="border border-border-input text-foreground pointer-coarse:size-10"><ChevronLeft /></IconButton>
          {/* Pointer shortcuts only: Previous and Next reach every colour, so the dots stay out of the tab order. */}
          <div aria-hidden className="lp-hero-dots">
            {RING.map((c, i) => (
              <button key={c} type="button" tabIndex={-1} className="lp-hero-dot" data-tip={PALETTE[c].label}
                data-active={i === near ? "" : undefined} style={{ "--dot": PALETTE[c].sphere.mid } as CSSProperties}
                onClick={() => pick(i)} />
            ))}
          </div>
          <IconButton variant="round" aria-label="Next Brenda" aria-controls="hero-assistant-now" onClick={() => step(1)}
            className="border border-border-input text-foreground pointer-coarse:size-10"><ChevronRight /></IconButton>
          <PauseMotion className="ml-1" />
          <p id="hero-assistant-now" className="sr-only" aria-live={reduced || engaged ? "polite" : "off"} aria-atomic>{live}</p>
        </div>
      </div>
    </section>
  );
}
