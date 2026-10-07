"use client";

// Boredroom's own animation for lucide's Building2 (lucide-animated has none), in the same idiom.
import { motion, type Variants } from "motion/react";
import { createAnimatedIcon } from "./adapter";

// The windows light up one after the other.
const WINDOW: Variants = { normal: { opacity: 1 }, animate: (i: number) => ({ opacity: [1, 0.25, 1], transition: { delay: i * 0.12, duration: 0.45 } }) };

export const AnimatedBuilding2 = createAnimatedIcon({
  name: "building-2",
  children: (
    <>
      <motion.path d="M10 12h4" custom={1} variants={WINDOW} />
      <motion.path d="M10 8h4" custom={0} variants={WINDOW} />
      <path d="M14 21v-3a2 2 0 0 0-4 0v3" />
      <path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
    </>
  ),
});
