"use client";

/**
 * Brenda's face as a line icon (owner decision, 5 October 2026: no generic AI icons anywhere; where something means
 * Brenda, it shows her face). Drawn on the same 24px grid, stroke and caps as the lucide icons beside it, so it sits in
 * the sidebar, on buttons and in empty states like any other icon. Her look (owner design, 7 October 2026; her coat,
 * 8 October 2026): the tufted outline of her fluffy head and her visor filled in `currentColor`, with her two pill eyes
 * cut out of it.
 *
 * Animated like the other icons (owner request, 7 October 2026; components/ui/animated-icons): while her control is
 * hovered or focused from the keyboard she blinks and glances to one side and the other; when you arrive on her page
 * (her nav item becomes the current page) she gives a happy squint, her eyes turning to little arcs for a moment. Never
 * on a loop, and still under reduced motion. Each eye is one quadratic stroke so it can bend: at rest it is drawn
 * straight, the same line as before.
 */
import { useId } from "react";
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/animated-icons/adapter";

/** One eye at rest (a short straight stroke), blinking (a dot) and squinting happily (an arc), centred on `x`. */
const eye = (x: number) => ({
  rest: `M${x} 10.2Q${x} 11 ${x} 11.8`,
  blink: `M${x} 10.95Q${x} 11 ${x} 11.05`,
  happy: `M${x - 1} 11.6Q${x} 9.8 ${x + 1} 11.6`,
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
  animate: { x: [0, 0, 1, 1, -1, -1, 0], transition: { duration: 1.2, times: [0, 0.18, 0.3, 0.48, 0.62, 0.82, 1], ease: "easeInOut" } },
  arrive: { x: 0 },
};

/** Her fluffy head: ten soft tufts round a 9.5px circle, a little longer below, as her coat. */
const COAT = "M12 3.4Q15.51 1.21 17.05 5.04Q21.31 5.24 20.18 9.34Q23.77 12 20.18 14.66Q21.74 19.07 17.05 18.96Q15.77 23.6 12 20.6Q8.23 23.6 6.95 18.96Q2.26 19.07 3.82 14.66Q.23 12 3.82 9.34Q2.69 5.24 6.95 5.04Q8.49 1.21 12 3.4Z";

/** Her visor: rounded over each eye with a soft dip between them, a broad curve beneath. */
const VISOR = "M4.7 10C4.7 7.2 5.6 6.3 8.3 6.3C10.2 6.3 10.8 7.6 12 7.6C13.2 7.6 13.8 6.3 15.7 6.3C18.4 6.3 19.3 7.2 19.3 10C19.3 13 16.6 14.4 12 14.4C7.4 14.4 4.7 13 4.7 10Z";

/** The visor, filled, with the eyes (which blink and glance with the icon) cut out of it through a mask of its own. */
function Visor() {
  const id = `brenda-visor-${useId().replace(/:/g, "")}`;
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <motion.g variants={GLANCE} stroke="#000" strokeWidth={1.5}>
          <motion.path d={eye(8.8).rest} variants={eyeVariants(8.8)} />
          <motion.path d={eye(15.2).rest} variants={eyeVariants(15.2)} />
        </motion.g>
      </mask>
      {/* A touch smaller than her drawn visor so it clears the tufted outline. */}
      <path d={VISOR} fill="currentColor" strokeWidth={1} mask={`url(#${id})`} transform="translate(12 10.6) scale(.88) translate(-12 -10.6)" />
    </>
  );
}

export const BrendaGlyph = createAnimatedIcon({
  name: "brenda-glyph",
  arrive: "arrive",
  children: (
    <>
      <path d={COAT} />
      <Visor />
    </>
  ),
});
