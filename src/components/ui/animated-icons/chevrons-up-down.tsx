"use client";

// lucide-animated's "chevrons-up-down" (MIT, ./LICENSE), on lucide-react's drawing of ChevronsUpDown.
import { motion } from "motion/react";
import { createAnimatedIcon } from "./adapter";

const SPRING = { type: "spring", stiffness: 250, damping: 25 } as const;

export const AnimatedChevronsUpDown = createAnimatedIcon({
  name: "chevrons-up-down",
  children: (
    <>
      <motion.path d="m7 15 5 5 5-5" transition={SPRING} variants={{ normal: { y: 0 }, animate: { y: 2 } }} />
      <motion.path d="m7 9 5-5 5 5" transition={SPRING} variants={{ normal: { y: 0 }, animate: { y: -2 } }} />
    </>
  ),
});
