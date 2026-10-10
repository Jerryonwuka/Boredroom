"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Arrivals for the landing page's sections (owner request, 10 October 2026: "add other animations on other sections in
 * the website"). Restrained and once per visit: a block, or the parts of a picture in the order its story happens, rises
 * into place the first time it scrolls into view, and never again.
 *
 * The server renders every finished state. On hydration `ArrivalObserver` arms only what is still below the fold
 * (`data-lp-armed`: its `.lp-item`s, or the element itself, wait at their starting pose), and sets `data-lp-arrived` as
 * each comes into view, which plays the CSS keyframe (globals.css §6, "Arrivals"). So without script, already on screen,
 * or with reduced motion, nothing is ever hidden; only opacity and transform change, so nothing shifts the layout.
 *
 * Markup contract: `data-lp-arrive` marks a trigger; `.lp-item` marks what moves inside it (or the trigger itself);
 * `--lp-i` staggers by 70ms steps, `--lp-d` sets an exact delay, `--lp-from` the starting transform. `.lp-reveal` blocks
 * are triggers that move themselves. Triggers are never nested.
 */

const TRIGGERS = "[data-lp-arrive], .lp-reveal";
const REDUCE = "(prefers-reduced-motion: reduce)";
/** Fires when a trigger's top is 8% above the bottom of the screen. */
const MARGIN = "0px 0px -8% 0px";

/** Is the element still below the fold, so arming it hides nothing anyone has seen? */
const belowFold = (el: Element) => el.getBoundingClientRect().top > window.innerHeight;

export function ArrivalObserver() {
  useEffect(() => {
    if (window.matchMedia(REDUCE).matches || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).dataset.lpArrived = "";
        io.unobserve(e.target);
      }
    }, { rootMargin: MARGIN });
    // Read every position first, then write, so arming costs one layout rather than one per trigger.
    const armed = [...document.querySelectorAll<HTMLElement>(TRIGGERS)].filter(belowFold);
    for (const el of armed) { el.dataset.lpArmed = ""; io.observe(el); }
    return () => io.disconnect();
  }, []);
  return null;
}

/**
 * A number that counts up to its value the first time it scrolls into view (once, 1.1 s, easing out). The server and
 * reduced motion show the value; the width is held by an invisible copy of it, so the count never moves the layout, and
 * assistive technology reads only the final value.
 */
export function CountUp({ value, suffix = "", className, delay = 250 }: { value: number; /** Text after the number ("h"); a string, so a server component can pass it. */ suffix?: string; className?: string; delay?: number }) {
  const format = (n: number) => `${n}${suffix}`;
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia(REDUCE).matches || !("IntersectionObserver" in window) || !belowFold(el)) return;
    let raf = 0, timer = 0;
    // Below the fold, unseen: start from zero, then count when it arrives.
    setShown(0);
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      timer = window.setTimeout(() => {
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1100);
          setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, delay);
    }, { rootMargin: MARGIN });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [value, delay]);
  return (
    <span ref={ref} className={`inline-grid tabular-nums ${className ?? ""}`}>
      <span className="invisible [grid-area:1/1]">{format(value)}</span>
      <span aria-hidden className="text-right [grid-area:1/1]">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
