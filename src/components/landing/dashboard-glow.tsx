"use client";

import { useEffect, useRef } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import styles from "./dashboard-glow.module.css";

/**
 * The orange light behind the "Everything in view" dashboard card (owner request, 10 October 2026: "this should have a
 * glowing gradient behind it, maybe orange, and find a way to cleanly animate it in a classy sleek manner"). Brand
 * orange, slow and soft, light behind glass; it never competes with the hero. The styles and the reasons are in
 * dashboard-glow.module.css.
 *
 * The warm-up (chosen from three variants, integration, 10 October 2026): the light is all but out while the card is
 * tilted under the hero, warms and spreads as it straightens (most of the warmth in the last third), and once the card
 * has been flat it breathes very gently. A still 1px highlight on the card's top rim, where the light meets the glass,
 * warms with it (`DashboardRim`).
 *
 * Its slow loops start only once the card has been flat, and pause while the light is off screen (review fix, 10 October
 * 2026: `data-offscreen` on the field, as the hero pauses its own drift).
 *
 * The server renders the starting state (the scroll-linked values at progress 0), so the first paint matches. All of
 * it is decoration: `aria-hidden`, no pointer events, nothing focusable.
 */

// [from, knee, to] of the card's straightening (0 tilted, 1 flat) and what the light does there.
const PROGRESS = [0, 0.55, 1];
const WARMTH = [0, 0.25, 1];
const SPREAD = [0.75, 0.85, 1];
const STILL = [1, 1, 1];

/**
 * The light behind the card: a sibling placed before the card inside its (untransformed) wrapper, so it stays flat
 * while the card tilts, and paints under it.
 */
export function DashboardGlow({ progress, reduced }: { progress: MotionValue<number>; reduced: boolean }) {
  const warm = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = field.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => el.toggleAttribute("data-offscreen", !e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const opacity = useTransform(progress, PROGRESS, reduced ? STILL : WARMTH);
  const scale = useTransform(progress, PROGRESS, reduced ? STILL : SPREAD);
  // A one-way latch: once the card has been flat, the light breathes from its resting values, so it never jumps.
  useMotionValueEvent(progress, "change", (v) => {
    if (v > 0.97 && warm.current) warm.current.dataset.settled = "";
  });
  return (
    <div ref={field} aria-hidden className={styles.field}>
      <motion.div ref={warm} className={styles.warm} style={{ opacity, scale }}>
        <span className={`${styles.light} ${styles.b1}`} />
        <span className={`${styles.light} ${styles.b2}`} />
      </motion.div>
    </div>
  );
}

/**
 * The top rim of the card catching the light: a still 1px warm line, placed inside the card (so it follows the tilt)
 * over its top border. It warms with the light behind.
 */
export function DashboardRim({ progress, reduced }: { progress: MotionValue<number>; reduced: boolean }) {
  const opacity = useTransform(progress, PROGRESS, reduced ? STILL : WARMTH);
  return <motion.span aria-hidden className={styles.rim} style={{ opacity }} />;
}
