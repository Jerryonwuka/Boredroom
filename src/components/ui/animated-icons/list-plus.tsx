"use client";

// Boredroom's own animation for lucide's ListPlus (lucide-animated has none), in the same idiom.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The plus turns in, as user-plus's does.
export const AnimatedListPlus = createAnimatedIcon({
  name: "list-plus",
  children: (
    <>
      <path d="M16 5H3" />
      <path d="M11 12H3" />
      <path d="M16 19H3" />
      <motion.g variants={{
        normal: { scale: 1, rotate: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
        animate: { scale: [0, 1.15, 1], rotate: [-90, 0, 0], opacity: [0, 1, 1], transition: { delay: 0.1, duration: 0.45, ease: "easeOut", times: [0, 0.7, 1] } },
      }}>
        <path d="M18 9v6" />
        <path d="M21 12h-6" />
      </motion.g>
    </>
  ),
});
