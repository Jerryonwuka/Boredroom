"use client";

/**
 * "team is {doing → stuck on → waiting on → delivering}": adapted from Aceternity UI's FlipWords as used on the live
 * site's hero (owner request, 10 October 2026: bring back the text animation the owner likes). Rewritten for v4: a tween
 * where the original's spring bounced, no trailing space or padding, spans throughout (it sits inside the h1), and the
 * colour is the headline's own (white on dark), not orange.
 *
 * The first word is server-rendered as plain text at full opacity, so "team is doing" is in the HTML, paints without
 * script and stays part of the h1's own paint (nothing in the line is positioned or inline-block until it starts:
 * Chrome measures text in its own inline-block apart from the h1). When it starts, the line is built once: every word
 * stacked in one grid cell, and from then on a flip only changes attributes, opacity and transform (review fix,
 * 10 October 2026: inserting a node per letter on every flip made the browser recalculate the whole page's style, a
 * long task every 3 seconds). The word arriving rises in; the one leaving lifts away up and to the right, growing (the
 * live site's exit, without the blur). The cell is as wide as the longest word, so the line is moved sideways (a
 * transform) to keep the word showing centred, gliding when its width changes.
 *
 * It flips only while it can be seen: not under reduced motion, not while the page's Pause is on, not in a hidden tab
 * and not off screen. The hero gives the h1 a fixed accessible name, so nothing is announced as the words change.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { useMotionPaused, usePageVisible } from "@/components/landing/hero-stage";

export function FlipLine({ prefix, words, interval = 3000 }: { prefix: string; words: readonly string[]; interval?: number }) {
  const line = useRef<HTMLSpanElement>(null);
  const cell = useRef<HTMLSpanElement>(null);
  const inView = useInView(line);
  const reduced = useReducedMotion();
  const paused = useMotionPaused();
  const visible = usePageVisible();
  /** How many flips so far; the word shown is words[flips % length]. */
  const [flips, setFlips] = useState(0);
  /** The stacked line is built (once, the first time it may run). */
  const [built, setBuilt] = useState(false);
  /** Each word's width (px), measured once built and again when the type size changes. */
  const [widths, setWidths] = useState<number[] | null>(null);
  const running = !reduced && !paused && visible && inView && words.length > 1;

  // Built the first time it may run, and never unbuilt (state set during render: React re-renders at once).
  if (running && !built) setBuilt(true);

  // One timer at a time, restarted after each flip (StrictMode-safe: the cleanup clears it).
  useEffect(() => {
    if (!running || !built) return;
    const t = window.setTimeout(() => setFlips((n) => n + 1), interval);
    return () => window.clearTimeout(t);
  }, [running, built, flips, interval]);

  // Widths before the first built paint, so the line never jumps sideways; offsetWidth ignores the words' transforms.
  useLayoutEffect(() => {
    const el = cell.current;
    if (!built || !el) return;
    const read = () => setWidths(Array.from(el.children, (c) => (c as HTMLElement).offsetWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [built]);

  const cur = flips % words.length, prev = (flips - 1 + words.length) % words.length;
  const shift = built && widths ? (Math.max(...widths) - widths[cur]) / 2 : 0;
  // One element for the line throughout, so the in-view observer keeps watching it once the line is built.
  return (
    <span ref={line} className={built ? "lp-flip-line" : "whitespace-nowrap"} data-glide={flips > 0 ? "" : undefined} style={built ? { transform: `translateX(${shift.toFixed(1)}px)` } : undefined}>
      {built ? (
        <>
          {prefix}{" "}
          <span ref={cell} className="lp-flip-cell">
            {words.map((w, i) => (
              <span key={w} className="lp-flip-word" data-state={i === cur ? "on" : flips > 0 && i === prev ? "out" : undefined}>{w}</span>
            ))}
          </span>
        </>
      ) : <>{prefix} {words[0]}</>}
    </span>
  );
}
