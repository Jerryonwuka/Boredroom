"use client";

// lucide-animated's "shield-check" (MIT, ./LICENSE), on lucide-react's drawing of ShieldCheck.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const TICK: Variants = {
  normal: { opacity: 1, pathLength: 1, scale: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], scale: [0.5, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};

export const AnimatedShieldCheck = createAnimatedIcon({
  name: "shield-check",
  children: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <motion.path d="m9 12 2 2 4-4" variants={TICK} />
    </>
  ),
});
