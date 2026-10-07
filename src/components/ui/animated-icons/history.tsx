"use client";

// lucide-animated's "history" (MIT, ./LICENSE), on lucide-react's drawing of History.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide-react draws History as rotate-ccw-clock: the hands are one stroke (M12 7v5l4 2), split at the centre here.
export const AnimatedHistory = createAnimatedIcon({
  name: "history",
  children: (
    <>
      <motion.g transition={{ type: "spring", stiffness: 250, damping: 25 }} variants={{ normal: { rotate: 0 }, animate: { rotate: -50 } }}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </motion.g>
      <motion.path d="M12 7v5" transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        variants={{ normal: { rotate: 0, originX: "0%", originY: "100%" }, animate: { rotate: -360, originX: "0%", originY: "100%" } }} />
      <motion.path d="M12 12l4 2" transition={{ duration: 0.5, ease: "easeInOut" }}
        variants={{ normal: { rotate: 0, originX: "0%", originY: "0%" }, animate: { rotate: -45, originX: "0%", originY: "0%" } }} />
    </>
  ),
});
