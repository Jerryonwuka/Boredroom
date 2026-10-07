"use client";

// lucide-animated's "user-plus" (MIT, ./LICENSE), on lucide-react's drawing of UserPlus.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

export const AnimatedUserPlus = createAnimatedIcon({
  name: "user-plus",
  children: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <motion.g variants={{
        normal: { scale: 1, rotate: 0, opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
        animate: { scale: [0, 1.15, 1], rotate: [-90, 0, 0], opacity: [0, 1, 1], transition: { delay: 0.25, duration: 0.45, ease: "easeOut", times: [0, 0.7, 1] } },
      }}>
        <line x1="19" x2="19" y1="8" y2="14" />
        <line x1="22" x2="16" y1="11" y2="11" />
      </motion.g>
    </>
  ),
});
