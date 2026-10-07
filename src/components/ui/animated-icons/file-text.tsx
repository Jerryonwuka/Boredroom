"use client";

// lucide-animated's "file-text" (MIT, ./LICENSE), on lucide-react's drawing of FileText.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const line = (delay: number): Variants => ({
  normal: { pathLength: 1 },
  animate: { pathLength: [1, 0, 1], transition: { duration: 0.7, delay } },
});

export const AnimatedFileText = createAnimatedIcon({
  name: "file-text",
  variants: { normal: { scale: 1 }, animate: { scale: 1.05, transition: { duration: 0.3, ease: "easeOut" } } },
  children: (
    <>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <motion.path d="M10 9H8" variants={line(0.3)} />
      <motion.path d="M16 13H8" variants={line(0.5)} />
      <motion.path d="M16 17H8" variants={line(0.7)} />
    </>
  ),
});
