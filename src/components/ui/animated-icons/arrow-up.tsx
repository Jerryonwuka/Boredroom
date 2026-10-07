"use client";

// lucide-animated's "arrow-up" (MIT, ./LICENSE), on lucide-react's drawing of ArrowUp.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedArrowUp = createAnimatedIcon({
  name: "arrow-up",
  children: (
    <>
      <motion.path d="m5 12 7-7 7 7" variants={{ normal: { y: 0 }, animate: { y: [0, 3, 0], transition: { duration: 0.4 } } }} />
      <motion.path d="M12 19V5" variants={{ normal: { d: "M12 19V5" }, animate: { d: ["M12 19V5", "M12 19V10", "M12 19V5"], transition: { duration: 0.4 } } }} />
    </>
  ),
});
