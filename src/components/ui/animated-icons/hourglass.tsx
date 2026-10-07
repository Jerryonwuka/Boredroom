"use client";

// lucide-animated's "hourglass" (MIT, ./LICENSE), on lucide-react's drawing of Hourglass.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedHourglass = createAnimatedIcon({
  name: "hourglass",
  children: (
    <motion.g transition={{ type: "spring", stiffness: 100, damping: 15, mass: 1 }} variants={{ normal: { rotate: 0 }, animate: { rotate: 180 } }}>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </motion.g>
  ),
});
