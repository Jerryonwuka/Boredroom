"use client";

// lucide-animated's "lock" (MIT, ./LICENSE), on lucide-react's drawing of Lock.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedLock = createAnimatedIcon({
  name: "lock",
  variants: { normal: { rotate: 0, scale: 1 }, animate: { rotate: [-3, 1, -2, 0], scale: [0.95, 1.05, 0.98, 1] } },
  transition: { duration: 1, ease: [0.4, 0, 0.2, 1] },
  children: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <motion.path d="M7 11V7a5 5 0 0 1 10 0v4" transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} variants={{ normal: { pathLength: 1 }, animate: { pathLength: 0.7 } }} />
    </>
  ),
});
