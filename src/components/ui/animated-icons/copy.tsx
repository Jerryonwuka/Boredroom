"use client";

// lucide-animated's "copy" (MIT, ./LICENSE), on lucide-react's drawing of Copy.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const SPRING = { type: "spring", stiffness: 160, damping: 17, mass: 1 } as const;

export const AnimatedCopy = createAnimatedIcon({
  name: "copy",
  children: (
    <>
      <motion.rect width="14" height="14" x="8" y="8" rx="2" ry="2" transition={SPRING} variants={{ normal: { x: 0, y: 0 }, animate: { x: -3, y: -3 } }} />
      <motion.path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" transition={SPRING} variants={{ normal: { x: 0, y: 0 }, animate: { x: 3, y: 3 } }} />
    </>
  ),
});
