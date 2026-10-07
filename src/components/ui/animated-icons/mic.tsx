"use client";

// lucide-animated's "mic" (MIT, ./LICENSE), on lucide-react's drawing of Mic.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedMic = createAnimatedIcon({
  name: "mic",
  overflow: true,
  children: (
    <>
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <motion.rect x="9" y="2" width="6" height="13" rx="3" variants={{ normal: { y: 0 }, animate: { y: [0, -3, 0, -2, 0], transition: { duration: 0.6, ease: "easeInOut" } } }} />
    </>
  ),
});
