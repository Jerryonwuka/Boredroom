"use client";

// lucide-animated's "timer" (MIT, ./LICENSE), on lucide-react's drawing of Timer.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedTimer = createAnimatedIcon({
  name: "timer",
  children: (
    <>
      <motion.line x1="10" x2="14" y1="2" y2="2" variants={{ normal: { scale: 1, y: 0 }, animate: { scale: [0.9, 1], y: [0, 1, 0], transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] } } }} />
      <motion.line x1="12" x2="15" y1="14" y2="11" variants={{
        normal: { rotate: 0, originX: "0%", originY: "100%", transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } },
        animate: { rotate: 300, originX: "0%", originY: "100%", transition: { delay: 0.1, duration: 0.6, ease: [0.4, 0, 0.2, 1] } },
      }} />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
});
