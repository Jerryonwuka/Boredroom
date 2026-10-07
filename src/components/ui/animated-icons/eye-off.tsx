"use client";

// lucide-animated's "eye-off" (MIT, ./LICENSE), on lucide-react's drawing of EyeOff.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedEyeOff = createAnimatedIcon({
  name: "eye-off",
  children: (
    <>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      {/* The slash draws itself in (lucide-animated slides a longer stroke through; same idea, it ends drawn). */}
      <motion.path d="m2 2 20 20" variants={{ normal: { pathLength: 1, opacity: 1 }, animate: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.5 } } }} />
    </>
  ),
});
