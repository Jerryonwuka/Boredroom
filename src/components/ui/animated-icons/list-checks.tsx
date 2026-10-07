"use client";

// Boredroom's own animation for lucide's ListChecks (lucide-animated has none), in the same idiom.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The two ticks are drawn again, one after the other.
const TICK: Variants = { normal: { pathLength: 1, opacity: 1 }, animate: (i: number) => ({ pathLength: [0, 1], opacity: [0, 1], transition: { delay: i * 0.15, duration: 0.35, ease: "easeInOut" } }) };

export const AnimatedListChecks = createAnimatedIcon({
  name: "list-checks",
  children: (
    <>
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <motion.path d="m3 17 2 2 4-4" custom={1} variants={TICK} />
      <motion.path d="m3 7 2 2 4-4" custom={0} variants={TICK} />
    </>
  ),
});
