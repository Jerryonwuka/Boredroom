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
 *
 * Personal assistants (owner decision, 7 October 2026): the glyph is the assistant in context (the person's own, or the
 * nearest `AssistantScope`'s), drawn with its visor's shape (bean, band or screen) inside the same tufted head. Round eyes are dots; pill and square
 * eyes keep the short stroke (at this size a square reads as a pill). There is no colour here: the glyph keeps the icon
 * colour rules, so the sidebar's active orange and the greys apply as to any icon.
 */
import { useId } from "react";
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "@/components/ui/animated-icons/adapter";
import { useScopedAssistant } from "@/components/app/assistant-context";
import { isAssistantVisor, type AssistantVisor } from "@/lib/assistant-look";

/** One eye at rest (a short straight stroke), blinking (a dot) and squinting happily (an arc), centred on `x`. */
const eye = (x: number) => ({
  rest: `M${x} 10.2Q${x} 11 ${x} 11.8`,
  blink: `M${x} 10.95Q${x} 11 ${x} 11.05`,
  happy: `M${x - 1} 11.6Q${x} 9.8 ${x + 1} 11.6`,
});
/**
 * A round eye (personal assistants, 7 October 2026): a dot at rest (a thicker stroke), a short flat line while it
 * blinks (the stroke thins), and the same happy arc as the pill eye.
 */
const roundEye = (x: number) => ({
  rest: `M${x} 10.9Q${x} 11 ${x} 11.1`,
  blink: `M${x - 0.7} 11.1Q${x} 11.1 ${x + 0.7} 11.1`,
  happy: eye(x).happy,
});
const ROUND_STROKE = 2.2, PILL_STROKE = 1.6;

const eyeVariants = (x: number): Variants => {
  const d = eye(x);
  return {
    normal: { d: d.rest, transition: { duration: 0.2, ease: "easeOut" } },
    animate: { d: [d.rest, d.blink, d.rest], transition: { duration: 0.24, times: [0, 0.5, 1], ease: "easeInOut" } },
    arrive: { d: [d.rest, d.happy, d.happy, d.rest], transition: { duration: 1.3, times: [0, 0.2, 0.8, 1], ease: "easeInOut" } },
  };
};
const roundEyeVariants = (x: number): Variants => {
  const d = roundEye(x);
  return {
    normal: { d: d.rest, strokeWidth: ROUND_STROKE, transition: { duration: 0.2, ease: "easeOut" } },
    animate: { d: [d.rest, d.blink, d.rest], strokeWidth: [ROUND_STROKE, 1.2, ROUND_STROKE], transition: { duration: 0.24, times: [0, 0.5, 1], ease: "easeInOut" } },
    arrive: { d: [d.rest, d.happy, d.happy, d.rest], strokeWidth: [ROUND_STROKE, PILL_STROKE, PILL_STROKE, ROUND_STROKE], transition: { duration: 1.3, times: [0, 0.2, 0.8, 1], ease: "easeInOut" } },
  };
};

/** The glance: a look to the right, then to the left, then back, after the blink. */
const GLANCE: Variants = {
  normal: { x: 0 },
  animate: { x: [0, 0, 1, 1, -1, -1, 0], transition: { duration: 1.2, times: [0, 0.18, 0.3, 0.48, 0.62, 0.82, 1], ease: "easeInOut" } },
  arrive: { x: 0 },
};

/** Her fluffy head (her coat, 8 October 2026): ten soft tufts round a 9.5px circle, a little longer below. Every
 *  assistant wears it, whichever visor it has. */
const COAT = "M12 3.4Q15.51 1.21 17.05 5.04Q21.31 5.24 20.18 9.34Q23.77 12 20.18 14.66Q21.74 19.07 17.05 18.96Q15.77 23.6 12 20.6Q8.23 23.6 6.95 18.96Q2.26 19.07 3.82 14.66Q.23 12 3.82 9.34Q2.69 5.24 6.95 5.04Q8.49 1.21 12 3.4Z";

/**
 * The visors on the 24px grid. Bean (hers): rounded over each eye with a soft dip between them, a broad curve beneath.
 * Band: a wide, slim capsule across the face. Screen: a rounded rectangle, taller and narrower. The eyes fit each.
 */
const VISOR: Record<AssistantVisor, string> = {
  bean: "M4.7 10C4.7 7.2 5.6 6.3 8.3 6.3C10.2 6.3 10.8 7.6 12 7.6C13.2 7.6 13.8 6.3 15.7 6.3C18.4 6.3 19.3 7.2 19.3 10C19.3 13 16.6 14.4 12 14.4C7.4 14.4 4.7 13 4.7 10Z",
  band: "M6.6 8.6H17.4A2.4 2.4 0 0 1 17.4 13.4H6.6A2.4 2.4 0 0 1 6.6 8.6Z",
  screen: "M8.4 6.4H15.6A2.2 2.2 0 0 1 17.8 8.6V12A2.2 2.2 0 0 1 15.6 14.2H8.4A2.2 2.2 0 0 1 6.2 12V8.6A2.2 2.2 0 0 1 8.4 6.4Z",
};

/** The visor, filled, with the eyes (which blink and glance with the icon) cut out of it through a mask of its own. */
function Visor() {
  const id = `brenda-visor-${useId().replace(/:/g, "")}`;
  const { visor, eyes } = useScopedAssistant();
  const round = eyes === "round";
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <motion.g variants={GLANCE} stroke="#000" strokeWidth={PILL_STROKE}>
          {round ? (
            <>
              <motion.path key="round-l" d={roundEye(8.8).rest} strokeWidth={ROUND_STROKE} variants={roundEyeVariants(8.8)} />
              <motion.path key="round-r" d={roundEye(15.2).rest} strokeWidth={ROUND_STROKE} variants={roundEyeVariants(15.2)} />
            </>
          ) : (
            <>
              <motion.path key="pill-l" d={eye(8.8).rest} variants={eyeVariants(8.8)} />
              <motion.path key="pill-r" d={eye(15.2).rest} variants={eyeVariants(15.2)} />
            </>
          )}
        </motion.g>
      </mask>
      {/* Only the visor shrinks (a touch smaller than her drawn one, so it clears the tufted outline, whichever visor);
          the eye mask stays in the icon's own grid, so the eyes are cut as crisply as before. */}
      <g mask={`url(#${id})`}>
        <path d={VISOR[isAssistantVisor(visor) ? visor : "bean"]} fill="currentColor" strokeWidth={1} transform="translate(12 10.6) scale(.88) translate(-12 -10.6)" />
      </g>
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
