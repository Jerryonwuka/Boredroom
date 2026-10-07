"use client";

/**
 * Brenda's face as a line icon (owner decision, 5 October 2026: no generic AI icons anywhere; where something means
 * Brenda, it shows her face). Drawn on the same 24px grid, stroke and caps as the lucide icons beside it, so it sits in
 * the sidebar, on buttons and in empty states like any other icon: her rounded screen and her two pill eyes.
 *
 * Animated like the other icons (owner request, 7 October 2026; components/ui/animated-icons): while her control is
 * hovered or focused from the keyboard she blinks and glances to one side and the other; when you arrive on her page
 * (her nav item becomes the current page) she gives a happy squint, her eyes turning to little arcs for a moment. Never
 * on a loop, and still under reduced motion. Each eye is one quadratic stroke so it can bend: at rest it is drawn
 * straight, the same line as before.
 */
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/animated-icons/adapter";

/** One eye at rest (a straight 3.5px stroke), blinking (a dot) and squinting happily (an arc), centred on `x`. */
const eye = (x: number) => ({
  rest: `M${x} 10.25Q${x} 12 ${x} 13.75`,
  blink: `M${x} 11.85Q${x} 12 ${x} 12.15`,
  happy: `M${x - 1.25} 12.75Q${x} 10.25 ${x + 1.25} 12.75`,
});

const eyeVariants = (x: number): Variants => {
  const d = eye(x);
  return {
    normal: { d: d.rest, transition: { duration: 0.2, ease: "easeOut" } },
    animate: { d: [d.rest, d.blink, d.rest], transition: { duration: 0.24, times: [0, 0.5, 1], ease: "easeInOut" } },
    arrive: { d: [d.rest, d.happy, d.happy, d.rest], transition: { duration: 1.3, times: [0, 0.2, 0.8, 1], ease: "easeInOut" } },
  };
};

/** The glance: a look to the right, then to the left, then back, after the blink. */
const GLANCE: Variants = {
  normal: { x: 0 },
  animate: { x: [0, 0, 1.25, 1.25, -1.25, -1.25, 0], transition: { duration: 1.2, times: [0, 0.18, 0.3, 0.48, 0.62, 0.82, 1], ease: "easeInOut" } },
  arrive: { x: 0 },
};

export const BrendaGlyph = createAnimatedIcon({
  name: "brenda-glyph",
  arrive: "arrive",
  children: (
    <>
      <rect x="2.5" y="5" width="19" height="14.5" rx="5.5" />
      <motion.g variants={GLANCE}>
        <motion.path d={eye(9.5).rest} variants={eyeVariants(9.5)} />
        <motion.path d={eye(14.5).rest} variants={eyeVariants(14.5)} />
      </motion.g>
    </>
  ),
});
