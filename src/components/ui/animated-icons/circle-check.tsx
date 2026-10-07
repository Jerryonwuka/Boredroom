"use client";

// lucide-animated's "circle-check" (MIT, ./LICENSE), on lucide-react's drawing of CircleCheck.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const TICK: Variants = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};

export const AnimatedCircleCheck = createAnimatedIcon({
  name: "circle-check",
  children: (
    <>
      <circle cx="12" cy="12" r="10" />
      {/* lucide's tick from its short end (the same shape at rest), so it draws in as written. */}
      <motion.path d="M8 12l2.5 2.5L16 9" variants={TICK} />
    </>
  ),
});
