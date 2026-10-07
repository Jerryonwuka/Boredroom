"use client";

// lucide-animated's "clock" (MIT, ./LICENSE), on lucide-react's drawing of Clock.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// lucide draws both hands as one stroke (M12 6v6l4 2); split at the centre so each turns on its own.
export const AnimatedClock = createAnimatedIcon({
  name: "clock",
  children: (
    <>
      <circle cx="12" cy="12" r="10" />
      <motion.path d="M12 6v6" transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        variants={{ normal: { rotate: 0, originX: "0%", originY: "100%" }, animate: { rotate: 360, originX: "0%", originY: "100%" } }} />
      <motion.path d="M12 12l4 2" transition={{ duration: 0.5, ease: "easeInOut" }}
        variants={{ normal: { rotate: 0, originX: "0%", originY: "0%" }, animate: { rotate: 45, originX: "0%", originY: "0%" } }} />
    </>
  ),
});
