"use client";

// lucide-animated's "check" (MIT, ./LICENSE), on lucide-react's drawing of Check.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide's tick drawn from its short end, so it is drawn in the way a hand writes it (the same shape at rest).
const TICK: Variants = {
  normal: { opacity: 1, pathLength: 1, scale: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], scale: [0.5, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};

export const AnimatedCheck = createAnimatedIcon({
  name: "check",
  children: <motion.path d="M4 12l5 5L20 6" variants={TICK} />,
});
