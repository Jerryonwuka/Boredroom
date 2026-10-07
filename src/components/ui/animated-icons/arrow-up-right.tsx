"use client";

// lucide-animated's "arrow-up-right" (MIT, ./LICENSE), on lucide-react's drawing of ArrowUpRight.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedArrowUpRight = createAnimatedIcon({
  name: "arrow-up-right",
  children: (
    <motion.g variants={{
      normal: { scale: 1, x: 0, y: 0 },
      animate: { scale: [1, 0.85, 1], x: [0, -4, 0], y: [0, 4, 0], originX: 1, originY: 0, transition: { duration: 0.5, ease: "easeInOut" } },
    }}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </motion.g>
  ),
});
